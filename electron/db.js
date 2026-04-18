/**
 * db.js — SQLite-backed clipboard storage
 * Location: %APPDATA%\clipboard-manager\clipboard.db
 * This folder is inside the user's AppData which is hidden by default
 * and won't be touched by normal file cleanup tools.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Store in AppData\Roaming\clipboard-manager (hidden, safe location)
const dbDir = path.join(os.homedir(), 'AppData', 'Roaming', 'clipboard-manager');
const prefs = require('./store');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'clipboard.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance and crash safety
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS clipboard_items (
    id         INTEGER PRIMARY KEY,
    text       TEXT    NOT NULL DEFAULT '',
    html       TEXT    NOT NULL DEFAULT '',
    image      TEXT    NOT NULL DEFAULT '',
    type       TEXT    NOT NULL DEFAULT 'text',
    pinned     INTEGER NOT NULL DEFAULT 0,
    timestamp  TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_items(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_pinned    ON clipboard_items(pinned DESC, timestamp DESC);
`);

// ─── Migrate from electron-store if exists ──────────────────────────────────
function migrateFromElectronStore() {
  try {
    const Store = require('electron-store');
    const oldStore = new Store({ name: 'config' });
    const oldData = oldStore.get('clipboard');
    if (Array.isArray(oldData) && oldData.length > 0) {
      const count = db.prepare('SELECT COUNT(*) as c FROM clipboard_items').get().c;
      if (count === 0) {
        console.log(`[DB] Migrating ${oldData.length} items from electron-store...`);
        const insert = db.prepare(`
          INSERT OR IGNORE INTO clipboard_items (id, text, html, image, type, pinned, timestamp)
          VALUES (@id, @text, @html, @image, @type, @pinned, @timestamp)
        `);
        const insertMany = db.transaction((items) => {
          for (const item of items) {
            insert.run({
              id:        item.id,
              text:      item.text  || '',
              html:      item.html  || '',
              image:     item.image || '',
              type:      item.type  || 'text',
              pinned:    item.pinned ? 1 : 0,
              timestamp: item.timestamp || new Date().toISOString(),
            });
          }
        });
        insertMany(oldData);
        console.log('[DB] Migration complete.');
      }
    }
  } catch (err) {
    console.error('[DB] Migration failed:', err);
  }
}
migrateFromElectronStore();

// ─── Helper: row → JS object ────────────────────────────────────────────────
function rowToItem(row) {
  if (!row) return null;
  return {
    id:        row.id,
    text:      row.text,
    html:      row.html,
    image:     row.image,
    type:      row.type,
    pinned:    row.pinned === 1,
    timestamp: row.timestamp,
  };
}

// ─── Prepared statements ─────────────────────────────────────────────────────
const stmts = {
  getAll: db.prepare(
    'SELECT * FROM clipboard_items ORDER BY pinned DESC, timestamp DESC LIMIT 500'
  ),
  getById: db.prepare(
    'SELECT * FROM clipboard_items WHERE id = ?'
  ),
  findDuplicate: db.prepare(
    'SELECT id FROM clipboard_items WHERE type = ? AND text = ? AND html = ? AND image = ?'
  ),
  insert: db.prepare(`
    INSERT INTO clipboard_items (id, text, html, image, type, pinned, timestamp)
    VALUES (@id, @text, @html, @image, @type, @pinned, @timestamp)
  `),
  updateTimestamp: db.prepare(
    'UPDATE clipboard_items SET timestamp = ? WHERE id = ?'
  ),
  deleteById: db.prepare(
    'DELETE FROM clipboard_items WHERE id = ?'
  ),
  deleteAll: db.prepare(
    'DELETE FROM clipboard_items WHERE pinned = 0'
  ),
  togglePin: db.prepare(
    'UPDATE clipboard_items SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?'
  ),
  search: db.prepare(
    "SELECT * FROM clipboard_items WHERE text LIKE ? ORDER BY pinned DESC, timestamp DESC LIMIT 500"
  ),
  count: db.prepare(
    'SELECT COUNT(*) as c FROM clipboard_items'
  ),
  deleteOldest: db.prepare(`
    DELETE FROM clipboard_items
    WHERE id IN (
      SELECT id FROM clipboard_items
      WHERE pinned = 0
      ORDER BY timestamp ASC
      LIMIT ?
    )
  `),
  getStats: db.prepare(`
    SELECT COUNT(*) as totalItems, MAX(timestamp) as lastCopied FROM clipboard_items
  `),
  deleteByDate: db.prepare(`
    DELETE FROM clipboard_items WHERE pinned = 0 AND timestamp < ?
  `),
};

// ─── Public API ──────────────────────────────────────────────────────────────

function getAll() {
  return stmts.getAll.all().map(rowToItem);
}

function addItem({ id, text, html, image, type, timestamp }) {
  // Check for duplicate
  const dup = stmts.findDuplicate.get(type, text || '', html || '', image || '');
  if (dup) {
    stmts.updateTimestamp.run(timestamp, dup.id);
    return rowToItem(stmts.getById.get(dup.id));
  }

  // Apply settings (auto delete old and max items)
  const settings = prefs.get('settings') || {};
  if (settings.autoDeleteDays > 0) {
    cleanOldItems(settings.autoDeleteDays);
  }

  const maxItems = settings.maxItems !== undefined ? settings.maxItems : 10000;
  const total = stmts.count.get().c;
  if (maxItems > 0 && total >= maxItems) {
    stmts.deleteOldest.run(total - maxItems + 1);
  }

  const finalId = id || Date.now();

  stmts.insert.run({
    id:        finalId,
    text:      text  || '',
    html:      html  || '',
    image:     image || '',
    type:      type  || 'text',
    pinned:    0,
    timestamp: timestamp || new Date().toISOString(),
  });

  return rowToItem(stmts.getById.get(finalId));
}

function deleteItem(id) {
  stmts.deleteById.run(id);
  return getAll();
}

function clearAll() {
  stmts.deleteAll.run();
  return getAll();
}

function togglePin(id) {
  stmts.togglePin.run(id);
  return getAll();
}

function search(query) {
  if (!query) return getAll();
  return stmts.search.all(`%${query}%`).map(rowToItem);
}

function getStats() {
  const stats = stmts.getStats.get();
  let dbSize = 0;
  try { dbSize = fs.statSync(dbPath).size; } catch (e) {}
  return {
    totalItems: stats.totalItems || 0,
    lastCopied: stats.lastCopied || null,
    storageUsage: dbSize,
  };
}

function cleanOldItems(days) {
  if (!days || days <= 0) return;
  const date = new Date();
  date.setDate(date.getDate() - days);
  stmts.deleteByDate.run(date.toISOString());
}

function getDbPath() {
  return dbPath;
}

function importData(items) {
  if (!Array.isArray(items)) throw new Error('Invalid format: array expected');
  
  const insertMany = db.transaction((list) => {
    for (const item of list) {
      if (!item.id || !item.type) continue; // Skip invalid
      
      const existing = stmts.getById.get(item.id);
      if (!existing) {
        stmts.insert.run({
          id:        item.id,
          text:      item.text  || '',
          html:      item.html  || '',
          image:     item.image || '',
          type:      item.type  || 'text',
          pinned:    item.pinned ? 1 : 0,
          timestamp: item.timestamp || new Date().toISOString(),
        });
      }
    }
  });
  
  insertMany(items);
  return getAll();
}

module.exports = { getAll, addItem, deleteItem, clearAll, togglePin, search, getStats, getDbPath, importData };

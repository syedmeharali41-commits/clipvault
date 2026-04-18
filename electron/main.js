const { app, BrowserWindow, ipcMain, clipboard, globalShortcut, nativeImage, Tray, Menu, dialog, shell, screen } = require('electron');
const { exec, execFile } = require('child_process');
const pathModule = require('path');
const fs = require('fs');
const db = require('./db');
const prefs = require('./store');

let mainWindow;
let lastText = clipboard.readText();
let lastHtml = clipboard.readHTML();
let lastImage = clipboard.readImage().isEmpty() ? '' : clipboard.readImage().toDataURL();
let previousHwnd = null;

// ─── Get Helper Path (Dev vs Prod ASAR) ───────────────────────────────────────
function getHelperPath(exeName) {
  return app.isPackaged
    ? pathModule.join(process.resourcesPath, exeName)
    : pathModule.join(__dirname, '..', exeName);
}

// ─── Get foreground window HWND ──────────────────────────────────────────────
function getForegroundHwnd() {
  return new Promise((resolve) => {
    const helperPath = getHelperPath('GetHwnd.exe');
    execFile(helperPath, [], (err, stdout) => {
      if (err) { resolve(null); return; }
      const hwnd = parseInt(stdout.trim());
      resolve(isNaN(hwnd) || hwnd === 0 ? null : hwnd);
    });
  });
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe'),
    args: ['--hidden']
  });
}

function repositionAndShowWindow() {
  if (!mainWindow) return;
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const bounds = mainWindow.getBounds();

  let x = point.x;
  let y = point.y;

  if (x + bounds.width > display.bounds.x + display.bounds.width) {
    x = display.bounds.x + display.bounds.width - bounds.width - 10;
  }
  if (y + bounds.height > display.bounds.y + display.bounds.height) {
    y = display.bounds.y + display.bounds.height - bounds.height - 10;
  }
  if (x < display.bounds.x) x = display.bounds.x + 10;
  if (y < display.bounds.y) y = display.bounds.y + 10;

  mainWindow.setPosition(x, y);
  mainWindow.show();
  mainWindow.focus();
}

let tray = null;
function createTray() {
  const iconPath = pathModule.join(__dirname, 'icon.png');
  let iconInfo;
  if (fs.existsSync(iconPath)) {
    iconInfo = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    // Exceedingly basic placeholder icon if missing from FS
    iconInfo = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY3x/YPw/A2LAAKnmER3gMBoNhgEDALzJIfvF/DkBAAAAAElFTkSuQmCC');
  }
  tray = new Tray(iconInfo);
  tray.setToolTip('Clipboard Manager');

  tray.on('click', async () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      previousHwnd = await getForegroundHwnd();
      repositionAndShowWindow();
    }
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Clipboard', click: async () => {
        previousHwnd = await getForegroundHwnd();
        repositionAndShowWindow();
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

// ─── Create Window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 620,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    icon: pathModule.join(__dirname, '../icon.ico'),
    backgroundColor: '#1a1a1a',
    skipTaskbar: true,
    webPreferences: {
      preload: pathModule.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(pathModule.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('ready-to-show', () => {
    // Tool hamesha start hone par hide hi rahega (background process k tor par) 
    // jab tak k properly Alt+V ya tray par click na kiya jaye.
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('blur', () => { if (mainWindow) mainWindow.hide(); });
}

// ─── Clipboard Monitoring ─────────────────────────────────────────────────────
let isFirstMonitorCycle = true;
function startClipboardMonitoring() {
  setInterval(() => {
    try {
      const formats = clipboard.availableFormats();
      let hasChanged = false;
      let currentType = 'text';
      let currentText = clipboard.readText();
      let currentHtml = '';
      let currentImage = '';

      if (formats.includes('image/png') || formats.includes('image/jpeg')) {
        const img = clipboard.readImage();
        if (!img.isEmpty()) {
          currentImage = img.toDataURL();
          if (currentImage !== lastImage) {
            hasChanged = true;
            currentType = 'image';
            currentText = '[Image]';
          }
        }
      } else if (formats.includes('text/html')) {
        currentHtml = clipboard.readHTML();
        if (currentHtml !== lastHtml || currentText !== lastText) {
          hasChanged = true;
          currentType = 'html';
          if (!currentText) currentText = '[Rich Text]';
        }
      } else if (formats.includes('text/rtf')) {
        if (currentText !== lastText) {
          hasChanged = true;
          currentType = 'rtf';
          if (!currentText) currentText = '[Rich Text]';
        }
      } else {
        if (currentText !== lastText && currentText.trim() !== '') {
          hasChanged = true;
          currentType = 'text';
        }
      }

      if (hasChanged) {
        lastText = currentText;
        lastHtml = currentHtml;
        lastImage = currentImage;

        if (isFirstMonitorCycle) {
          isFirstMonitorCycle = false;
          return; // Skip adding the first item we see if it just loaded up
        }

        const newItem = db.addItem({
          id: Date.now(),
          text: currentText,
          html: currentHtml,
          image: currentImage,
          type: currentType,
          timestamp: new Date().toISOString(),
        });

        if (mainWindow && newItem) {
          mainWindow.webContents.send('clipboard-updated', newItem);
        }
      }
    } catch (e) {
      console.error('Clipboard monitor error:', e);
    }
  }, 1000);
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-clipboard-history', () => db.getAll());

ipcMain.handle('delete-clipboard-item', (_e, id) => db.deleteItem(id));

ipcMain.handle('clear-clipboard-history', () => db.clearAll());

ipcMain.handle('hide-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('paste-text', (_e, text) => {
  if (text) clipboard.writeText(text);
  if (mainWindow) mainWindow.hide();
  setTimeout(() => {
    if (previousHwnd) {
      const helperPath = getHelperPath('WinHelper.exe');
      execFile(helperPath, ['paste', previousHwnd.toString()], (err) => {
        if (err) console.error('Paste failed:', err);
      });
    }
  }, 60);
});

ipcMain.handle('paste-item', (_e, item) => {
  if (item) {
    if (item.type === 'image' && item.image) {
      clipboard.writeImage(nativeImage.createFromDataURL(item.image));
    } else if (item.type === 'html' && item.html) {
      clipboard.write({ html: item.html, text: item.text || '' });
    } else if (item.text) {
      clipboard.writeText(item.text);
    }
  }
  if (mainWindow) mainWindow.hide();
  setTimeout(() => {
    if (previousHwnd) {
      const helperPath = getHelperPath('WinHelper.exe');
      execFile(helperPath, ['paste', previousHwnd.toString()], (err) => {
        if (err) console.error('Paste failed:', err);
      });
    }
  }, 60);
});

ipcMain.handle('toggle-pin-item', (_e, id) => db.togglePin(id));

ipcMain.handle('get-db-path', () => db.getDbPath());

ipcMain.handle('get-settings', () => prefs.get('settings'));
ipcMain.handle('save-settings', (_e, newSettings) => {
  prefs.set('settings', newSettings);
  setAutoLaunch(!!newSettings.autoStart);
});

ipcMain.handle('get-stats', () => db.getStats());

ipcMain.handle('export-backup', async () => {
  const items = db.getAll();
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Backup',
    defaultPath: 'clipboard_backup.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (filePath) {
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
    return { success: true, message: 'Backup exported successfully.' };
  }
  return { success: false };
});

ipcMain.handle('import-backup', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Backup',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (filePaths && filePaths.length > 0) {
    try {
      const content = fs.readFileSync(filePaths[0], 'utf-8');
      const items = JSON.parse(content);
      const updatedList = db.importData(items);
      return { success: true, items: updatedList, message: 'Backup restored successfully.' };
    } catch (e) {
      return { success: false, message: 'Failed to restore: ' + e.message };
    }
  }
  return { success: false };
});

ipcMain.handle('export-share', async () => {
  const items = db.getAll();
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Share Clipboard Items',
    defaultPath: 'shared_clipboard.txt',
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  if (filePath) {
    const textContent = items
      .filter(i => i.type === 'text' || i.type === 'rtf' || i.type === 'html')
      .map(i => `[${i.timestamp}] (${i.type})\n${i.text}`)
      .join('\n\n--- ✂ ---\n\n');
    fs.writeFileSync(filePath, textContent);
    shell.showItemInFolder(filePath);
    return { success: true, message: 'Items exported for sharing.' };
  }
  return { success: false };
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  startClipboardMonitoring();

  // Apply autolaunch based on saved settings
  const settings = prefs.get('settings') || {};
  setAutoLaunch(settings.autoStart !== false);

  globalShortcut.register('Alt+V', async () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      previousHwnd = await getForegroundHwnd();
      repositionAndShowWindow();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  // Prevent quitting when window is closed, as we want to stay in tray
});
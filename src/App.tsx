import { useState, useEffect, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Search, X, Trash2, Clock, Pin, FileText, Code2, Image, AlignLeft, Settings, Database, Activity, Save, Download, Upload, Share2 } from 'lucide-react';
import { format } from 'date-fns';
import './App.css';

interface ClipboardItem {
  id: number;
  text: string;
  html?: string;
  image?: string;
  timestamp: string;
  type: 'text' | 'html' | 'rtf' | 'image';
  pinned?: boolean;
}

type FilterTab = 'all' | 'pinned' | 'text' | 'image' | 'html';

declare global {
  interface Window {
    electronAPI: {
      getClipboardHistory: () => Promise<ClipboardItem[]>;
      clearClipboardHistory: () => Promise<ClipboardItem[]>;
      onClipboardUpdated: (callback: (event: any, item: ClipboardItem) => void) => () => void;
      hideWindow: () => Promise<void>;
      pasteText: (text: string) => Promise<void>;
      pasteItem: (item: ClipboardItem) => Promise<void>;
      togglePinClipboardItem: (id: number) => Promise<ClipboardItem[]>;
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<void>;
      getStats: () => Promise<any>;
      exportBackup: () => Promise<{success: boolean, message?: string}>;
      importBackup: () => Promise<{success: boolean, items?: ClipboardItem[], message?: string}>;
      exportShare: () => Promise<{success: boolean, message?: string}>;
    };
  }
}

// --- Format Badge ---
const FormatBadge = ({ type }: { type: ClipboardItem['type'] }) => {
  const map = {
    text:  { label: 'TEXT',  cls: 'badge-text',  Icon: AlignLeft },
    html:  { label: 'HTML',  cls: 'badge-html',  Icon: Code2 },
    rtf:   { label: 'RTF',   cls: 'badge-rtf',   Icon: FileText },
    image: { label: 'IMAGE', cls: 'badge-image', Icon: Image },
  };
  const { label, cls, Icon } = map[type] || map.text;
  return (
    <span className={`format-badge ${cls}`}>
      <Icon size={9} />
      {label}
    </span>
  );
};

// --- Single Clipboard Item ---
const ClipboardItemComponent = ({
  item, index, focusedIndex, copiedId,
  onCopy, onTogglePin, onDelete, onMouseEnter,
}: {
  item: ClipboardItem;
  index: number;
  focusedIndex: number;
  copiedId: number | null;
  onCopy: (item: ClipboardItem) => void;
  onTogglePin: (e: React.MouseEvent, id: number) => void;
  onDelete: (e: React.MouseEvent, id: number) => void;
  onMouseEnter: (index: number) => void;
}) => {
  const isFocused = focusedIndex === index;
  const isCopied = copiedId === item.id;

  return (
    <div
      className={`clipboard-item ${item.pinned ? 'pinned' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={() => onCopy(item)}
      onMouseEnter={() => onMouseEnter(index)}
    >
      <div className="item-content">
        {isCopied && <span className="copied-badge">Pasted!</span>}

        {item.type === 'image' && item.image ? (
          <div className="image-preview-wrap">
            <img src={item.image} alt="Clipboard image" className="image-preview" />
          </div>
        ) : item.type === 'html' && item.html ? (
          <div className="html-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.html) }} />
        ) : (
          <p className="item-text">{item.text || '(Empty)'}</p>
        )}

        <div className="item-meta">
          <FormatBadge type={item.type} />
          <Clock size={11} />
          <span>{(() => {
            try { return format(new Date(item.timestamp), 'dd MMM, hh:mm a'); }
            catch { return 'Unknown date'; }
          })()}</span>
        </div>
      </div>

      <div className="item-actions">
        <button
          className={`action-btn pin ${item.pinned ? 'active' : ''}`}
          onClick={(e) => onTogglePin(e, item.id)}
          title={item.pinned ? 'Unpin' : 'Pin'}
        >
          <Pin size={15} fill={item.pinned ? '#3b82f6' : 'none'} stroke={item.pinned ? '#3b82f6' : '#858585'} />
        </button>
        <button
          className="action-btn delete"
          onClick={(e) => onDelete(e, item.id)}
          title="Delete"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
};

// --- Main App ---
function App() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ autoStart: true, maxItems: 10000, autoDeleteDays: 0, language: 'en' });
  const [stats, setStats] = useState({ totalItems: 0, lastCopied: null, storageUsage: 0 });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!window.electronAPI) {
      setError('Electron API not available.');
      setIsLoading(false);
      return;
    }
    loadHistory();
    const cleanup = window.electronAPI.onClipboardUpdated((_event: any, newItem: ClipboardItem) => {
      if (!newItem) return;
      setItems(prev => {
        const filtered = prev.filter(i => {
          if (newItem.type === 'image') return !(i.type === 'image' && i.image === newItem.image);
          if (newItem.type === 'html') return !(i.type === 'html' && i.html === newItem.html);
          return i.text !== newItem.text;
        });
        return [newItem, ...filtered];
      });
    });
    return () => {
      if (cleanup) cleanup();
    }
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      if (!showSettings && searchRef.current) {
        searchRef.current.focus();
      }
    };
    window.addEventListener('focus', handleFocus);
    setTimeout(handleFocus, 100);
    return () => window.removeEventListener('focus', handleFocus);
  }, [showSettings]);

  const loadSettingsAndStats = async () => {
    if (!window.electronAPI) return;
    const s = await window.electronAPI.getSettings();
    const st = await window.electronAPI.getStats();
    if (s) setSettings(s);
    if (st) setStats(st);
  };

  useEffect(() => {
    if (showSettings) {
      loadSettingsAndStats();
    }
  }, [showSettings]);

  // Filter logic
  const filteredItems = useMemo(() => {
    let base = items.filter(i => !i.pinned);
    if (activeTab === 'pinned') base = items.filter(i => i.pinned);
    else if (activeTab === 'text') base = base.filter(i => i.type === 'text' || i.type === 'rtf');
    else if (activeTab === 'image') base = base.filter(i => i.type === 'image');
    else if (activeTab === 'html') base = base.filter(i => i.type === 'html');

    if (!searchQuery.trim()) return base;
    const words = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    return base.filter(item => {
      const text = (item.text || '').toLowerCase();
      let dateStr = '';
      try { dateStr = format(new Date(item.timestamp), 'PPpp').toLowerCase(); } catch {}
      return words.every(w => text.includes(w) || dateStr.includes(w));
    });
  }, [items, activeTab, searchQuery]);

  useEffect(() => { setFocusedIndex(0); }, [searchQuery, activeTab]);

  // Keyboard nav
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(p => (p + 1) % (filteredItems.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(p => (p - 1 + (filteredItems.length || 1)) % (filteredItems.length || 1));
      } else if (e.key === 'Enter') {
        const item = filteredItems[focusedIndex];
        if (item) pasteItem(item);
      } else if (e.key === 'Escape') {
        window.electronAPI.hideWindow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredItems, focusedIndex]);

  const loadHistory = async () => {
    try {
      const history = await window.electronAPI.getClipboardHistory();
      setItems(history || []);
    } catch (err) {
      setError('Failed to load clipboard history');
    } finally {
      setIsLoading(false);
    }
  };

  const pasteItem = (item: ClipboardItem) => {
    setCopiedId(item.id);
    window.electronAPI.pasteItem(item); // FIRE INSTANTLY!
    setTimeout(() => {
      setCopiedId(null);
    }, 400); // Visual badge remains for a bit
  };

  const deleteItem = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!window.electronAPI) return;
    const updated = await window.electronAPI.deleteClipboardItem(id);
    setItems(updated || []);
  };

  const clearAll = async () => {
    if (!window.electronAPI) return;
    if (confirm('Are you sure you want to clear all history?')) {
      const updated = await window.electronAPI.clearClipboardHistory();
      setItems(updated || []);
    }
  };

  const togglePin = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!window.electronAPI) return;
    const updated = await window.electronAPI.togglePinClipboardItem(id);
    setItems(updated || []);
  };

  // Tab counts memoized to prevent constant recalcs per stroke
  const counts = useMemo(() => {
    const unpinnedItems = items.filter(i => !i.pinned);
    return {
      all: unpinnedItems.length,
      pinned: items.filter(i => i.pinned).length,
      text: unpinnedItems.filter(i => i.type === 'text' || i.type === 'rtf').length,
      image: unpinnedItems.filter(i => i.type === 'image').length,
      html: unpinnedItems.filter(i => i.type === 'html').length,
    };
  }, [items]);

  const TAB_CONFIG: { key: FilterTab; label: string; Icon: any }[] = [
    { key: 'all',    label: 'All',    Icon: AlignLeft },
    { key: 'pinned', label: 'Pinned', Icon: Pin },
    { key: 'text',   label: 'Text',   Icon: FileText },
    { key: 'image',  label: 'Images', Icon: Image },
    { key: 'html',   label: 'HTML',   Icon: Code2 },
  ];

  const updateSetting = async (key: string, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    if (window.electronAPI) await window.electronAPI.saveSettings(newSettings);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleExportBackup = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.exportBackup();
    if (res.message) alert(res.message);
  };

  const handleImportBackup = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.importBackup();
    if (res.success && res.items) {
      setItems(res.items);
      alert(res.message);
      loadSettingsAndStats(); // refresh stats
    } else if (res.message) {
      alert(res.message);
    }
  };

  const handleExportShare = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.exportShare();
    if (res.message) alert(res.message);
  };

  if (isLoading) return <div className="loading"><span>Loading…</span></div>;
  if (error) return <div className="error"><h2>Error</h2><p>{error}</p></div>;

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <span className="title">📋 Clipboard</span>
        <div className="header-actions">
          <button className={`icon-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(!showSettings)} title="Settings">
            <Settings size={16} />
          </button>
          <button className="close-btn" onClick={() => window.electronAPI.hideWindow()} title="Hide in tray">
            <X size={18} />
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="settings-panel">
          <h2 className="settings-title">Preferences</h2>
          
          <div className="setting-group">
            <label className="setting-item">
              <div className="setting-info">
                <strong>Auto-start with Windows</strong>
                <span>Run in background tracking clipboard</span>
              </div>
              <input type="checkbox" checked={settings.autoStart} onChange={(e) => updateSetting('autoStart', e.target.checked)} />
            </label>

            <label className="setting-item">
              <div className="setting-info">
                <strong>Max History Limit</strong>
                <span>Maximum items before old unpinned items are deleted</span>
              </div>
              <select value={settings.maxItems} onChange={(e) => updateSetting('maxItems', parseInt(e.target.value))}>
                <option value={0}>No limit</option>
                <option value={100}>100 items</option>
                <option value={500}>500 items</option>
                <option value={1000}>1,000 items</option>
                <option value={10000}>10,000 items</option>
              </select>
            </label>

            <label className="setting-item">
              <div className="setting-info">
                <strong>Auto-delete old history</strong>
                <span>Remove unpinned items older than</span>
              </div>
              <select value={settings.autoDeleteDays} onChange={(e) => updateSetting('autoDeleteDays', parseInt(e.target.value))}>
                <option value={0}>Never (Disabled)</option>
                <option value={1}>1 Day</option>
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
              </select>
            </label>
          </div>

          <h2 className="settings-title"><Activity size={14} style={{display:'inline', marginRight:4}} /> Statistics & Info</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <Database size={16} />
              <div className="stat-val">{stats.totalItems.toLocaleString()}</div>
              <div className="stat-lbl">Total Items</div>
            </div>
            <div className="stat-card">
              <Save size={16} />
              <div className="stat-val">{formatBytes(stats.storageUsage)}</div>
              <div className="stat-lbl">Space Used</div>
            </div>
            <div className="stat-card">
              <Clock size={16} />
              <div className="stat-val" style={{fontSize: '11px'}}>
                {stats.lastCopied ? format(new Date(stats.lastCopied), 'MMM d, h:mm a') : 'Never'}
              </div>
              <div className="stat-lbl">Last Copied</div>
            </div>
          </div>

          <h2 className="settings-title"><Database size={14} style={{display:'inline', marginRight:4}} /> Data Management / Backup</h2>
          <div className="setting-group" style={{ padding: '12px', display: 'flex', gap: '8px', flexDirection: 'row' }}>
            <button
              onClick={handleImportBackup}
              title="Import Backup"
              style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: '#2d2d30', border: '1px solid #3a3a3a', borderRadius: '6px', color: '#d4d4d4', cursor: 'pointer' }}
            >
              <Download size={16} color="#3b82f6" />
              <span style={{ fontSize: '11px', fontWeight: 500 }}>Restore</span>
            </button>
            <button
              onClick={handleExportBackup}
              title="Export Full Backup"
              style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: '#2d2d30', border: '1px solid #3a3a3a', borderRadius: '6px', color: '#d4d4d4', cursor: 'pointer' }}
            >
              <Upload size={16} color="#10b981" />
              <span style={{ fontSize: '11px', fontWeight: 500 }}>Backup</span>
            </button>
            <button
              onClick={handleExportShare}
              title="Export as Text (Share)"
              style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: '#2d2d30', border: '1px solid #3a3a3a', borderRadius: '6px', color: '#d4d4d4', cursor: 'pointer' }}
            >
              <Share2 size={16} color="#f59e0b" />
              <span style={{ fontSize: '11px', fontWeight: 500 }}>Share</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Format Filter Tabs */}
          <div className="controls-container">
            {/* Search — TOP */}
            <div className="search-container">
              <Search size={16} className="search-icon" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="search-input"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="clear-search">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Tabs — BELOW search */}
            <div className="tabs">
              {TAB_CONFIG.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className={`tab-btn ${activeTab === key ? 'active' : ''}`}
                  onClick={() => setActiveTab(key)}
                >
                  <Icon size={13} />
                  {label}
                  {counts[key] > 0 && (
                    <span className="tab-count">{counts[key]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Items List */}
          <div className="items-list">
            {filteredItems.length > 0 ? (
              filteredItems.slice(0, 100).map((item, index) => (
                <ClipboardItemComponent
                  key={item.id}
                  item={item}
                  index={index}
                  focusedIndex={focusedIndex}
                  copiedId={copiedId}
                  onCopy={pasteItem}
                  onTogglePin={togglePin}
                  onDelete={deleteItem}
                  onMouseEnter={setFocusedIndex}
                />
              ))
            ) : (
              <div className="empty-tab">
                <div className="empty-icon">📭</div>
                <p>{searchQuery ? 'No results found' : `No ${activeTab === 'all' ? '' : activeTab + ' '}items yet`}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="footer">
              <span>{filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}</span>
              <button className="clear-all" onClick={clearAll}>
                <Trash2 size={13} /> Clear All
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
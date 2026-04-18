const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getClipboardHistory: () => ipcRenderer.invoke('get-clipboard-history'),
  deleteClipboardItem: (id) => ipcRenderer.invoke('delete-clipboard-item', id),
  clearClipboardHistory: () => ipcRenderer.invoke('clear-clipboard-history'),
  onClipboardUpdated: (callback) => {
    const wrappedCallback = (e, item) => callback(e, item);
    ipcRenderer.on('clipboard-updated', wrappedCallback);
    return () => ipcRenderer.removeListener('clipboard-updated', wrappedCallback);
  },
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  pasteText: (text) => ipcRenderer.invoke('paste-text', text),
  pasteItem: (item) => ipcRenderer.invoke('paste-item', item),
  togglePinClipboardItem: (id) => ipcRenderer.invoke('toggle-pin-item', id),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getStats: () => ipcRenderer.invoke('get-stats'),
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  exportShare: () => ipcRenderer.invoke('export-share'),
});
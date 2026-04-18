const Store = require('electron-store');

// We use electron-store only for settings now (history is in SQLite)
module.exports = new Store({
  name: 'preferences', // isolated from old config
  defaults: {
    settings: {
      autoStart: true,
      maxItems: 10000,
      autoDeleteDays: 0, // 0 = disabled
      language: 'en',
    },
  },
});
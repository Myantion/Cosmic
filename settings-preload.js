const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cosmicSettings', {
  getSettings: () => ipcRenderer.invoke('settings-get'),
  getDefaults: () => ipcRenderer.invoke('settings-get-defaults'),
  setSetting: (key, value) => ipcRenderer.invoke('settings-set', { key, value }),
  resetSetting: (key) => ipcRenderer.invoke('settings-reset-one', { key }),
  closeWindow: () => ipcRenderer.send('settings-close'),
});

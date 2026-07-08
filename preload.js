const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cosmicPet', {
  onToggleMode: (callback) => {
    ipcRenderer.on('toggle-mode', callback);
  },
  onRefreshDesktopBg: (callback) => {
    ipcRenderer.on('refresh-desktop-bg', callback);
  },
  onInitialDesktop: (callback) => {
    ipcRenderer.on('initial-desktop', (_event, base64) => callback(base64));
  },
  moveWindow: (dx, dy) => ipcRenderer.invoke('move-window', { dx, dy }),
  setMouseIgnore: (ignore) => {
    ipcRenderer.send('set-mouse-ignore', { ignore });
  },
  captureCleanFrame: () => ipcRenderer.invoke('capture-clean-frame'),
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  onApplySettings: (callback) => {
    ipcRenderer.on('apply-settings', (_event, payload) => callback(payload));
  },
});

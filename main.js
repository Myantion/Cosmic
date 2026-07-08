const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { DEFAULT_SETTINGS, settingsToRenderPayload, getPetWindowSize, BASE_WINDOW_SIZE } = require('./settings-defaults');

app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let mainWindow = null;
let settingsWindow = null;
let tray = null;

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH(), 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2), 'utf8');
}

let currentSettings = { ...DEFAULT_SETTINGS };

function resizePetWindow(blackHoleSize) {
  if (!mainWindow) return;
  const newSize = getPetWindowSize(blackHoleSize);
  const b = mainWindow.getBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  mainWindow.setBounds({
    x: Math.round(cx - newSize / 2),
    y: Math.round(cy - newSize / 2),
    width: newSize,
    height: newSize,
  });
}

function broadcastSettings() {
  const payload = settingsToRenderPayload(currentSettings);
  resizePetWindow(currentSettings.blackHoleSize);
  mainWindow?.webContents.send('apply-settings', payload);
  settingsWindow?.webContents.send('settings-sync', currentSettings);
}

function applySetting(key, value) {
  currentSettings = { ...currentSettings, [key]: value };
  saveSettings(currentSettings);
  broadcastSettings();
  return currentSettings;
}

function resetOneSetting(key) {
  if (!(key in DEFAULT_SETTINGS)) return currentSettings;
  currentSettings = { ...currentSettings, [key]: DEFAULT_SETTINGS[key] };
  saveSettings(currentSettings);
  broadcastSettings();
  return currentSettings;
}

function getCurrentWindowSize() {
  return getPetWindowSize(currentSettings.blackHoleSize);
}

async function captureDesktopThumbnail() {
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.floor(display.size.width * scale),
      height: Math.floor(display.size.height * scale),
    },
  });
  const source = sources.find((s) => /screen|整个|entire/i.test(s.name)) || sources[0];
  if (!source?.thumbnail || source.thumbnail.isEmpty()) return null;
  return source.thumbnail;
}

async function captureDesktopSnapshot() {
  const thumb = await captureDesktopThumbnail();
  if (!thumb) return null;
  return thumb.toPNG().toString('base64');
}

function centerWindow() {
  if (!mainWindow) return;
  const size = getCurrentWindowSize();
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setBounds({
    x: Math.floor((screenW - size) / 2),
    y: Math.floor((screenH - size) / 2),
    width: size,
    height: size,
  });
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
}

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const size = getCurrentWindowSize();

  mainWindow = new BrowserWindow({
    width: size,
    height: size,
    x: Math.floor((screenW - size) / 2),
    y: Math.floor((screenH - size) / 2),
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setContentProtection(true);
  mainWindow.loadFile('index.html');
  mainWindow.setBackgroundColor('#00000000');

  mainWindow.webContents.once('did-finish-load', async () => {
    const base64 = await captureDesktopSnapshot();
    if (base64) {
      mainWindow.webContents.send('initial-desktop', base64);
    }
    mainWindow.webContents.send('apply-settings', settingsToRenderPayload(currentSettings));
    mainWindow.setContentProtection(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('capture-clean-frame', async () => {
  if (!mainWindow) return null;

  mainWindow.hide();
  try {
    await new Promise((r) => setTimeout(r, 70));
    return await captureDesktopSnapshot();
  } finally {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.moveTop();
    }
  }
});

function getWindowBoundsPayload() {
  if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0, scale: 1 };
  const b = mainWindow.getContentBounds();
  const scale = screen.getPrimaryDisplay().scaleFactor;
  return {
    x: Math.round(b.x * scale),
    y: Math.round(b.y * scale),
    width: Math.round(b.width * scale),
    height: Math.round(b.height * scale),
    scale,
  };
}

ipcMain.handle('get-window-bounds', () => getWindowBoundsPayload());

ipcMain.handle('get-screen-size', () => {
  const d = screen.getPrimaryDisplay();
  return { width: d.size.width * d.scaleFactor, height: d.size.height * d.scaleFactor };
});

ipcMain.handle('move-window', (_event, { dx, dy }) => {
  if (!mainWindow) return getWindowBoundsPayload();
  const b = mainWindow.getContentBounds();
  mainWindow.setContentBounds({
    x: b.x + dx,
    y: b.y + dy,
    width: b.width,
    height: b.height,
  });
  return getWindowBoundsPayload();
});

ipcMain.on('set-mouse-ignore', (_event, { ignore }) => {
  if (!mainWindow) return;
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

function drawTrayIconBuffer(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rInner = size * 0.28;
  const rOuter = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const i = (y * size + x) * 4;
      if (d < rInner) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
      } else if (d < rOuter) {
        buf[i] = 240; buf[i + 1] = 185; buf[i + 2] = 85; buf[i + 3] = 255;
      } else {
        buf[i] = 30; buf[i + 1] = 30; buf[i + 2] = 38; buf[i + 3] = 255;
      }
    }
  }
  return buf;
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const fromFile = nativeImage.createFromPath(iconPath);
  if (!fromFile.isEmpty()) return fromFile;

  const size = 32;
  const buf = drawTrayIconBuffer(size);
  return nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 1.0 });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 380,
    height: 320,
    resizable: false,
    minimizable: true,
    maximizable: false,
    title: '宇宙桌宠 · 设置',
    backgroundColor: '#12141c',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile('settings.html');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createTray() {
  let icon = createTrayIcon();
  if (process.platform === 'win32' && !icon.isEmpty()) {
    const small = icon.resize({ width: 16, height: 16, quality: 'best' });
    if (!small.isEmpty()) icon = small;
  }

  tray = new Tray(icon);
  tray.setToolTip('宇宙桌宠 · 黑洞（点击显示窗口）');

  tray.on('click', () => {
    centerWindow();
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示到屏幕中央',
      click: () => centerWindow(),
    },
    {
      label: '置顶 / 取消置顶',
      click: () => {
        if (!mainWindow) return;
        const onTop = mainWindow.isAlwaysOnTop();
        mainWindow.setAlwaysOnTop(!onTop);
      },
    },
    {
      label: '切换黑洞形态',
      click: () => mainWindow?.webContents.send('toggle-mode'),
    },
    {
      label: '刷新桌面背景',
      click: () => mainWindow?.webContents.send('refresh-desktop-bg'),
    },
    {
      label: '设置',
      click: () => openSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
}

ipcMain.handle('settings-get', () => currentSettings);
ipcMain.handle('settings-get-defaults', () => ({ ...DEFAULT_SETTINGS }));
ipcMain.handle('settings-set', (_event, { key, value }) => applySetting(key, value));
ipcMain.handle('settings-reset-one', (_event, { key }) => resetOneSetting(key));
ipcMain.on('settings-close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

app.whenReady().then(() => {
  currentSettings = loadSettings();
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        .then((sources) => {
          const source = sources.find((s) => /screen|整个|entire/i.test(s.name)) || sources[0];
          callback(source ? { video: source, audio: false } : {});
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

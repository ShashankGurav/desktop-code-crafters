const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

// Use temp-backed runtime dirs to avoid AppData cache permission/lock failures.
const RUNTIME_ROOT = path.join(os.tmpdir(), 'cognisense-electron');
const USER_DATA_DIR = path.join(RUNTIME_ROOT, 'userData');
const SESSION_DATA_DIR = path.join(RUNTIME_ROOT, 'sessionData');

try {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DATA_DIR, { recursive: true });
  app.setPath('userData', USER_DATA_DIR);
  app.setPath('sessionData', SESSION_DATA_DIR);
} catch (err) {
  // Keep default Electron paths if temp path setup fails.
  console.warn('[WARN] Failed to set custom runtime dirs:', err);
}

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const PANEL_SIZES = {
  icon: { width: 20,  height: 20  },
  mini: { width: 360, height: 280 },
  full: { width: 520, height: 760 },
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           PANEL_SIZES.full.width,
    height:          PANEL_SIZES.full.height,
    frame:           false,
    transparent:     true,
    alwaysOnTop:     true,
    resizable:       false,
    hasShadow:       true,
    backgroundColor: '#00000000',
    vibrancy:        'fullscreen-ui',       // macOS native blur
    backgroundMaterial: 'acrylic',          // Windows 11
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('window:minimize', () => {
  mainWindow?.isDestroyed() || mainWindow.minimize();
});

ipcMain.on('window:close', () => {
  mainWindow?.isDestroyed() || mainWindow.close();
});

ipcMain.on('window:set-size', (_e, mode) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const size = PANEL_SIZES[mode] || PANEL_SIZES.full;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setBounds({ x, y, width: size.width, height: size.height }, true);

  if (mode === 'icon') {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setHasShadow(false);
    mainWindow.setBackgroundColor('#00000000');
  } else {
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setHasShadow(true);
  }
});
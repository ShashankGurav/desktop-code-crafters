const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

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
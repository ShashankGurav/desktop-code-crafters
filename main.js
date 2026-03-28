const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

const PANEL_SIZES = {
  icon: { width: 96, height: 96 },
  mini: { width: 360, height: 260 },
  full: { width: 520, height: 740 }
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: PANEL_SIZES.full.width,
    height: PANEL_SIZES.full.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.on('window:set-size', (_event, mode) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const size = PANEL_SIZES[mode] || PANEL_SIZES.full;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setBounds({
    x,
    y,
    width: size.width,
    height: size.height
  });
});

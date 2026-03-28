const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize:     () => ipcRenderer.send('window:minimize'),
  close:        () => ipcRenderer.send('window:close'),
  setPanelMode: (mode) => ipcRenderer.send('window:set-size', mode),
});
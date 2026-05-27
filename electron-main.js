'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const ICON = path.join(__dirname, 'public', 'icon.png');

let mainWindow = null;
let serverPort = 3000;

app.whenReady().then(async () => {
  let { startServer } = require('./server');

  try {
    serverPort = await startServer();
  } catch (err) {
    console.error('[Electron] Server failed to start:', err);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'SpotiFLAC',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Open external links (Apple Music, etc.) in the default browser, not in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${serverPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => app.quit());

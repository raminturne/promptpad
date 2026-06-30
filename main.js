const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let DATA_FILE;
let mainWindow = null;

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save data:', err);
    return false;
  }
}

function createWindow(BrowserWindow) {
  const saved = readData();
  const win = (saved && saved.window) || {};

  mainWindow = new BrowserWindow({
    width: win.width || 500,
    height: win.height || 440,
    minWidth: 340,
    minHeight: 300,
    x: win.x,
    y: win.y,
    frame: false,
    transparent: false,
    backgroundColor: '#1B211A',
    alwaysOnTop: win.alwaysOnTop !== undefined ? win.alwaysOnTop : true,
    skipTaskbar: false,
    resizable: true,
    fullscreenable: false,
    title: 'PromptPad',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (mainWindow.isAlwaysOnTop()) {
    mainWindow.setAlwaysOnTop(true, 'floating');
  }

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  let boundsTimer = null;
  const persistBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      const data = readData() || {};
      const b = mainWindow.getBounds();
      data.window = {
        ...(data.window || {}),
        width: b.width,
        height: b.height,
        x: b.x,
        y: b.y,
        alwaysOnTop: mainWindow.isAlwaysOnTop()
      };
      writeData(data);
    }, 400);
  };

  mainWindow.on('move', persistBounds);
  mainWindow.on('resize', persistBounds);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const { BrowserWindow, ipcMain, shell } = require('electron');

  DATA_FILE = path.join(app.getPath('userData'), 'promptpad-data.json');

  // ---- IPC ----
  ipcMain.handle('load-notes', () => {
    const data = readData();
    return data && data.notes ? data.notes : null;
  });

  ipcMain.handle('save-notes', (_e, notes) => {
    const data = readData() || {};
    data.notes = notes;
    return writeData(data);
  });

  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('toggle-always-on-top', () => {
    if (!mainWindow) return false;
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next, 'floating');
    const data = readData() || {};
    data.window = { ...(data.window || {}), alwaysOnTop: next };
    writeData(data);
    return next;
  });

  ipcMain.handle('get-always-on-top', () => {
    return mainWindow ? mainWindow.isAlwaysOnTop() : false;
  });

  ipcMain.handle('load-settings', () => {
    const data = readData();
    return data && data.settings ? data.settings : null;
  });

  ipcMain.handle('save-settings', (_e, settings) => {
    const data = readData() || {};
    data.settings = settings;
    return writeData(data);
  });

  ipcMain.on('set-bg-color', (_e, color) => {
    if (mainWindow && typeof color === 'string') {
      try { mainWindow.setBackgroundColor(color); } catch {}
    }
  });

  ipcMain.handle('set-startup', (_e, enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
      return app.getLoginItemSettings().openAtLogin;
    } catch (e) {
      console.error('startup setting failed', e);
      return false;
    }
  });

  ipcMain.handle('get-startup', () => {
    try { return app.getLoginItemSettings().openAtLogin; } catch { return false; }
  });

  ipcMain.on('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
  });

  createWindow(BrowserWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(BrowserWindow);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

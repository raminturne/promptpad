const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let DATA_FILE;
let mainWindow = null;
let tray = null;
let quitting = false;
let closeToTray = false;

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
  const savedSettings = (saved && saved.settings) || {};
  closeToTray = !!savedSettings.closeToTray;

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

  const op = Number(savedSettings.windowOpacity);
  if (op >= 70 && op < 100) mainWindow.setOpacity(op / 100);

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('close', (e) => {
    if (closeToTray && !quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

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

function toggleWindowVisible() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
  const { BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');

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

  ipcMain.handle('check-update', async () => {
    const { net } = require('electron');
    return new Promise((resolve) => {
      const req = net.request({
        method: 'GET',
        url: 'https://api.github.com/repos/raminturne/promptpad/releases/latest',
        headers: { 'User-Agent': 'PromptPad-UpdateCheck' }
      });
      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ tag: data.tag_name || null, url: data.html_url || null });
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  });

  ipcMain.on('set-opacity', (_e, v) => {
    if (!mainWindow) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    mainWindow.setOpacity(Math.min(1, Math.max(0.5, n)));
  });

  ipcMain.on('set-close-to-tray', (_e, enabled) => {
    closeToTray = !!enabled;
  });

  createWindow(BrowserWindow);

  // Tray icon — always available for quick show/hide; the "close to tray"
  // setting only controls what the window × button does.
  try {
    tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
    tray.setToolTip('PromptPad');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show PromptPad', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', toggleWindowVisible);
  } catch (e) {
    console.error('tray failed', e);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(BrowserWindow);
  });
});

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

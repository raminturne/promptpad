const { app, protocol, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Match the taskbar shortcut's AppUserModelID (electron-builder uses the
// build.appId) so a window restored from the tray merges with the pinned
// icon instead of spawning a second taskbar entry.
app.setAppUserModelId('com.raminturne.promptpad');

let DATA_FILE;
let IMAGES_DIR;
let FILES_DIR;
let mainWindow = null;
let qcWindow = null;
let tray = null;
let quitting = false;
let closeToTray = false;

const QUICK_CAPTURE_ACCEL = 'Control+Shift+Space';

// Dev/testing: run against an isolated data directory (also isolates the
// single-instance lock), e.g. electron . --pp-data-dir=C:\tmp\pp-test
const dataDirArg = process.argv.find((a) => a.startsWith('--pp-data-dir='));
if (dataDirArg) {
  try { app.setPath('userData', dataDirArg.slice('--pp-data-dir='.length)); } catch {}
}

// Custom scheme for note images ("ppimg://<filename>") — must be registered
// before app ready. Serves files from userData/images only.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ppimg', privileges: { secure: true, supportFetchAPI: true, stream: true } }
]);

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
  const { BrowserWindow, ipcMain, shell, Tray, Menu, dialog, net, globalShortcut } = require('electron');

  DATA_FILE = path.join(app.getPath('userData'), 'promptpad-data.json');

  // Images/files live under a base folder that defaults to userData but can be
  // redirected by the user (Settings → Storage) to any writable folder.
  const savedForStorage = readData();
  const storagePath = savedForStorage && savedForStorage.settings && savedForStorage.settings.storagePath;
  const storageBase = storagePath || app.getPath('userData');
  IMAGES_DIR = path.join(storageBase, 'images');
  FILES_DIR = path.join(storageBase, 'files');
  try { fs.mkdirSync(IMAGES_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch {}

  // Serve saved images to the renderer. Filenames are whitelisted to a safe
  // charset so the handler can never read outside IMAGES_DIR.
  protocol.handle('ppimg', async (req) => {
    try {
      let name = decodeURIComponent(req.url.slice('ppimg://'.length));
      name = name.replace(/[/\\]+$/, '');
      if (!/^[a-z0-9._-]+$/i.test(name) || name.includes('..')) {
        return new Response('', { status: 400 });
      }
      return await net.fetch(pathToFileURL(path.join(IMAGES_DIR, name)).toString());
    } catch {
      return new Response('', { status: 404 });
    }
  });

  // ---- IPC ----
  ipcMain.handle('copy-image-clipboard', (_e, filename) => {
    try {
      const img = nativeImage.createFromPath(path.join(IMAGES_DIR, filename));
      if (img.isEmpty()) return false;
      clipboard.writeImage(img);
      return true;
    } catch (err) {
      console.error('copy image failed', err);
      return false;
    }
  });

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

  // ---- Images ----
  const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

  function newImageName(ext) {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + ext;
  }

  ipcMain.handle('save-image', (_e, base64, ext) => {
    ext = String(ext || '').toLowerCase();
    if (!IMG_EXTS.includes(ext)) return null;
    // base64 inflates ~4/3, so this caps images at roughly 10 MB
    if (typeof base64 !== 'string' || !base64 || base64.length > 14_000_000) return null;
    try {
      const name = newImageName(ext);
      fs.writeFileSync(path.join(IMAGES_DIR, name), Buffer.from(base64, 'base64'));
      return { filename: name };
    } catch (err) {
      console.error('save-image failed', err);
      return null;
    }
  });

  ipcMain.handle('download-image', async (_e, filename) => {
    if (!mainWindow) return { ok: false };
    if (typeof filename !== 'string' || !/^[a-z0-9._-]+$/i.test(filename) || filename.includes('..')) {
      return { ok: false };
    }
    const src = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(src)) return { ok: false };
    const ext = path.extname(filename).slice(1).toLowerCase() || 'png';
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save image',
      defaultPath: 'image.' + ext,
      filters: [{ name: 'Image', extensions: [ext] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      fs.copyFileSync(src, res.filePath);
      return { ok: true, path: res.filePath };
    } catch (err) {
      console.error('download-image failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('reveal-image', (_e, filename) => {
    if (typeof filename !== 'string' || !/^[a-z0-9._-]+$/i.test(filename) || filename.includes('..')) {
      return { ok: false };
    }
    const p = path.join(IMAGES_DIR, filename);
    if (!fs.existsSync(p)) return { ok: false };
    shell.showItemInFolder(p);
    return { ok: true };
  });

  ipcMain.handle('pick-image', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Insert image',
      filters: [{ name: 'Images', extensions: IMG_EXTS }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const src = res.filePaths[0];
    const ext = path.extname(src).slice(1).toLowerCase();
    if (!IMG_EXTS.includes(ext)) return null;
    try {
      const name = newImageName(ext);
      fs.copyFileSync(src, path.join(IMAGES_DIR, name));
      return { filename: name };
    } catch (err) {
      console.error('pick-image failed', err);
      return null;
    }
  });

  // ---- Per-tab / Fast Save file attachments ----
  // Stored copies live in FILES_DIR under a random name; storedName is always
  // whitelisted before it touches the filesystem.
  const safeStored = (s) => typeof s === 'string' && /^[a-z0-9._-]+$/i.test(s) && !s.includes('..');
  const storedPath = (s) => path.join(FILES_DIR, s);

  function newStoredName(ext) {
    const e = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (e ? '.' + e : '');
  }

  ipcMain.handle('pick-files', async () => {
    if (!mainWindow) return [];
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Add files',
      properties: ['openFile', 'multiSelections']
    });
    if (res.canceled || !res.filePaths.length) return [];
    const out = [];
    for (const src of res.filePaths) {
      try {
        const ext = path.extname(src).slice(1).toLowerCase();
        const storedName = newStoredName(ext);
        fs.copyFileSync(src, storedPath(storedName));
        const size = fs.statSync(storedPath(storedName)).size;
        out.push({ name: path.basename(src), storedName, size, ext });
      } catch (err) {
        console.error('pick-files copy failed', err);
      }
    }
    return out;
  });

  ipcMain.handle('save-file-as', async (_e, storedName, name) => {
    if (!mainWindow || !safeStored(storedName)) return { ok: false };
    if (!fs.existsSync(storedPath(storedName))) return { ok: false };
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save file',
      defaultPath: (typeof name === 'string' && name) ? name : storedName
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      fs.copyFileSync(storedPath(storedName), res.filePath);
      return { ok: true, path: res.filePath };
    } catch (err) {
      console.error('save-file-as failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('open-file', async (_e, storedName) => {
    if (!safeStored(storedName)) return { ok: false };
    const p = storedPath(storedName);
    if (!fs.existsSync(p)) return { ok: false };
    const err = await shell.openPath(p);
    return { ok: !err, error: err || undefined };
  });

  ipcMain.handle('reveal-file', (_e, storedName) => {
    if (!safeStored(storedName)) return { ok: false };
    const p = storedPath(storedName);
    if (!fs.existsSync(p)) return { ok: false };
    shell.showItemInFolder(p);
    return { ok: true };
  });

  ipcMain.handle('delete-file', (_e, storedName) => {
    if (!safeStored(storedName)) return { ok: false };
    try { fs.unlinkSync(storedPath(storedName)); } catch {}
    return { ok: true };
  });

  // ---- Storage location (where attached images/files are kept) ----
  ipcMain.handle('get-storage-path', () => {
    const data = readData();
    const custom = data && data.settings && data.settings.storagePath;
    return { path: custom || app.getPath('userData'), isDefault: !custom };
  });

  ipcMain.handle('pick-storage-folder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for images & files',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('set-storage-path', (_e, newBase) => {
    if (typeof newBase !== 'string' || !newBase) return { ok: false };
    try {
      const newImages = path.join(newBase, 'images');
      const newFiles = path.join(newBase, 'files');
      if (path.resolve(newImages) === path.resolve(IMAGES_DIR)) {
        return { ok: true, path: newBase }; // already there — no-op
      }
      fs.mkdirSync(newImages, { recursive: true });
      fs.mkdirSync(newFiles, { recursive: true });
      // Copy first (so a failure never leaves us with data missing from both
      // places), only remove the old folders once the copy has succeeded.
      fs.cpSync(IMAGES_DIR, newImages, { recursive: true });
      fs.cpSync(FILES_DIR, newFiles, { recursive: true });
      const oldImages = IMAGES_DIR, oldFiles = FILES_DIR;
      IMAGES_DIR = newImages;
      FILES_DIR = newFiles;
      try { fs.rmSync(oldImages, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(oldFiles, { recursive: true, force: true }); } catch {}
      const data = readData() || {};
      data.settings = { ...(data.settings || {}), storagePath: newBase };
      writeData(data);
      return { ok: true, path: newBase };
    } catch (err) {
      console.error('set-storage-path failed', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('open-storage-folder', () => {
    const data = readData();
    const base = (data && data.settings && data.settings.storagePath) || app.getPath('userData');
    shell.openPath(base);
    return true;
  });

  // ---- Backup: export / import ----
  ipcMain.handle('export-data', async () => {
    if (!mainWindow) return { ok: false };
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export backup',
      defaultPath: 'promptpad-backup-' + new Date().toISOString().slice(0, 10) + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      const data = readData() || {};
      fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      console.error('export failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('import-data', async () => {
    if (!mainWindow) return { ok: false };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    try {
      let parsed = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8'));
      // accept a bare state file too ({ tabs: [...] })
      if (parsed && Array.isArray(parsed.tabs)) parsed = { notes: parsed };
      if (!parsed || !parsed.notes || !Array.isArray(parsed.notes.tabs)) {
        return { ok: false, invalid: true };
      }
      const current = readData();
      if (current) {
        const bak = DATA_FILE.replace(/\.json$/, '') + '.backup-' + Date.now() + '.json';
        fs.writeFileSync(bak, JSON.stringify(current, null, 2), 'utf-8');
      }
      // keep this machine's window geometry
      if (current && current.window) parsed.window = current.window;
      writeData(parsed);
      return { ok: true };
    } catch (err) {
      console.error('import failed', err);
      return { ok: false, invalid: true };
    }
  });

  ipcMain.on('relaunch-app', () => {
    quitting = true;
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('export-note', async (_e, name, content, ext) => {
    if (!mainWindow) return { ok: false };
    ext = ext === 'txt' ? 'txt' : 'md';
    const safe = String(name || 'note')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'note';
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export note',
      defaultPath: safe + '.' + ext,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] }
      ]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(res.filePath, String(content || ''), 'utf-8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      console.error('export-note failed', err);
      return { ok: false };
    }
  });

  // ---- Global quick-capture hotkey ----
  // Opens a small, standalone always-on-top box WITHOUT raising the main
  // window. What you type/paste is forwarded to the main window and appended
  // to Fast Save, so the app itself never steals focus from your work.
  function showQuickCaptureWindow() {
    if (qcWindow && !qcWindow.isDestroyed()) {
      qcWindow.show();
      qcWindow.focus();
      return;
    }
    qcWindow = new BrowserWindow({
      width: 460,
      height: 210,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    qcWindow.setAlwaysOnTop(true, 'screen-saver');
    qcWindow.loadFile(path.join(__dirname, 'src', 'quickcapture.html'));
    let openedAt = 0;
    qcWindow.once('ready-to-show', () => {
      openedAt = Date.now();
      qcWindow.show();
      qcWindow.focus();
    });
    // Dismiss when it loses focus (a lightweight, Spotlight-style popup),
    // but ignore the very first moments while it's still settling.
    qcWindow.on('blur', () => {
      if (qcWindow && !qcWindow.isDestroyed() && Date.now() - openedAt > 400) qcWindow.close();
    });
    qcWindow.on('closed', () => { qcWindow = null; });
  }

  function triggerQuickCapture() {
    showQuickCaptureWindow();
  }

  ipcMain.on('qc-submit', (_e, payload) => {
    if (mainWindow) mainWindow.webContents.send('qc-message', payload);
    if (qcWindow && !qcWindow.isDestroyed()) qcWindow.close();
  });

  ipcMain.on('qc-close', () => {
    if (qcWindow && !qcWindow.isDestroyed()) qcWindow.close();
  });

  ipcMain.handle('set-quick-capture', (_e, enabled) => {
    try { globalShortcut.unregister(QUICK_CAPTURE_ACCEL); } catch {}
    if (!enabled) return false;
    try {
      return globalShortcut.register(QUICK_CAPTURE_ACCEL, triggerQuickCapture);
    } catch {
      return false;
    }
  });

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch {}
  });

  createWindow(BrowserWindow);

  // Tray icon — always available for quick show/hide; the "close to tray"
  // setting only controls what the window × button does.
  try {
    tray = new Tray(path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
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

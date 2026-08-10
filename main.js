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

// ---- Handy (peek) mode: window collapses to a thin line at the screen edge
// and slides open on hover. See the handy-* IPC handlers below. ----
let handyActive = false;
let handyExpanded = false;      // true while the panel is slid open
let handyNormalBounds = null;   // expanded/normal bounds (updated when the user resizes)
let handyPrevAlwaysOnTop = null;
let handyPrevOpacity = 1;       // window opacity to restore when the panel opens/exits
let handyAnimTimer = null;
let handyAccel = null;          // currently-registered global show/hide shortcut
const HANDY_HANDLE_W = 168;
const HANDY_HANDLE_H = 40;      // deterministic, easy hover target (above Windows' ~39px clamp)
const HANDY_EDGE_MARGIN = 18;
const HANDY_BOTTOM_GAP = 20;    // float the line clearly off the taskbar (no flicker at the edge)
const HANDY_EXPANDED_GAP = 12;  // float the open panel off the taskbar too, so its bottom edge is grabbable to resize
const HANDY_COLLAPSED_OPACITY = 0.4; // faint, mostly-transparent line when tucked away

// The quick-capture global shortcut is user-configurable (Settings). This holds
// the currently-registered accelerator; the renderer sets it on startup and when
// changed. Default lives in the renderer's DEFAULT_SETTINGS.quickCaptureShortcut.
let quickCaptureAccel = 'Ctrl+Shift+Space';
let quickCaptureOn = false; // whether the shortcut is currently registered

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

// ---------- Profiles ----------
// Chrome-like profiles: each profile owns a workspace (tabs, groups, templates,
// placeholder values, Fast Save, AI Chat). The *active* profile's workspace is
// `data.notes` — the same key it has always been — and only the parked ones live
// under `data.profileData`. Keeping `notes` canonical means load-notes,
// save-notes, export-data and the import validator all keep working unchanged.
//
// `data.shared` holds what every profile sees: the Prompt Lab library. The
// Discover login is NOT here — it lives in Chromium's localStorage for the
// file:// origin, which is per-install, so it is shared for free as long as
// nothing ever repartitions the session or moves userData.
const PROFILE_COLORS = ['#5290e0', '#e05252', '#52b05a', '#9052e0', '#e07a52', '#e0c852', '#e052b8'];

function emptyWorkspace() {
  return {
    tabs: [], activeId: null, seq: 1, templates: [], groups: [],
    phValues: {}, fastSave: { messages: [] }, aiChat: { messages: [] }
  };
}

function newProfileId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Shared keys are stored once in data.shared; a copy is mirrored into
// data.notes so an exported file stays readable by an older build.
function stripShared(ws) {
  const { promptLab, lastVersion, ...rest } = ws || {};
  return rest;
}
function withShared(data, ws) {
  return {
    ...(ws || emptyWorkspace()),
    promptLab: (data.shared && data.shared.promptLab) || [],
    // Read-only for the renderer: it migrates this into settings.lastVersion
    // once and never writes it back.
    lastVersion: (data.shared && data.shared.lastVersion) || null
  };
}

// Text alignment moved from the global settings.editorAlign onto each tab
// (t.align). Stamp the old global once so upgrading users see no visual change.
//
// This has to run in main, not the renderer: the renderer only ever sees the
// active profile's workspace, so a renderer-side migration would leave every
// parked profile's tabs at 'auto' and silently reset their alignment.
//
// The per-tab guard is `align === undefined`, so a tab the user later sets back
// to 'auto' is never re-stamped — which also makes the whole pass idempotent if
// the app quits before the flag reaches disk.
function migrateTabAlign(data) {
  if (data.alignMigrated) return;
  const s = data.settings || {};
  const mode = s.editorAlign || (s.editorJustify ? 'justify' : 'auto');
  if (mode !== 'auto') {
    const stamp = (ws) => (ws && Array.isArray(ws.tabs) ? ws.tabs : [])
      .forEach((t) => { if (t && t.align === undefined) t.align = mode; });
    stamp(data.notes);
    Object.keys(data.profileData || {}).forEach((k) => stamp(data.profileData[k]));
  }
  data.alignMigrated = true;
}

// Idempotent: only ever adds keys, and bails out once profiles exist. Nothing
// is deleted from `notes`, so the migration is lossless and safe to re-run.
function migrateProfiles(data) {
  if (!data) return data;
  data.shared = data.shared || {};
  data.profileData = data.profileData || {};
  migrateTabAlign(data);
  if (Array.isArray(data.profiles) && data.profiles.length) {
    if (!Array.isArray(data.shared.promptLab)) data.shared.promptLab = [];
    return data;
  }
  const notes = data.notes || {};
  const id = newProfileId();
  data.profiles = [{ id, name: 'Profile 1', color: PROFILE_COLORS[0], createdAt: Date.now() }];
  data.activeProfileId = id;
  if (!Array.isArray(data.shared.promptLab)) {
    data.shared.promptLab = Array.isArray(notes.promptLab) ? notes.promptLab : [];
  }
  if (data.shared.lastVersion === undefined) data.shared.lastVersion = notes.lastVersion || null;
  return data;
}

function profileRegistry(data) {
  return { profiles: data.profiles || [], activeProfileId: data.activeProfileId || null };
}

// All reads/writes of DATA_FILE go through here, so the parsed contents can
// be cached — otherwise every debounced autosave re-reads and re-parses the
// whole file synchronously just to merge one key. It's also the single choke
// point where the profile migration runs, exactly once per process.
let dataCache = null;

function readData() {
  if (dataCache) return dataCache;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    dataCache = migrateProfiles(JSON.parse(raw));
  } catch {
    dataCache = null;
  }
  return dataCache;
}

// Every handler that is about to MUTATE and write the data file must go through
// this, never `readData() || {}`. On a fresh install readData() returns null,
// and writing a bare {} would put an unmigrated object into dataCache — after
// which readData() is truthy forever and the profile migration never runs, so
// the app ends up with no profiles at all. Migration is idempotent, so calling
// it on an already-migrated cache is free.
function ensureData() {
  const d = readData();
  if (d) return migrateProfiles(d);
  dataCache = migrateProfiles({});
  return dataCache;
}

function writeData(data) {
  dataCache = data;
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
  // If we booted into handy (peek) mode last time, start hidden so the user
  // never sees a full-size frameless window flash on the taskbar before the
  // renderer collapses it to the sliver — the renderer's early handy-enter
  // reveals it as the collapsed dock (see the handy-enter handler).
  const bootHandy = savedSettings.handyEnabled !== false && !!savedSettings.handyMode;

  mainWindow = new BrowserWindow({
    width: win.width || 500,
    height: win.height || 440,
    minWidth: 340,
    minHeight: 300,
    x: win.x,
    y: win.y,
    show: !bootHandy,
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

  // Safety net: never leave the window permanently invisible if the renderer's
  // handy-enter never arrives (e.g. a cold-boot load failure). Show it anyway.
  if (bootHandy) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    }, 4000);
  }

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

  // Keep the renderer's maximize/restore glyph in sync — the window can also be
  // maximized by double-clicking the titlebar, snapping, or Win+Up.
  const sendMaxState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('maximize-change', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  let boundsTimer = null;
  const persistBounds = () => {
    if (handyActive) return; // handy-mode drives the bounds; don't save the sliver
    // Saving the maximized bounds would reopen the app at full-screen size with
    // no way back to the size the user actually chose.
    if (mainWindow.isMaximized()) return;
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      const data = ensureData();
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

  // While handy-mode is expanded, remember any size the user drags the panel to
  // (our own animation frames set handyAnimTimer, so those are ignored) — so the
  // panel keeps that size on the next hover and after a restart.
  let handyResizeTimer = null;
  mainWindow.on('resize', () => {
    if (!handyActive || !handyExpanded || handyAnimTimer) return;
    const b = mainWindow.getBounds();
    if (handyNormalBounds) { handyNormalBounds.width = b.width; handyNormalBounds.height = b.height; }
    clearTimeout(handyResizeTimer);
    handyResizeTimer = setTimeout(() => {
      const data = ensureData();
      data.window = { ...(data.window || {}), width: b.width, height: b.height };
      writeData(data);
    }, 400);
  });

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
  const { BrowserWindow, ipcMain, shell, Tray, Menu, dialog, net, globalShortcut, session, screen } = require('electron');

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

  // Allow the microphone (speech-to-text) and the clipboard. Electron denies
  // every permission by default once a handler is set — WITHOUT listing the
  // clipboard here, navigator.clipboard read/write (every Copy button and the
  // Paste button) silently fails with "permission denied".
  const ALLOWED_PERMISSIONS = ['media', 'clipboard-read', 'clipboard-sanitized-write'];
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.includes(permission);
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
    if (!data || !data.notes) return null;
    // Always hand back the shared Prompt Lab, never the (possibly stale) copy
    // mirrored inside notes.
    return withShared(data, data.notes);
  });

  ipcMain.handle('save-notes', (_e, notes) => {
    const data = ensureData();
    // Lift the shared keys out of the workspace blob. Guarded on isArray so a
    // renderer that momentarily has no promptLab (a brand-new profile, or a
    // failed load) can never wipe the shared library.
    if (Array.isArray(notes && notes.promptLab)) {
      data.shared = data.shared || {};
      data.shared.promptLab = notes.promptLab;
    }
    // The mirror inside notes keeps exported files readable by older builds.
    data.notes = { ...notes, promptLab: (data.shared && data.shared.promptLab) || [] };
    return writeData(data);
  });

  // ---------- Profiles ----------
  ipcMain.handle('list-profiles', () => profileRegistry(ensureData()));

  ipcMain.handle('create-profile', (_e, name) => {
    const data = ensureData();
    const id = newProfileId();
    const used = new Set((data.profiles || []).map((p) => p.color));
    const color = PROFILE_COLORS.find((c) => !used.has(c)) ||
      PROFILE_COLORS[(data.profiles || []).length % PROFILE_COLORS.length];
    data.profiles.push({
      id, color, createdAt: Date.now(),
      name: String(name || '').trim().slice(0, 32) || ('Profile ' + (data.profiles.length + 1))
    });
    // Park the current workspace and hand back a fresh empty one.
    data.profileData[data.activeProfileId] = stripShared(data.notes || emptyWorkspace());
    data.notes = withShared(data, emptyWorkspace());
    data.activeProfileId = id;
    writeData(data);
    return { ok: true, ...profileRegistry(data), notes: data.notes };
  });

  ipcMain.handle('switch-profile', (_e, id) => {
    const data = ensureData();
    if (!(data.profiles || []).some((p) => p.id === id)) return { ok: false };
    if (id === data.activeProfileId) {
      return { ok: true, ...profileRegistry(data), notes: withShared(data, data.notes) };
    }
    data.profileData[data.activeProfileId] = stripShared(data.notes || emptyWorkspace());
    // Hydrate to a valid empty workspace, never null — data.notes.tabs must stay
    // an array or export-data would produce a file its own importer rejects.
    data.notes = withShared(data, data.profileData[id] || emptyWorkspace());
    delete data.profileData[id];
    data.activeProfileId = id;
    writeData(data);
    return { ok: true, ...profileRegistry(data), notes: data.notes };
  });

  ipcMain.handle('rename-profile', (_e, id, name) => {
    const data = ensureData();
    const p = (data.profiles || []).find((x) => x.id === id);
    const next = String(name || '').trim().slice(0, 32);
    if (!p || !next) return { ok: false };
    p.name = next;
    writeData(data);
    return { ok: true, ...profileRegistry(data) };
  });

  ipcMain.handle('delete-profile', (_e, id) => {
    const data = ensureData();
    if (!(data.profiles || []).some((p) => p.id === id)) return { ok: false };
    if (data.profiles.length <= 1) return { ok: false, reason: 'last' };

    // Deleting the profile you're standing in: move to a neighbour first, so
    // the same park/hydrate path runs and data.notes is never left dangling.
    let switched = false;
    if (id === data.activeProfileId) {
      const idx = data.profiles.findIndex((p) => p.id === id);
      const next = data.profiles[idx + 1] || data.profiles[idx - 1];
      data.profileData[id] = stripShared(data.notes || emptyWorkspace());
      data.notes = withShared(data, data.profileData[next.id] || emptyWorkspace());
      delete data.profileData[next.id];
      data.activeProfileId = next.id;
      switched = true;
    }

    const ws = data.profileData[id];
    delete data.profileData[id];
    data.profiles = data.profiles.filter((p) => p.id !== id);
    writeData(data);

    // Attached files are per-tab and per-profile, so they can be reclaimed.
    // Images deliberately are NOT: the same filename can be referenced from a
    // note, a Fast Save message and a shared Prompt Lab item, and there is no
    // refcount (closing a tab has always leaked them the same way).
    if (ws) {
      const stored = [];
      (ws.tabs || []).forEach((t) => (t.files || []).forEach((f) => stored.push(f.storedName)));
      ((ws.fastSave && ws.fastSave.messages) || []).forEach((m) => {
        if (m && m.file && m.file.storedName) stored.push(m.file.storedName);
      });
      stored.forEach((nm) => {
        // Same guard as delete-file: never let a stored name escape FILES_DIR.
        if (typeof nm !== 'string' || !/^[a-z0-9._-]+$/i.test(nm) || nm.includes('..')) return;
        try { fs.unlinkSync(path.join(FILES_DIR, nm)); } catch {}
      });
    }
    return { ok: true, ...profileRegistry(data), notes: switched ? data.notes : null };
  });

  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window-toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });

  ipcMain.handle('is-maximized', () => (mainWindow ? mainWindow.isMaximized() : false));

  ipcMain.handle('toggle-always-on-top', () => {
    if (!mainWindow) return false;
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next, 'floating');
    const data = ensureData();
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
    const data = ensureData();
    // Merge rather than overwrite: fields like storagePath are written only
    // via set-storage-path and never round-trip through the renderer's own
    // settings object, so a full overwrite here would silently drop them.
    data.settings = { ...(data.settings || {}), ...settings };
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

  // ---- In-app auto-update (electron-updater). Windows + Linux (AppImage).
  // macOS can't auto-update unsigned, and dev builds can't either — those fall
  // back to the GitHub-API notify flow (check-update → open the release page). ----
  let autoUpdater = null;
  try { ({ autoUpdater } = require('electron-updater')); } catch {}
  const updaterSupported = !!(autoUpdater && app.isPackaged && process.platform !== 'darwin');
  if (updaterSupported) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // Our Windows builds aren't code-signed. electron-updater runs an
    // Authenticode check *after* the download finishes, so an unsigned build
    // fails at 100% with "not signed by the application owner" (that was the
    // v2.7.0 update failure). The check only runs when app-update.yml carries a
    // publisherName — now dropped from the build config — and this replaces the
    // verifier itself as a second line of defence. It must be a function:
    // NsisUpdater's setter ignores falsy values, so `= false` would do nothing.
    if (process.platform === 'win32') {
      try { autoUpdater.verifyUpdateCodeSignature = () => Promise.resolve(null); } catch {}
    }
    const send = (payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater-event', payload); };
    autoUpdater.on('update-available', (i) => send({ type: 'available', version: i && i.version }));
    autoUpdater.on('update-not-available', () => send({ type: 'none' }));
    autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: Math.round((p && p.percent) || 0) }));
    autoUpdater.on('update-downloaded', (i) => send({ type: 'downloaded', version: i && i.version }));
    autoUpdater.on('error', (e) => send({ type: 'error', message: String((e && e.message) || e) }));

    ipcMain.handle('updater-check', async () => {
      try { const r = await autoUpdater.checkForUpdates(); return { ok: true, version: r && r.updateInfo && r.updateInfo.version }; }
      catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    });
    ipcMain.handle('updater-download', async () => {
      try { await autoUpdater.downloadUpdate(); return { ok: true }; }
      catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    });
    ipcMain.handle('updater-install', () => { try { autoUpdater.quitAndInstall(); } catch {} });
  } else {
    ipcMain.handle('updater-check', async () => ({ ok: false, error: 'unsupported' }));
    ipcMain.handle('updater-download', async () => ({ ok: false, error: 'unsupported' }));
    ipcMain.handle('updater-install', () => {});
  }

  ipcMain.on('set-opacity', (_e, v) => {
    if (!mainWindow) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    mainWindow.setOpacity(Math.min(1, Math.max(0.5, n)));
  });

  // ---- Handy (peek) mode ----
  // Target bounds for the collapsed sliver or the expanded panel, anchored to
  // the bottom of the work area (above the taskbar) at the chosen position.
  function handyTargetBounds(collapsed, position) {
    const disp = screen.getDisplayNearestPoint(mainWindow.getBounds());
    const wa = disp.workArea;
    const size = handyNormalBounds || mainWindow.getBounds();
    const W = collapsed ? HANDY_HANDLE_W : (size.width || 500);
    const H = collapsed ? HANDY_HANDLE_H : (size.height || 440);
    let x;
    if (position === 'left') x = wa.x + HANDY_EDGE_MARGIN;
    else if (position === 'right') x = wa.x + wa.width - W - HANDY_EDGE_MARGIN;
    else x = wa.x + Math.round((wa.width - W) / 2);
    // Both the collapsed line and the open panel float above the taskbar — the
    // panel's gap keeps its bottom edge grabbable for resizing (and off the taskbar).
    const gap = collapsed ? HANDY_BOTTOM_GAP : HANDY_EXPANDED_GAP;
    const y = wa.y + wa.height - H - gap;
    return { x, y, width: W, height: H };
  }

  // Manual bounds animation — Electron's setBounds({animate}) is macOS-only, so
  // we step x/y/width/height (and opacity) ourselves with an easeOutCubic curve.
  function animateHandyTo(to, duration, done, opacityTo) {
    if (!mainWindow) return;
    if (handyAnimTimer) { clearInterval(handyAnimTimer); handyAnimTimer = null; }
    const from = mainWindow.getBounds();
    const fromOp = mainWindow.getOpacity();
    const start = Date.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    handyAnimTimer = setInterval(() => {
      if (!mainWindow) { clearInterval(handyAnimTimer); handyAnimTimer = null; return; }
      const t = Math.min(1, (Date.now() - start) / (duration || 220));
      const e = ease(t);
      mainWindow.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.max(1, Math.round(from.width + (to.width - from.width) * e)),
        height: Math.max(1, Math.round(from.height + (to.height - from.height) * e))
      });
      if (typeof opacityTo === 'number') mainWindow.setOpacity(fromOp + (opacityTo - fromOp) * e);
      if (t >= 1) { clearInterval(handyAnimTimer); handyAnimTimer = null; if (done) done(); }
    }, 16);
  }

  ipcMain.handle('handy-enter', (_e, position) => {
    if (!mainWindow) return false;
    // A maximized window ignores setBounds on Windows, so the dock would never
    // shrink to its sliver. Drop back to the restored size first.
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    if (!handyActive) {
      handyNormalBounds = mainWindow.getBounds();
      handyPrevAlwaysOnTop = mainWindow.isAlwaysOnTop();
      handyPrevOpacity = mainWindow.getOpacity();
      handyActive = true;
      mainWindow.setMinimumSize(1, 1);
      mainWindow.setAlwaysOnTop(true, 'floating');
    }
    handyExpanded = false;
    // Snap straight to the collapsed sliver on the very first enter (startup),
    // then reveal — so a window created hidden appears already docked, with no
    // full-size flash. Later toggles (window already visible) animate normally.
    if (!mainWindow.isVisible()) {
      mainWindow.setBounds(handyTargetBounds(true, position));
      mainWindow.setOpacity(HANDY_COLLAPSED_OPACITY);
      mainWindow.showInactive();
    } else {
      animateHandyTo(handyTargetBounds(true, position), 220, null, HANDY_COLLAPSED_OPACITY);
    }
    return true;
  });

  ipcMain.handle('handy-exit', () => {
    if (!mainWindow || !handyActive) return false;
    const target = handyNormalBounds || mainWindow.getBounds();
    const prevAOT = handyPrevAlwaysOnTop;
    handyExpanded = false;
    // keep handyActive true through the animation so persistBounds stays paused
    animateHandyTo(target, 200, () => {
      if (!mainWindow) return;
      mainWindow.setMinimumSize(340, 300);
      mainWindow.setAlwaysOnTop(!!prevAOT, 'floating');
      mainWindow.setOpacity(handyPrevOpacity);
      handyActive = false;
      handyNormalBounds = null;
      handyPrevAlwaysOnTop = null;
    }, handyPrevOpacity);
    return true;
  });

  ipcMain.handle('handy-expand', (_e, payload) => {
    if (!mainWindow || !handyActive) return false;
    const position = typeof payload === 'string' ? payload : (payload && payload.position);
    const focus = payload && typeof payload === 'object' && payload.focus;
    handyExpanded = true;
    animateHandyTo(handyTargetBounds(false, position), 220, null, handyPrevOpacity);
    // 'click away' mode focuses the panel so a later click elsewhere blurs it shut
    if (focus) mainWindow.focus();
    return true;
  });

  ipcMain.handle('handy-collapse', (_e, position) => {
    if (!mainWindow || !handyActive) return false;
    handyExpanded = false;
    animateHandyTo(handyTargetBounds(true, position), 200, null, HANDY_COLLAPSED_OPACITY);
    return true;
  });

  ipcMain.handle('handy-set-position', (_e, payload) => {
    if (!mainWindow || !handyActive) return false;
    const position = payload && payload.position;
    const open = payload && payload.open;
    animateHandyTo(handyTargetBounds(!open, position), 160);
    return true;
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

  // Save any Prompt Lab media (image / audio / video) into IMAGES_DIR so the
  // existing ppimg:// protocol can serve it back. Larger cap for audio/video.
  const MEDIA_EXTS = [...IMG_EXTS, 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac',
    'mp4', 'webm', 'mov', 'mkv', 'm4v'];
  ipcMain.handle('save-media', (_e, base64, ext) => {
    ext = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!MEDIA_EXTS.includes(ext)) return null;
    if (typeof base64 !== 'string' || !base64 || base64.length > 340_000_000) return null; // ~250 MB
    try {
      const name = newImageName(ext);
      fs.writeFileSync(path.join(IMAGES_DIR, name), Buffer.from(base64, 'base64'));
      return { filename: name };
    } catch (err) {
      console.error('save-media failed', err);
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

  // Pull image bytes out of a Gemini "interactions" response regardless of
  // exactly which shape it comes back in (steps[].content[], interaction.
  // output_image, legacy inlineData, ...) — this API surface has changed
  // shape more than once, so match structurally instead of one fixed path.
  function findImagePart(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findImagePart(item);
        if (found) return found;
      }
      return null;
    }
    const data = node.data || (node.inlineData && node.inlineData.data);
    const mime = node.mime_type || node.mimeType ||
      (node.inlineData && (node.inlineData.mime_type || node.inlineData.mimeType));
    if (typeof data === 'string' && data.length > 100 && typeof mime === 'string' && mime.startsWith('image/')) {
      return { data, mimeType: mime };
    }
    for (const key of Object.keys(node)) {
      const found = findImagePart(node[key]);
      if (found) return found;
    }
    return null;
  }

  function extFromMime(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    return 'jpg';
  }

  // Free, keyless image API — GET returns raw image bytes directly.
  // private=true keeps generations out of Pollinations' public feed.
  function fetchPollinationsImage(prompt) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
        '?width=1024&height=1024&nologo=true&private=true';

      let req;
      try {
        req = net.request({ method: 'GET', url });
      } catch (err) {
        return finish({ ok: false, error: 'Could not start the request.' });
      }

      timer = setTimeout(() => { try { req.abort(); } catch {} }, 30_000);

      let bufs = [];
      let total = 0;

      req.on('response', (res) => {
        const statusCode = res.statusCode;
        const contentType = res.headers['content-type'] || res.headers['Content-Type'] || '';
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 10_000_000) {
            finish({ ok: false, error: 'Response was too large.' });
            try { req.abort(); } catch {}
            return;
          }
          bufs.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          if (statusCode === 429) {
            return finish({ ok: false, error: 'Rate limited — wait a bit before generating another image.' });
          }
          if (statusCode >= 400) {
            return finish({ ok: false, error: 'Image request failed (status ' + statusCode + ').' });
          }
          const mime = Array.isArray(contentType) ? contentType[0] : String(contentType);
          finish({ ok: true, buffer: Buffer.concat(bufs), ext: extFromMime(mime.split(';')[0].trim()) });
        });
      });

      req.on('abort', () => finish({ ok: false, error: 'Request timed out.' }));
      req.on('error', (err) => finish({ ok: false, error: err.message || 'Network error.' }));
      req.end();
    });
  }

  // Free (rate-limited) serverless inference — good-quality FLUX.1-schnell,
  // notably stronger than Pollinations' anonymous/fast tier. Needs a free
  // Hugging Face token with "Inference Providers" permission.
  function fetchHuggingFaceImage(prompt, apiKey) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      let req;
      try {
        req = net.request({
          method: 'POST',
          url: 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return finish({ ok: false, error: 'Could not start the request.' });
      }

      // Cold starts on the free tier can take a while the first time a
      // model spins up — give this one more room than the others.
      timer = setTimeout(() => { try { req.abort(); } catch {} }, 60_000);

      let bufs = [];
      let total = 0;

      req.on('response', (res) => {
        const statusCode = res.statusCode;
        const contentType = String(res.headers['content-type'] || res.headers['Content-Type'] || '');
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 10_000_000) {
            finish({ ok: false, error: 'Response was too large.' });
            try { req.abort(); } catch {}
            return;
          }
          bufs.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          if (statusCode >= 400) {
            let apiMsg = null;
            try { apiMsg = JSON.parse(Buffer.concat(bufs).toString('utf8')).error; } catch {}
            if (statusCode === 401 || statusCode === 403) {
              return finish({ ok: false, error: 'Hugging Face rejected the API token — check it in Settings.' });
            }
            if (statusCode === 503) {
              return finish({ ok: false, error: (apiMsg || 'Model is still loading') + ' — try again in a few seconds.' });
            }
            if (statusCode === 429) {
              return finish({ ok: false, error: 'Hugging Face rate limit hit — try again later.' });
            }
            return finish({ ok: false, error: apiMsg ? String(apiMsg).slice(0, 300) : 'Request failed (status ' + statusCode + ').' });
          }
          if (!contentType.startsWith('image/')) {
            return finish({ ok: false, error: 'Hugging Face returned an unexpected response.' });
          }
          finish({ ok: true, buffer: Buffer.concat(bufs), ext: extFromMime(contentType.split(';')[0].trim()) });
        });
      });

      req.on('abort', () => finish({ ok: false, error: 'Request timed out.' }));
      req.on('error', (err) => finish({ ok: false, error: err.message || 'Network error.' }));

      req.write(JSON.stringify({ inputs: prompt, parameters: { width: 1024, height: 1024 } }));
      req.end();
    });
  }

  function fetchGeminiImage(prompt, apiKey) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      let req;
      try {
        req = net.request({
          method: 'POST',
          url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return finish({ ok: false, error: 'Could not start the request.' });
      }

      timer = setTimeout(() => { try { req.abort(); } catch {} }, 30_000);

      let bufs = [];
      let total = 0;

      req.on('response', (res) => {
        const statusCode = res.statusCode;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 10_000_000) {
            finish({ ok: false, error: 'Gemini response was too large.' });
            try { req.abort(); } catch {}
            return;
          }
          bufs.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          let json = null;
          try { json = JSON.parse(Buffer.concat(bufs).toString('utf8')); } catch {}
          if (statusCode >= 400) {
            // Surface Gemini's own message where we have one (e.g. "quota
            // exceeded ... check your plan and billing details") instead of
            // a generic label — it's usually the only clue the user gets
            // for why a key that "should" be free just failed.
            const apiMsg = json && json.error && json.error.message;
            if (statusCode === 401 || statusCode === 403) {
              return finish({ ok: false, error: 'Gemini rejected the API key — check it in Settings.' });
            }
            if (apiMsg) {
              return finish({ ok: false, error: String(apiMsg).split('\n')[0].slice(0, 300) });
            }
            return finish({ ok: false, error: 'Gemini request failed (status ' + statusCode + ').' });
          }
          if (!json) {
            return finish({ ok: false, error: 'Gemini returned an unexpected response.' });
          }
          const part = findImagePart(json);
          if (!part) {
            return finish({ ok: false, error: "No image came back — the prompt may have been blocked by Gemini's safety filters." });
          }
          finish({ ok: true, buffer: Buffer.from(part.data, 'base64'), ext: extFromMime(part.mimeType) });
        });
      });

      req.on('abort', () => finish({ ok: false, error: 'Request timed out.' }));
      req.on('error', (err) => finish({ ok: false, error: err.message || 'Network error.' }));

      req.write(JSON.stringify({
        model: 'gemini-3.1-flash-image',
        input: [{ type: 'text', text: prompt }],
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '1:1' }
      }));
      req.end();
    });
  }

  ipcMain.handle('generate-image', async (_e, prompt, opts) => {
    prompt = String(prompt || '').trim().slice(0, 4000);
    if (!prompt) return { ok: false, error: 'Prompt is empty.' };
    const provider = opts && opts.provider;
    let res;
    if (provider === 'gemini') {
      const apiKey = String((opts && opts.geminiApiKey) || '').trim();
      if (!apiKey) return { ok: false, error: 'Add your Gemini API key in Settings first.' };
      res = await fetchGeminiImage(prompt, apiKey);
    } else if (provider === 'huggingface') {
      const apiKey = String((opts && opts.hfApiKey) || '').trim();
      if (!apiKey) return { ok: false, error: 'Add your Hugging Face token in Settings first.' };
      res = await fetchHuggingFaceImage(prompt, apiKey);
    } else {
      res = await fetchPollinationsImage(prompt);
    }
    if (!res.ok) return res;
    try {
      const name = newImageName(res.ext);
      fs.writeFileSync(path.join(IMAGES_DIR, name), res.buffer);
      return { ok: true, filename: name };
    } catch (err) {
      console.error('generate-image save failed', err);
      return { ok: false, error: 'Could not save the generated image.' };
    }
  });

  // Chat completion via the user's own free OpenRouter key (each user brings
  // their own key — Settings → AI). OpenRouter is OpenAI-compatible and works
  // from regions where Groq/OpenAI are geo-blocked, since the client only talks
  // to OpenRouter's proxy. Backs Improve, the AI actions menu, and AI Chat.
  // A short list of solid free instruct models (verified working from the
  // user's region). We DON'T use `openrouter/free` — its auto-router sometimes
  // picks non-chat models (e.g. a content-safety classifier). fetchAiChat tries
  // them in order and falls through to the next only when one is rate-limited.
  const OPENROUTER_MODELS = [
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free'
  ];
  async function fetchAiChat(messages, apiKey) {
    apiKey = String(apiKey || '').trim();
    if (!apiKey) return { ok: false, needsKey: true, error: 'Add a free OpenRouter key in Settings → AI.' };
    let last = { ok: false, error: 'The AI is busy right now — wait a moment and try again.' };
    for (const model of OPENROUTER_MODELS) {
      const res = await fetchAiChatOnce(messages, apiKey, model);
      if (res.ok) return res;
      last = res;
      if (!res.rateLimited) return res; // a real error (bad key, network) — stop here
    }
    return last; // every model was rate-limited
  }
  function fetchAiChatOnce(messages, apiKey, model) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      let req;
      try {
        req = net.request({
          method: 'POST',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://github.com/raminturne/promptpad',
            'X-Title': 'PromptPad'
          }
        });
      } catch (err) {
        return finish({ ok: false, error: 'Could not start the request.' });
      }

      timer = setTimeout(() => { try { req.abort(); } catch {} }, 40_000);

      let bufs = [];
      let total = 0;

      req.on('response', (res) => {
        const statusCode = res.statusCode;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 2_000_000) {
            finish({ ok: false, error: 'Response was too large.' });
            try { req.abort(); } catch {}
            return;
          }
          bufs.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          const body = Buffer.concat(bufs).toString('utf8');
          let json = null;
          try { json = JSON.parse(body); } catch {}
          if (statusCode >= 400) {
            const apiMsg = json && json.error &&
              (json.error.message || (json.error.metadata && json.error.metadata.raw) || json.error);
            if (statusCode === 401 || statusCode === 403) {
              return finish({ ok: false, error: 'The AI key was rejected — check it in Settings → AI.' });
            }
            if (statusCode === 429) {
              return finish({ ok: false, rateLimited: true, error: 'The AI is busy right now — wait a moment and try again.' });
            }
            return finish({ ok: false, error: apiMsg ? String(apiMsg).slice(0, 300) : 'Request failed (status ' + statusCode + ').' });
          }
          const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          if (typeof content !== 'string' || !content.trim()) {
            return finish({ ok: false, error: 'No text came back.' });
          }
          finish({ ok: true, text: content.trim() });
        });
      });

      req.on('abort', () => finish({ ok: false, error: 'Request timed out.' }));
      req.on('error', (err) => finish({ ok: false, error: err.message || 'Network error.' }));

      req.write(JSON.stringify({ model, messages, temperature: 0.7 }));
      req.end();
    });
  }

  // System prompts for each AI text action. All share the same rule: return
  // ONLY the transformed text, in the user's own language (except translate),
  // with no preamble/markdown/quotes.
  const AI_ACTION_PROMPTS = {
    improve:
      'You are an expert prompt engineer. The user will give you a draft prompt they intend to use with ' +
      'an AI system (image generator, chatbot, coding assistant, etc). Rewrite it to be clearer, more ' +
      'specific, and more effective, while preserving their original intent and language.',
    translate:
      'You are a translator. Detect the language of the text: if it is Persian (Farsi), translate it to ' +
      'natural English; if it is English (or any non-Persian language), translate it to natural, fluent ' +
      'Persian. Preserve meaning, tone, and any formatting/line breaks.',
    summarize:
      'You are an editor. Summarize the text concisely in the same language, keeping only the key points. ' +
      'Use a short paragraph or bullet points as appropriate.',
    grammar:
      'You are a proofreader. Fix spelling, grammar, and punctuation in the text without changing its ' +
      'meaning, tone, or language. Keep the wording as close to the original as possible.',
    'tone-professional':
      'Rewrite the text in a professional, polished tone, in the same language, keeping the same meaning.',
    'tone-casual':
      'Rewrite the text in a friendly, casual tone, in the same language, keeping the same meaning.',
    'tone-concise':
      'Rewrite the text to be as concise as possible, in the same language, without losing essential meaning.'
  };
  const AI_OUTPUT_RULE =
    ' Output ONLY the resulting text — no explanations, no preamble, no markdown code fences, and no ' +
    'surrounding quotation marks.';

  function runAiAction(action, text, apiKey) {
    const sys = AI_ACTION_PROMPTS[action];
    if (!sys) return Promise.resolve({ ok: false, error: 'Unknown action.' });
    text = String(text || '').trim().slice(0, 8000);
    if (!text) return Promise.resolve({ ok: false, error: 'Nothing to work on — the text is empty.' });
    return fetchAiChat([
      { role: 'system', content: sys + AI_OUTPUT_RULE },
      { role: 'user', content: text }
    ], apiKey);
  }

  ipcMain.handle('ai-transform', async (_e, payload) => {
    const action = payload && payload.action;
    const text = payload && payload.text;
    const apiKey = payload && payload.apiKey;
    return runAiAction(action, text, apiKey);
  });

  // Kept for back-compat with the existing improvePrompt bridge.
  ipcMain.handle('improve-prompt', async (_e, payload) => {
    // payload is { text, apiKey } (new) — tolerate a bare string too.
    const text = typeof payload === 'string' ? payload : (payload && payload.text);
    const apiKey = payload && typeof payload === 'object' ? payload.apiKey : '';
    return runAiAction('improve', text, apiKey);
  });

  ipcMain.handle('chat-message', async (_e, payload) => {
    const history = payload && payload.history;
    const apiKey = payload && payload.apiKey;
    if (!Array.isArray(history)) return { ok: false, error: 'Invalid message history.' };
    // Cap both turn count and per-message size so a long-running conversation
    // can't grow into an unbounded request.
    const turns = history.slice(-20).map((m) => ({
      role: m && m.role === 'assistant' ? 'assistant' : 'user',
      content: String((m && m.content) || '').slice(0, 4000)
    })).filter((m) => m.content);
    if (!turns.length) return { ok: false, error: 'Message is empty.' };
    return fetchAiChat([
      {
        role: 'system',
        content: 'You are a helpful, friendly assistant built into PromptPad, a notepad app for writing AI ' +
          'prompts. Keep replies concise and to the point.'
      },
      ...turns
    ], apiKey);
  });

  // Free (rate-limited) speech-to-text via Hugging Face's hosted Whisper —
  // same trusted provider already used for image generation. Whisper
  // auto-detects the spoken language, so no language param is sent.
  function fetchHuggingFaceTranscription(buffer, mimeType, apiKey) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      let req;
      try {
        req = net.request({
          method: 'POST',
          url: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': mimeType }
        });
      } catch (err) {
        return finish({ ok: false, error: 'Could not start the request.' });
      }

      // Transcription can take longer than a typical text/image call.
      timer = setTimeout(() => { try { req.abort(); } catch {} }, 60_000);

      let bufs = [];
      let total = 0;

      req.on('response', (res) => {
        const statusCode = res.statusCode;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 5_000_000) {
            finish({ ok: false, error: 'Response was too large.' });
            try { req.abort(); } catch {}
            return;
          }
          bufs.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          let json = null;
          try { json = JSON.parse(Buffer.concat(bufs).toString('utf8')); } catch {}
          if (statusCode >= 400) {
            if (statusCode === 401 || statusCode === 403) {
              return finish({ ok: false, error: 'Hugging Face rejected the API token — check it in Settings.' });
            }
            if (statusCode === 503) {
              return finish({ ok: false, error: 'Model is still loading — try again in a few seconds.' });
            }
            const apiMsg = json && json.error;
            return finish({ ok: false, error: apiMsg ? String(apiMsg).slice(0, 300) : 'Request failed (status ' + statusCode + ').' });
          }
          const text = json && typeof json.text === 'string' ? json.text.trim() : '';
          if (!text) return finish({ ok: false, error: "No speech detected — the prompt may have been blocked, or nothing was heard." });
          finish({ ok: true, text });
        });
      });

      req.on('abort', () => finish({ ok: false, error: 'Request timed out.' }));
      req.on('error', (err) => finish({ ok: false, error: err.message || 'Network error.' }));

      req.write(buffer);
      req.end();
    });
  }

  ipcMain.handle('transcribe-audio', async (_e, base64, mimeType, opts) => {
    if (typeof base64 !== 'string' || !base64 || base64.length > 40_000_000) {
      return { ok: false, error: 'Invalid or oversized audio.' };
    }
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return { ok: false, error: 'Could not decode audio.' };
    }
    const apiKey = String((opts && opts.hfApiKey) || '').trim();
    if (!apiKey) return { ok: false, error: 'Add your Hugging Face token in Settings first.' };
    return fetchHuggingFaceTranscription(buffer, mimeType || 'audio/webm', apiKey);
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

  // ---- Move / copy tabs and groups into another profile ----
  // Registered down here, not next to the other profile handlers, because it
  // needs safeStored/storedPath/newStoredName from the block above.
  //
  // Only a PARKED profile can be written. The active profile's workspace is
  // data.notes, live-owned by the renderer, so anything written there would be
  // clobbered by the next debounced save-notes. Ids arrive pre-freshened from
  // the renderer, which also remaps members' groupId for a group move.
  //
  // The tab shape below is a whitelist on purpose: it is the one place that
  // guarantees session-only junk (undoStack, redoStack, checkpointTimer) can
  // never reach another profile's workspace on disk.
  ipcMain.handle('copy-into-profile', (_e, payload) => {
    const data = ensureData();
    const targetId = payload && payload.targetId;
    const p = (data.profiles || []).find((x) => x.id === targetId);
    if (!p) return { ok: false, reason: 'missing' };
    if (targetId === data.activeProfileId) return { ok: false, reason: 'active' };

    const inTabs = Array.isArray(payload.tabs) ? payload.tabs : [];
    const inGroups = Array.isArray(payload.groups) ? payload.groups : [];
    if (!inTabs.length && !inGroups.length) return { ok: false, reason: 'empty' };
    const copying = payload.mode === 'copy';

    const ws = data.profileData[targetId] || emptyWorkspace();
    if (!Array.isArray(ws.tabs)) ws.tabs = [];
    if (!Array.isArray(ws.groups)) ws.groups = [];

    const tabs = inTabs.map((t) => {
      const files = (Array.isArray(t.files) ? t.files : []).map((f) => {
        if (!f || !safeStored(f.storedName)) return null;
        if (!copying) return f; // move: ownership transfers, the file stays put
        // Copy: the clone gets its own file on disk. delete-profile unlinks
        // storedNames with no refcount, so sharing one across two profiles
        // would make deleting either silently break the other's attachment.
        try {
          if (!fs.existsSync(storedPath(f.storedName))) return null;
          const nn = newStoredName(f.ext);
          fs.copyFileSync(storedPath(f.storedName), storedPath(nn));
          return { ...f, storedName: nn };
        } catch (err) {
          console.error('copy-into-profile: file copy failed', err);
          return null; // a missing attachment beats one that dies later
        }
      }).filter(Boolean);

      // Snapshots follow a move (same note, new home) but not a copy — the same
      // call duplicateTab has always made.
      const snaps = (!copying && Array.isArray(t.snapshots)) ? t.snapshots.slice(0, 15) : [];
      return {
        id: t.id, name: t.name || '', custom: !!t.custom, content: t.content || '',
        dir: t.dir || 'auto', align: t.align || 'auto', pinned: !!t.pinned,
        color: t.color || null, groupId: t.groupId || null, md: !!t.md,
        ...(files.length ? { files } : {}),
        ...(snaps.length ? { snapshots: snaps } : {})
      };
    });

    // Forced expanded: a group that arrives collapsed in a profile you aren't
    // looking at is effectively invisible.
    const groups = inGroups.map((g) => ({
      id: g.id, name: g.name || 'Group', collapsed: false,
      color: g.color || null, pinned: !!g.pinned
    }));

    ws.tabs.push(...tabs);
    ws.groups.push(...groups);
    data.profileData[targetId] = ws;
    if (!writeData(data)) return { ok: false, reason: 'write' };
    // Inline images (ppimg:// tokens in content) are deliberately left shared:
    // nothing ever reclaims IMAGES_DIR, so both profiles can point at one file.
    return { ok: true, tabs: tabs.length, groups: groups.length, profileName: p.name };
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
      const data = ensureData();
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
      const data = ensureData();
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
      // A pre-profiles backup has no profiles/shared keys; normalize it into one
      // profile here, because readData()'s cache means the migration would not
      // re-run in this process. Idempotent, so a newer backup passes straight
      // through.
      parsed = migrateProfiles(parsed);
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
    try { globalShortcut.unregister(quickCaptureAccel); } catch {}
    quickCaptureOn = !!enabled;
    if (!enabled) return false;
    try {
      return globalShortcut.register(quickCaptureAccel, triggerQuickCapture);
    } catch {
      return false;
    }
  });

  // Change the quick-capture accelerator; re-registers on the fly if it's on.
  // Returns whether it's active on the new combo (false if the combo is taken).
  ipcMain.handle('set-quick-capture-accel', (_e, accel) => {
    try { globalShortcut.unregister(quickCaptureAccel); } catch {}
    if (accel) quickCaptureAccel = accel;
    if (!quickCaptureOn) return false;
    try {
      return globalShortcut.register(quickCaptureAccel, triggerQuickCapture);
    } catch {
      return false;
    }
  });

  // Global (system-wide) show/hide for the handy dock. The renderer owns the
  // handy state, so the shortcut just forwards a toggle to it. Returns whether
  // registration succeeded so the settings UI can warn about a taken combo.
  ipcMain.handle('set-handy-shortcut', (_e, accel) => {
    if (handyAccel) { try { globalShortcut.unregister(handyAccel); } catch {} }
    handyAccel = null;
    if (!accel) return false;
    try {
      const ok = globalShortcut.register(accel, () => {
        if (mainWindow) mainWindow.webContents.send('toggle-handy');
      });
      if (ok) handyAccel = accel;
      return ok;
    } catch {
      return false;
    }
  });

  // What the handy shortcut does instead when handy mode is switched off in
  // Settings (Minimize / Send to tray). Both toggle, so the same key brings the
  // window back.
  ipcMain.handle('toggle-minimize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMinimized()) { mainWindow.restore(); mainWindow.focus(); }
    else mainWindow.minimize();
    return true;
  });

  ipcMain.handle('toggle-tray', () => {
    toggleWindowVisible();
    return true;
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

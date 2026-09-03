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
let handyAnimDone = null;  // `done` of the in-flight animation, so an interrupted one still finishes
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
// Set once the data file has been found unreadable in this process, so the
// damaged bytes are copied aside exactly once and the doomed parse isn't
// retried on every subsequent read.
let dataUnreadable = false;

function readData() {
  if (dataCache) return dataCache;
  if (dataUnreadable) return null;
  let raw = null;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf-8');
  } catch {
    // No file yet (fresh install) — nothing to recover, nothing to warn about.
    dataCache = null;
    return dataCache;
  }
  try {
    dataCache = migrateProfiles(JSON.parse(raw));
  } catch (err) {
    // The file EXISTS but won't parse. ensureData() is about to hand callers a
    // blank workspace and the next writeData() would overwrite the damaged
    // bytes for good, so keep a copy first — a truncated file is usually still
    // 99% recoverable by hand, an overwritten one never is.
    console.error('data file is unreadable, quarantining it:', err);
    dataUnreadable = true;
    try {
      fs.writeFileSync(DATA_FILE.replace(/\.json$/, '') + '.corrupt-' + Date.now() + '.json', raw);
    } catch (e2) {
      console.error('could not quarantine the damaged data file', e2);
    }
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

// Write through a temp file and rename into place. writeFileSync straight onto
// DATA_FILE truncates it first, so a crash / power cut / full disk during the
// write left a half-written file behind and the whole workspace was gone. A
// rename is atomic on both NTFS and POSIX, so the file on disk is always either
// the previous save or the complete new one.
//
// The payload is also written compactly rather than with 2-space indentation:
// this file is rewritten on a 350ms debounce while you type, and the pretty
// printing was adding ~30-40% to the bytes and to the stringify cost of every
// one of those writes. Exports (which a human may read) stay indented.
function writeData(data) {
  dataCache = data;
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (err) {
    console.error('Failed to save data:', err);
    try { fs.unlinkSync(tmp); } catch {}
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

  // The Glass theme needs Windows' own acrylic material, and that can only be
  // requested when the window is CREATED — calling setBackgroundMaterial later
  // leaves the window painting opaque black instead of compositing (verified
  // directly). So the saved theme is read here, and switching into or out of
  // Glass asks for a restart rather than pretending to apply live.
  const glassTheme = savedSettings.theme === 'glass' && process.platform === 'win32';

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
    ...(glassTheme ? { backgroundMaterial: 'acrylic' } : {}),
    backgroundColor: glassTheme ? '#00000000' : '#1B211A',
    alwaysOnTop: win.alwaysOnTop !== undefined ? win.alwaysOnTop : true,
    skipTaskbar: false,
    resizable: true,
    fullscreenable: true,
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

  // Real (OS-level) fullscreen, distinct from Maximize — it also covers the
  // taskbar, which Maximize deliberately leaves visible. Can also be entered
  // outside the app (macOS green-button, a window-manager shortcut), so the
  // renderer's glyph has to follow these events rather than only its own
  // toggle call, same reasoning as sendMaxState above.
  //
  // The state is taken from which event fired, NOT from re-reading
  // mainWindow.isFullScreen() inside the handler — on this platform that
  // getter hasn't caught up to the transition yet at the moment 'enter-
  // full-screen' fires, so it verifiably still reads false right as the
  // window enters fullscreen. The event name already says which way the
  // transition went, so there is nothing to look up.
  const sendFullscreenState = (isFull) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-change', isFull);
    }
  };
  mainWindow.on('enter-full-screen', () => sendFullscreenState(true));
  mainWindow.on('leave-full-screen', () => sendFullscreenState(false));

  // Window motion, forwarded so a theme can react to the window being dragged
  // — water slopes and slops, a scene rocks on its springs.
  //
  // Sent as a velocity, not a position. The renderer would otherwise have to
  // keep the previous position and the timestamp to difference them, and it
  // would get it wrong the first time the window is moved after a pause: the
  // gap since the last event would produce one enormous phantom shove. That
  // is what the 260ms guard below is for — a move that arrives long after the
  // last one starts a fresh drag rather than continuing an old one.
  //
  // Scaled to pixels per frame at 60Hz (dt in ms, times 16) so the effects can
  // treat it as a per-frame impulse without knowing anything about wall time.
  let lastMove = null;
  mainWindow.on('move', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    let x, y;
    try { [x, y] = mainWindow.getPosition(); } catch (err) { return; }
    const now = Date.now();
    if (lastMove && now - lastMove.t < 260) {
      const dt = Math.max(1, now - lastMove.t);
      const dx = (x - lastMove.x) * 16 / dt;
      const dy = (y - lastMove.y) * 16 / dt;
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
        mainWindow.webContents.send('window-shove', { dx, dy });
      }
    }
    lastMove = { x, y, t: now };
  });

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
  const { BrowserWindow, ipcMain, shell, Tray, Menu, dialog, net, globalShortcut, session, screen, Notification, desktopCapturer } = require('electron');

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
    // Same whitelist download-image / reveal-image use. Without it a crafted
    // name ("../../…") would read a file from outside IMAGES_DIR onto the
    // clipboard.
    if (typeof filename !== 'string' || !/^[a-z0-9._-]+$/i.test(filename) || filename.includes('..')) {
      return false;
    }
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

  ipcMain.handle('toggle-fullscreen', () => {
    if (!mainWindow) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });

  ipcMain.handle('is-fullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));

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

  // The Music theme reads the system mixer. Electron can satisfy a
  // getDisplayMedia request with audio:'loopback' on Windows, which captures
  // whatever the speakers are playing with no picker and no per-app
  // integration. A video source still has to be supplied even though the
  // renderer drops that track immediately — answering with video:false while
  // the caller asked for video aborts the whole capture.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (err) {
      console.error('display-media request failed', err);
      callback({});
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
  let lastUpdaterError = null;
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
    autoUpdater.on('error', (e) => {
      lastUpdaterError = String((e && e.message) || e);
      send({ type: 'error', message: lastUpdaterError });
    });

    ipcMain.handle('updater-check', async () => {
      try {
        const r = await autoUpdater.checkForUpdates();
        return { ok: true, version: r && r.updateInfo && r.updateInfo.version };
      } catch (e) {
        lastUpdaterError = String((e && e.message) || e);
        return { ok: false, error: lastUpdaterError };
      }
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

  // Why the in-app updater is or isn't running, so "it just opens GitHub" can
  // be answered from inside the app instead of guessed at. Two very different
  // situations produce the same visible behaviour — a build that can never
  // self-update (macOS, unpackaged) and one that tried and failed — and
  // without this they are indistinguishable to the person reporting it.
  ipcMain.handle('updater-status', () => ({
    supported: updaterSupported,
    reason: !autoUpdater ? 'module-missing'
      : !app.isPackaged ? 'dev-build'
        : process.platform === 'darwin' ? 'macos-unsigned'
          : null,
    platform: process.platform,
    lastError: lastUpdaterError
  }));

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
  //
  // An animation that is superseded before it finishes still has to run its
  // `done` bookkeeping. handy-exit puts the whole teardown (restore the minimum
  // size, the always-on-top flag, the opacity, and clear handyActive) in that
  // callback, so silently dropping it on interruption left the window stuck in
  // handy state — 1x1 minimum size, forced always-on-top, and every later
  // handy-* call believing a dock that is no longer there is still active.
  function flushHandyAnim() {
    if (!handyAnimTimer) return;
    clearInterval(handyAnimTimer);
    handyAnimTimer = null;
    const pending = handyAnimDone;
    handyAnimDone = null;
    if (pending) pending();
  }

  function animateHandyTo(to, duration, done, opacityTo) {
    if (!mainWindow) return;
    flushHandyAnim();
    const from = mainWindow.getBounds();
    const fromOp = mainWindow.getOpacity();
    const start = Date.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    handyAnimTimer = setInterval(() => {
      if (!mainWindow) { clearInterval(handyAnimTimer); handyAnimTimer = null; handyAnimDone = null; return; }
      const t = Math.min(1, (Date.now() - start) / (duration || 220));
      const e = ease(t);
      mainWindow.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.max(1, Math.round(from.width + (to.width - from.width) * e)),
        height: Math.max(1, Math.round(from.height + (to.height - from.height) * e))
      });
      if (typeof opacityTo === 'number') mainWindow.setOpacity(fromOp + (opacityTo - fromOp) * e);
      if (t >= 1) {
        clearInterval(handyAnimTimer);
        handyAnimTimer = null;
        handyAnimDone = null;
        if (done) done();
      }
    }, 16);
    handyAnimDone = done || null;
  }

  // ---- Temporary window growth ----
  // The theme board wants columns, and a 500x440 window can only show two. It
  // grows while the board is open and goes back the moment it is closed, so
  // nobody ends up with a resized window they did not ask for.
  //
  // Deliberately not reusing animateHandyTo: that one owns handyAnimTimer and
  // handyAnimDone, and a growth animation finishing would clear the teardown
  // callback a dock transition was relying on.
  let growSaved = null;
  let growTimer = null;

  function animateBoundsTo(to, duration) {
    if (!mainWindow) return;
    if (growTimer) { clearInterval(growTimer); growTimer = null; }
    const from = mainWindow.getBounds();
    const start = Date.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    growTimer = setInterval(() => {
      if (!mainWindow) { clearInterval(growTimer); growTimer = null; return; }
      const t = Math.min(1, (Date.now() - start) / (duration || 220));
      const e = ease(t);
      mainWindow.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.max(1, Math.round(from.width + (to.width - from.width) * e)),
        height: Math.max(1, Math.round(from.height + (to.height - from.height) * e))
      });
      if (t >= 1) { clearInterval(growTimer); growTimer = null; }
    }, 16);
  }

  ipcMain.handle('grow-window', (_e, wantW, wantH) => {
    // Never fight the dock, a maximised window, or full screen — in all three
    // the size is not ours to change.
    if (!mainWindow || handyActive || mainWindow.isMaximized() || mainWindow.isFullScreen()) return false;
    const cur = mainWindow.getBounds();
    if (cur.width >= wantW && cur.height >= wantH) return false;   // already big enough
    const area = screen.getDisplayNearestPoint(cur).workArea;
    const w = Math.min(Math.max(cur.width, wantW), area.width);
    const h = Math.min(Math.max(cur.height, wantH), area.height);
    // Grow around the window's own centre, then push it back inside the screen
    // rather than letting it hang off an edge.
    let x = Math.round(cur.x + (cur.width - w) / 2);
    let y = Math.round(cur.y + (cur.height - h) / 2);
    x = Math.min(Math.max(x, area.x), area.x + area.width - w);
    y = Math.min(Math.max(y, area.y), area.y + area.height - h);
    if (!growSaved) growSaved = cur;
    animateBoundsTo({ x, y, width: w, height: h }, 200);
    return true;
  });

  ipcMain.handle('restore-window', () => {
    if (!mainWindow || !growSaved) return false;
    const to = growSaved;
    growSaved = null;
    if (handyActive || mainWindow.isMaximized() || mainWindow.isFullScreen()) return false;
    animateBoundsTo(to, 200);
    return true;
  });

  ipcMain.handle('handy-enter', (_e, position) => {
    if (!mainWindow) return false;
    // Settle an exit animation that may still be mid-flight, so its teardown
    // runs BEFORE this enter re-arms handy state rather than after it.
    flushHandyAnim();
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

  // ---- Desktop notifications (shared-note invites) ----
  // The renderer only ever asks for one when the window isn't already the thing
  // the user is looking at — an invite that arrives while PromptPad is focused
  // just lights up the in-app bell. Clicking the toast brings the window forward.
  function revealWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  ipcMain.handle('notify', (_e, payload) => {
    const title = String((payload && payload.title) || 'PromptPad').slice(0, 120);
    const body = String((payload && payload.body) || '').slice(0, 300);
    // The taskbar flash is the part that survives "notifications off" in Windows
    // Focus Assist, so do it either way.
    try { if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true); } catch {}
    if (!Notification.isSupported()) return false;
    try {
      const n = new Notification({
        title,
        body,
        icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        silent: false
      });
      n.on('click', () => {
        revealWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('notification-click', payload && payload.kind);
        }
      });
      n.show();
      return true;
    } catch (err) {
      console.error('notify failed', err);
      return false;
    }
  });

  // The renderer clears the taskbar flash once the user actually looks at the app.
  ipcMain.on('stop-flash', () => {
    try { if (mainWindow) mainWindow.flashFrame(false); } catch {}
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
  // Image generation was removed in 3.9.
  //
  // Three back ends had been wired up and none of them could be relied on.
  // Hugging Face's hf-inference retired the only model the app called and
  // began answering 410. Google's image models return a hard 429 on a free
  // key — every quota they violate is named "-FreeTier", including the daily
  // one, so the allowance is zero rather than spent and no amount of waiting
  // helps. Pollinations worked but sends the prompt to a third party.
  //
  // Inserting, pasting and storing images is untouched — that is a different
  // feature and a working one. What has gone is only the part that asked a
  // remote service to invent a picture.

  // Chat completion via the user's own key — each user brings their own
  // (Settings → AI), so everyone gets their own rate limits. Backs Improve,
  // the AI actions menu, and AI Chat.
  //
  // Five backends, but only TWO wire protocols. OpenRouter, OpenAI, Google AI
  // Studio and any custom endpoint all speak OpenAI's chat-completions shape,
  // so they share one request/response path. Anthropic is the odd one out and
  // gets its own adapter — but it returns the same { ok, text, tryNext,
  // error } shape, so nothing above this line has to care which one ran.
  //
  // OpenRouter stays the default: it works from regions where OpenAI and Google
  // are geo-blocked, since the client only ever talks to OpenRouter's proxy.
  const AI_PROVIDERS = {
    openrouter: {
      family: 'openai',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      modelsUrl: 'https://openrouter.ai/api/v1/models',
      // Fallback list, used until the live one is fetched. Solid free instruct
      // models, verified working from the user's region.
      // We DON'T use `openrouter/free` — its auto-router sometimes picks
      // non-chat models (e.g. a content-safety classifier).
      models: [
        'google/gemma-4-26b-a4b-it:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free'
      ],
      headers: {
        'HTTP-Referer': 'https://github.com/raminturne/promptpad',
        'X-Title': 'PromptPad'
      },
      needsKey: 'Add a free OpenRouter key in Settings → AI.'
    },
    openai: {
      family: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      modelsUrl: 'https://api.openai.com/v1/models',
      models: ['gpt-4o-mini', 'gpt-4o'],
      headers: {},
      needsKey: 'Add an OpenAI API key in Settings → AI.'
    },
    google: {
      family: 'openai',
      // Google AI Studio publishes an OpenAI-compatible endpoint that takes the
      // AI Studio key as a bearer token, so it rides the shared path rather
      // than needing a Gemini-shaped adapter of its own.
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
      models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'],
      headers: {},
      needsKey: 'Add a Google AI Studio key in Settings → AI.'
    },
    anthropic: {
      family: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      modelsUrl: 'https://api.anthropic.com/v1/models',
      // Haiku first: it's the cheapest and fastest, which is the right default
      // for short text transforms. Note these need an API key from
      // console.anthropic.com — a Claude.ai Pro/Max subscription is a separate
      // product and cannot authenticate here.
      models: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'],
      headers: {},
      needsKey: 'Add an Anthropic API key in Settings → AI.'
    },
    custom: {
      family: 'openai',
      url: '', // both the URL and the model list come from settings
      models: [],
      headers: {},
      needsKey: 'Add your endpoint URL in Settings → AI.'
    }
  };

  // Merge a provider's static config with the per-request bits that only exist
  // in settings (the custom endpoint's URL, key and hand-typed model list).
  function resolveAiProvider(opts) {
    const id = AI_PROVIDERS[opts && opts.provider] ? opts.provider : 'openrouter';
    const cfg = { id, ...AI_PROVIDERS[id] };
    if (id === 'custom') {
      cfg.url = String((opts && opts.baseUrl) || '').trim();
      cfg.models = splitModels(opts && opts.models);
    }
    return cfg;
  }

  // Accepts either an array or the raw comma/newline-separated string the
  // settings field holds.
  function splitModels(v) {
    if (Array.isArray(v)) v = v.join(',');
    return String(v || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }

  // Renderer payloads used to be a bare API-key string. Tolerate that so an
  // older call site (or a stale renderer during an update) still works.
  function normalizeAiOpts(v) {
    if (typeof v === 'string') return { provider: 'openrouter', model: 'auto', apiKey: v };
    return v && typeof v === 'object' ? v : {};
  }

  async function fetchAiChat(messages, opts) {
    opts = normalizeAiOpts(opts);
    const apiKey = String(opts.apiKey || '').trim();
    const cfg = resolveAiProvider(opts);
    if (cfg.id === 'custom') {
      // A local runtime (Ollama, LM Studio) needs no key, so only the URL and
      // model list are actually required here.
      if (!cfg.url) return { ok: false, needsKey: true, error: cfg.needsKey };
      if (!cfg.models.length) {
        return { ok: false, needsKey: true, error: 'Add at least one model name in Settings → AI.' };
      }
    } else if (!apiKey) {
      return { ok: false, needsKey: true, error: cfg.needsKey };
    }

    // 'auto' keeps the original behaviour: walk the list, falling through to
    // the next model ONLY when one is rate-limited. Picking a model explicitly
    // means the user wants that model, so a rate-limit surfaces as an error
    // rather than silently switching to a different one behind their back.
    const wanted = String(opts.model || 'auto').trim();
    const models = wanted && wanted !== 'auto' ? [wanted] : cfg.models;
    if (!models.length) return { ok: false, error: 'No model is configured for this provider.' };

    // One model, with a couple of quick retries when the provider itself
    // wobbles (5xx). Without this a single Gemini 503 — which is routine on the
    // free tier — reached the user as a failed action.
    const TRANSIENT_TRIES = 3;
    const once = async (model) => {
      let res;
      for (let i = 0; i < TRANSIENT_TRIES; i++) {
        res = cfg.family === 'anthropic'
          ? await fetchAnthropicOnce(messages, apiKey, model, cfg)
          : await fetchAiChatOnce(messages, apiKey, model, cfg);
        if (res.ok || !res.transient) return res;
        // Back off with jitter so a retry doesn't land in the same overloaded
        // moment (and so two PromptPad windows don't sync up).
        if (i < TRANSIENT_TRIES - 1) await sleep(700 * Math.pow(2, i) + Math.random() * 400);
      }
      return res;
    };

    let last = { ok: false, error: 'The AI is busy right now — wait a moment and try again.' };
    for (const model of models) {
      const res = await once(model);
      if (res.ok) return res;
      last = res;
      if (!res.tryNext) return res; // a real error (bad key, network) — stop here
    }
    // Everything was busy. Say so in terms the user can act on, rather than
    // leaving the last provider-worded retry message as the final answer.
    if (last.transient && models.length > 1) {
      return { ok: false, error: 'Every model was busy just now — try again in a moment.' };
    }
    return last;
  }

  // Shared HTTP plumbing for every provider: POST JSON, 40s timeout, 2MB cap.
  // Resolves { status, json, body } on any completed response, or { error }.
  // Both adapters below build on this so the timeout/abort/size handling only
  // exists in one place.
  function postJson(url, headers, payload) {
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
          url,
          headers: { 'Content-Type': 'application/json', ...headers }
        });
      } catch (err) {
        return finish({ error: 'Could not start the request — check the endpoint URL.' });
      }

      timer = setTimeout(() => { try { req.abort(); } catch {} }, 40_000);

      let bufs = [];
      let total = 0;

      req.on('response', (res) => {
        const statusCode = res.statusCode;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 2_000_000) {
            finish({ error: 'Response was too large.' });
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
          finish({ status: statusCode, json, body });
        });
      });

      req.on('abort', () => finish({ error: 'Request timed out.' }));
      req.on('error', (err) => finish({ error: err.message || 'Network error.' }));

      try {
        req.write(JSON.stringify(payload));
        req.end();
      } catch (err) {
        finish({ error: 'Could not send the request.' });
      }
    });
  }

  // Map a non-2xx response onto our shared error shape. `label` names the
  // provider so a rejected key points at the right settings field.
  function aiHttpError(status, json, label) {
    const apiMsg = json && json.error &&
      (json.error.message || (json.error.metadata && json.error.metadata.raw) || json.error);
    if (status === 401 || status === 403) {
      return { ok: false, error: 'The ' + label + ' key was rejected — check it in Settings → AI.' };
    }
    if (status === 429) {
      return { ok: false, tryNext: true, error: 'You have hit this provider\'s rate limit — wait a moment and try again.' };
    }
    // A model this key can't reach, or one the provider has since retired.
    // Under `auto` that's a reason to try the next one, not to stop.
    if (status === 404) {
      return {
        ok: false, tryNext: true,
        error: "That model isn't available on your key — pick another in Settings → AI."
      };
    }
    // 5xx means the provider's own end wobbled, not that anything is wrong with
    // the request. Google's free tier throws 503 "model is overloaded" often
    // enough that treating it as a hard failure made Gemini look broken; 529 is
    // Anthropic's equivalent. These are worth retrying in place AND worth
    // falling through on, which is what `transient` marks.
    if (status >= 500) {
      const busy = status === 503 || status === 529;
      return {
        ok: false,
        tryNext: true,   // so `auto` still advances to the next model
        transient: true, // and so the same model is retried first
        error: busy
          ? label + ' is overloaded right now (' + status + ') — retrying.'
          : label + ' had a server error (' + status + ') — retrying.'
      };
    }
    return {
      ok: false,
      error: apiMsg ? String(apiMsg).slice(0, 300) : 'Request failed (status ' + status + ').'
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Live model lists ----------------------------------------------------
  // The hard-coded lists above are only a fallback. Model names go stale fast
  // (Google renames and retires them constantly), and a stale name reaches the
  // user as a confusing 404, so the real list is fetched with their own key and
  // the picker is built from that.
  function getJson(url, headers) {
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
      let req;
      try {
        req = net.request({ method: 'GET', url, headers: headers || {} });
      } catch (err) { return finish({ error: 'Could not start the request — check the endpoint URL.' }); }
      timer = setTimeout(() => { try { req.abort(); } catch {} }, 20_000);
      let bufs = [], total = 0;
      req.on('response', (res) => {
        res.on('data', (c) => {
          total += c.length;
          if (total > 4_000_000) { finish({ error: 'Model list was too large.' }); try { req.abort(); } catch {} return; }
          bufs.push(c);
        });
        res.on('end', () => {
          if (settled) return;
          let json = null;
          try { json = JSON.parse(Buffer.concat(bufs).toString('utf8')); } catch {}
          finish({ status: res.statusCode, json });
        });
      });
      req.on('abort', () => finish({ error: 'Request timed out.' }));
      req.on('error', (err) => finish({ error: err.message || 'Network error.' }));
      req.end();
    });
  }

  // Ids that are real models but can't hold a conversation — embeddings, audio,
  // image and moderation endpoints. Offering them in a chat picker only
  // produces a puzzling error later.
  const NON_CHAT_RE = /embed|whisper|tts|audio|realtime|dall-e|imagen|veo|moderation|rerank|aqa|vision-only|codestral-embed/i;

  function modelListHeaders(cfg, apiKey) {
    if (cfg.family === 'anthropic') {
      return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    }
    return apiKey ? { Authorization: 'Bearer ' + apiKey } : {};
  }

  // Every provider here returns OpenAI's { data: [{ id }] } envelope —
  // Anthropic's /v1/models does too — so one parser covers all of them.
  async function fetchModelList(opts) {
    opts = normalizeAiOpts(opts);
    const cfg = resolveAiProvider(opts);
    const apiKey = String(opts.apiKey || '').trim();

    let url = cfg.modelsUrl;
    if (cfg.id === 'custom') {
      // Derive /models from whatever chat URL they gave us.
      const base = String(opts.baseUrl || '').trim();
      if (!base) return { ok: false, error: 'Add your endpoint URL first.' };
      url = base.replace(/\/chat\/completions\/?$/, '/models');
      if (url === base) url = base.replace(/\/+$/, '') + '/models';
    }
    if (!url) return { ok: false, error: 'This provider has no model list.' };
    if (!apiKey && cfg.id !== 'openrouter' && cfg.id !== 'custom') {
      return { ok: false, needsKey: true, error: cfg.needsKey };
    }

    const res = await getJson(url, modelListHeaders(cfg, apiKey));
    if (res.error) return { ok: false, error: res.error };
    if (res.status >= 400) return { ok: false, ...aiHttpError(res.status, res.json, cfg.id) };

    const raw = res.json && (res.json.data || res.json.models);
    if (!Array.isArray(raw)) return { ok: false, error: 'That endpoint did not return a model list.' };

    const models = [];
    const seen = new Set();
    raw.forEach((m) => {
      // Google's OpenAI-compatible layer prefixes ids with "models/"; the chat
      // endpoint takes them bare, and bare is what our fallback list uses.
      let id = String((m && (m.id || m.name)) || '').replace(/^models\//, '').trim();
      if (!id || seen.has(id) || NON_CHAT_RE.test(id)) return;
      seen.add(id);
      const pricing = m && m.pricing;
      const free = /:free$/.test(id) ||
        !!(pricing && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0);
      models.push({ id, free });
    });
    if (!models.length) return { ok: false, error: 'No chat models came back.' };

    // Free first, then alphabetical — on OpenRouter that is the difference
    // between a usable picker and 400 unsorted ids.
    models.sort((a, b) => (a.free === b.free ? a.id.localeCompare(b.id) : (a.free ? -1 : 1)));
    return { ok: true, models };
  }

  ipcMain.handle('ai-list-models', async (_e, payload) => fetchModelList(payload && payload.ai));
  // --- Adapter A: OpenAI-compatible (OpenRouter, OpenAI, Google AI Studio, custom) ---
  async function fetchAiChatOnce(messages, apiKey, model, cfg) {
    const headers = { ...cfg.headers };
    // A local runtime may not want an Authorization header at all.
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

    const res = await postJson(cfg.url, headers, { model, messages, temperature: 0.7 });
    if (res.error) return { ok: false, error: res.error };
    if (res.status >= 400) return aiHttpError(res.status, res.json, 'AI');

    const json = res.json;
    const content = json && json.choices && json.choices[0] &&
      json.choices[0].message && json.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { ok: false, error: 'No text came back.' };
    }
    return { ok: true, text: content.trim() };
  }

  // --- Adapter B: Anthropic (Claude) ---
  // Four things differ from adapter A and each one is a hard failure if missed:
  //   * auth is `x-api-key` + `anthropic-version`, not a bearer token
  //   * the system prompt is a TOP-LEVEL field, not a message with role:system
  //   * the reply lives in content[] blocks, not choices[0].message.content
  //   * max_tokens is required
  // We also deliberately send NO `temperature`: sampling parameters are removed
  // on current Claude models and come back as a 400. Nothing else is sent
  // either (no thinking/effort config) — the defaults work on every Claude
  // model, whereas `effort` errors on the Haiku tier.
  async function fetchAnthropicOnce(messages, apiKey, model, cfg) {
    const list = Array.isArray(messages) ? messages : [];
    const system = list.filter((m) => m && m.role === 'system')
      .map((m) => String(m.content || '')).join('\n\n');
    const turns = list.filter((m) => m && m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '')
      }))
      .filter((m) => m.content);
    if (!turns.length) return { ok: false, error: 'Message is empty.' };

    const payload = { model, max_tokens: 8192, messages: turns };
    if (system) payload.system = system;

    const res = await postJson(cfg.url, {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }, payload);
    if (res.error) return { ok: false, error: res.error };
    if (res.status >= 400) return aiHttpError(res.status, res.json, 'Anthropic');

    const json = res.json;
    if (json && json.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined this request.' };
    }
    const block = json && Array.isArray(json.content) &&
      json.content.find((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim());
    if (!block) return { ok: false, error: 'No text came back.' };
    return { ok: true, text: block.text.trim() };
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

  // `opts.prompt` carries a user-written custom instruction; when it's absent
  // this falls back to the built-in prompt for `action`. Either way the shared
  // output rule is appended here, so a custom action can't come back wrapped in
  // a preamble or code fences.
  function runAiAction(action, text, opts) {
    opts = normalizeAiOpts(opts);
    const custom = String(opts.prompt || '').trim().slice(0, 2000);
    const sys = custom || AI_ACTION_PROMPTS[action];
    if (!sys) return Promise.resolve({ ok: false, error: 'Unknown action.' });
    text = String(text || '').trim().slice(0, 8000);
    if (!text) return Promise.resolve({ ok: false, error: 'Nothing to work on — the text is empty.' });
    return fetchAiChat([
      { role: 'system', content: sys + AI_OUTPUT_RULE },
      { role: 'user', content: text }
    ], opts);
  }

  ipcMain.handle('ai-transform', async (_e, payload) => {
    const action = payload && payload.action;
    const text = payload && payload.text;
    const opts = normalizeAiOpts(payload && (payload.ai || payload.apiKey));
    if (payload && payload.prompt) opts.prompt = payload.prompt;
    return runAiAction(action, text, opts);
  });

  // Kept for back-compat with the existing improvePrompt bridge.
  ipcMain.handle('improve-prompt', async (_e, payload) => {
    // payload is { text, ai } (new) — tolerate a bare string too.
    const text = typeof payload === 'string' ? payload : (payload && payload.text);
    const opts = typeof payload === 'object' && payload ? (payload.ai || payload.apiKey) : '';
    return runAiAction('improve', text, opts);
  });

  ipcMain.handle('chat-message', async (_e, payload) => {
    const history = payload && payload.history;
    const opts = normalizeAiOpts(payload && (payload.ai || payload.apiKey));
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
    ], opts);
  });

  // The renderer builds the model dropdown from this, so the catalog only ever
  // lives in one place and the two processes can't drift apart.
  ipcMain.handle('ai-providers', async () => {
    const out = {};
    Object.keys(AI_PROVIDERS).forEach((id) => {
      out[id] = { family: AI_PROVIDERS[id].family, models: AI_PROVIDERS[id].models.slice() };
    });
    return out;
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
      // A shared note follows a move — the renderer only sends these on a move,
      // because two tabs bound to one note would be two buffers for one text.
      const share = (!copying && typeof t.shareId === 'string') ? {
        shareId: t.shareId,
        shareRole: t.shareRole === 'viewer' ? 'viewer' : (t.shareRole === 'owner' ? 'owner' : 'editor'),
        shareOwner: String(t.shareOwner || ''),
        shareBase: typeof t.shareBase === 'string' ? t.shareBase : (t.content || ''),
        shareRev: Number(t.shareRev) || 0
      } : null;
      return {
        id: t.id, name: t.name || '', custom: !!t.custom, content: t.content || '',
        dir: t.dir || 'auto', align: t.align || 'auto', pinned: !!t.pinned,
        color: t.color || null, groupId: t.groupId || null, md: !!t.md,
        ...(files.length ? { files } : {}),
        ...(snaps.length ? { snapshots: snaps } : {}),
        ...(share || {})
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

  // ---- Rich export: formats that carry the note's inline images ----
  //
  // The plain 'export-note' handler above writes the note string verbatim, so
  // its ![img](ppimg://x.png) tokens are dead links outside the app. Every
  // format here either copies the image files out alongside the note, inlines
  // them as data: URIs, or renders them.

  // Same whitelist the ppimg:// protocol handler uses — nothing outside
  // IMAGES_DIR can ever be read, whatever the note text claims.
  function safeImageName(name) {
    return /^[a-z0-9._-]+$/i.test(name) && !name.includes('..') ? name : null;
  }

  const IMG_TOKEN_RE = /!\[img\]\(ppimg:\/\/([a-zA-Z0-9._-]+)(?:\|(\d+))?\)/g;

  // Take the images out of a note and leave clean text behind: a line that was
  // nothing but an image disappears entirely rather than becoming a blank one.
  function stripImageTokens(text) {
    return String(text || '')
      .split('\n')
      .map((line) => ({ line, rest: line.replace(IMG_TOKEN_RE, '') }))
      .filter(({ line, rest }) => rest.trim() || line === rest)
      .map(({ rest }) => rest.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

  const MIME_BY_EXT = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
  };

  function imageDataUri(file) {
    const safe = safeImageName(file);
    if (!safe) return null;
    const p = path.join(IMAGES_DIR, safe);
    if (!fs.existsSync(p)) return null;
    const mime = MIME_BY_EXT[path.extname(safe).toLowerCase()] || 'application/octet-stream';
    return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
  }

  // Render a payload from the renderer into a standalone HTML document. The
  // theme's custom properties travel with it, so the export looks like the
  // preview pane it came from rather than unstyled markup.
  function buildExportHtml(name, render, inlineImages) {
    let css = '';
    try { css = fs.readFileSync(path.join(__dirname, 'src', 'styles.css'), 'utf-8'); } catch {}
    let body = render.body || '';
    if (inlineImages) {
      body = body.replace(/src="ppimg:\/\/([a-zA-Z0-9._-]+)"/g, (m, file) => {
        const uri = imageDataUri(file);
        return uri ? 'src="' + uri + '"' : m;
      });
    }
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return '<!doctype html><html lang="en" dir="' + (render.dir === 'rtl' ? 'rtl' : 'ltr') + '">' +
      '<head><meta charset="utf-8"><title>' + esc(name) + '</title><style>' + css + '</style>' +
      '<style>:root{' + (render.vars || '') + '}' +
      // The app stylesheet pins html/body to the viewport and hides the
      // overflow — right for a desktop pane, fatal for an export: the page
      // would not scroll, the PDF would stop after page one and the PNG would
      // crop at the fold. Undo it so the document is as tall as its content.
      'html,body{height:auto;min-height:0;overflow:visible;user-select:text;}' +
      'body{margin:0;background:var(--bg,#fff);color:var(--text,#111);}' +
      // The preview pane is a scrolling flex child in the app; standalone it
      // just needs page padding and a readable measure.
      '.md-preview{position:static;flex:none;height:auto;max-height:none;' +
      'overflow:visible;padding:32px 36px;max-width:820px;margin:0 auto;}' +
      // Nothing may hide behind a scrollbar in an export — a PDF page and a
      // PNG have no way to scroll sideways. Code wraps instead of scrolling,
      // tables lay themselves out, and the language tag moves above the block
      // now that the copy button it shared the corner with is gone.
      '.md-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible;' +
      'padding-top:12px;}' +
      '.md-preview pre code{white-space:pre-wrap;overflow-wrap:anywhere;}' +
      '.md-preview table{display:table;max-width:100%;overflow:visible;}' +
      // break-word, not anywhere: a cell only splits a word when the word
      // itself cannot fit, so columns keep their natural widths
      '.md-preview th,.md-preview td{overflow-wrap:break-word;}' +
      '.md-code-lang{position:static;display:block;margin:0 0 4px 2px;}' +
      // keep blocks whole across PDF page breaks
      '@media print{.md-preview pre,.md-preview table,.md-preview blockquote,' +
      '.md-preview img,.md-preview .md-img{break-inside:avoid;}' +
      '.md-preview h1,.md-preview h2,.md-preview h3,.md-preview h4{break-after:avoid;}}' +
      (render.fullSizeImages ? '' : '.md-preview .md-img{max-width:100%;height:auto;}') +
      '</style></head><body class="' + (render.fullSizeImages ? 'md-img-fullsize' : '') + '">' +
      '<div class="md-preview" dir="' + (render.dir === 'rtl' ? 'rtl' : 'ltr') + '">' + body + '</div>' +
      '</body></html>';
  }

  // Load HTML into an offscreen window so it can be printed or captured. The
  // window uses the default session, so ppimg:// resolves there too.
  async function withRenderWindow(html, width, fn) {
    const win = new BrowserWindow({
      show: false,
      width,
      height: 900,
      // No preload, no node integration; the document is markdown our own
      // renderer escaped, so there is nothing script-like in it. JS stays on
      // only so the PNG path can measure the document height.
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      // give fonts and ppimg:// images a frame to settle before capturing
      await new Promise((r) => setTimeout(r, 350));
      return await fn(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  // Hard ceiling on an exported image, in CSS pixels — past this a PNG is
  // unusable anyway.
  const MAX_EXPORT_PX = 20000;

  // Chromium cannot rasterise a layer taller than ~16k DEVICE pixels: ask
  // capturePage for more and it hands back an empty 0x0 image, which is how a
  // long note came out cropped. Work out how tall one capture may safely be,
  // in CSS pixels, at this display's scale factor.
  function safeCaptureHeight() {
    let scale = 1;
    try { scale = screen.getPrimaryDisplay().scaleFactor || 1; } catch {}
    return Math.max(800, Math.floor(15000 / scale));
  }

  // Paste the viewport captures back together on a canvas inside the render
  // window itself — nativeImage has no compositing of its own.
  async function stitchSlices(win, slices, width, height) {
    const dataUrl = await win.webContents.executeJavaScript(
      '(' + function (parts, w, h) {
        return Promise.all(parts.map((p) => new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res({ im, top: p.top });
          im.onerror = rej;
          im.src = p.uri;
        }))).then((loaded) => {
          // capturePage works in device pixels; keep that resolution.
          const scale = loaded.length ? loaded[0].im.naturalWidth / w : 1;
          const c = document.createElement('canvas');
          c.width = Math.round(w * scale);
          c.height = Math.round(h * scale);
          const ctx = c.getContext('2d');
          loaded.forEach((l) => ctx.drawImage(l.im, 0, Math.round(l.top * scale)));
          return c.toDataURL('image/png');
        });
      }.toString() + ')(' + JSON.stringify(slices) + ',' + width + ',' + height + ')', true);
    return nativeImage.createFromDataURL(dataUrl);
  }

  // Capture the whole document as one image. Anything taller than one safe
  // capture is taken in viewport-sized slices and stitched back together.
  async function captureFullPage(html, width) {
    let truncated = false;
    const img = await withRenderWindow(html, width, async (win) => {
      // body's own box, not scrollHeight: the latter never reports less than
      // the viewport, which padded short notes with dead space.
      const measured = await win.webContents.executeJavaScript(
        'Math.ceil(document.body.getBoundingClientRect().height)' +
        ' || document.documentElement.scrollHeight', true);
      const total = Math.min(MAX_EXPORT_PX, Math.max(200, Math.ceil(measured)));
      truncated = Math.ceil(measured) > total;
      win.setContentSize(width, Math.min(total, safeCaptureHeight()));
      await new Promise((r) => setTimeout(r, 150));
      const viewH = win.getContentSize()[1];
      if (viewH >= total) return win.webContents.capturePage();

      const slices = [];
      for (let y = 0; y < total; y += viewH) {
        const top = Math.min(y, total - viewH);
        await win.webContents.executeJavaScript('window.scrollTo(0,' + top + ');0', true);
        await new Promise((r) => setTimeout(r, 90));
        slices.push({ top, uri: (await win.webContents.capturePage()).toDataURL() });
        if (top + viewH >= total) break;
      }
      return stitchSlices(win, slices, width, total);
    });
    return { img, truncated };
  }

  const EXPORT_FILTERS = {
    'md-assets': [{ name: 'Markdown', extensions: ['md'] }],
    'md-embed': [{ name: 'Markdown', extensions: ['md'] }],
    'md-text': [{ name: 'Markdown', extensions: ['md'] }],
    txt: [{ name: 'Text', extensions: ['txt'] }],
    html: [{ name: 'Web page', extensions: ['html'] }],
    pdf: [{ name: 'PDF', extensions: ['pdf'] }],
    png: [{ name: 'PNG image', extensions: ['png'] }]
  };
  const EXPORT_EXT = { 'md-assets': 'md', 'md-embed': 'md', 'md-text': 'md', txt: 'txt', html: 'html', pdf: 'pdf', png: 'png' };

  ipcMain.handle('export-note-rich', async (_e, payload) => {
    if (!mainWindow || !payload) return { ok: false };
    const { format, content, render } = payload;
    const safeName = String(payload.name || 'note')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'note';

    try {
      // Copy straight to the clipboard — no save dialog.
      if (format === 'clipboard-png') {
        if (!render) return { ok: false };
        const html = buildExportHtml(safeName, render, false);
        const shot = await captureFullPage(html, 900);
        clipboard.writeImage(shot.img);
        return { ok: true, truncated: shot.truncated };
      }

      const ext = EXPORT_EXT[format];
      if (!ext) return { ok: false };
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Export note',
        defaultPath: safeName + '.' + ext,
        filters: EXPORT_FILTERS[format]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const outPath = res.filePath;

      if (format === 'txt') {
        // strip the image tokens rather than leave unreadable ppimg:// text
        fs.writeFileSync(outPath, stripImageTokens(content), 'utf-8');
        return { ok: true, path: outPath };
      }

      // Markdown, text only — the note as written, minus the image tokens.
      // Nothing is embedded and nothing is copied alongside it, so the file
      // stays small and readable anywhere.
      if (format === 'md-text') {
        fs.writeFileSync(outPath, stripImageTokens(String(content || '')), 'utf-8');
        return { ok: true, path: outPath };
      }

      if (format === 'md-embed') {
        const out = String(content || '').replace(IMG_TOKEN_RE, (m, file) => {
          const uri = imageDataUri(file);
          return uri ? '![](' + uri + ')' : m;
        });
        fs.writeFileSync(outPath, out, 'utf-8');
        return { ok: true, path: outPath };
      }

      if (format === 'md-assets') {
        // "<name>-assets/" beside the .md, with relative links — the shape
        // GitHub, VS Code and Obsidian all render without any extra setup.
        const base = path.basename(outPath, path.extname(outPath));
        const dirName = base + '-assets';
        const assetsDir = path.join(path.dirname(outPath), dirName);
        let copied = 0;
        const out = String(content || '').replace(IMG_TOKEN_RE, (m, file) => {
          const safe = safeImageName(file);
          const src = safe && path.join(IMAGES_DIR, safe);
          if (!src || !fs.existsSync(src)) return m;
          if (!copied) { try { fs.mkdirSync(assetsDir, { recursive: true }); } catch {} }
          try { fs.copyFileSync(src, path.join(assetsDir, safe)); copied++; } catch { return m; }
          return '![](' + dirName + '/' + safe + ')';
        });
        fs.writeFileSync(outPath, out, 'utf-8');
        return { ok: true, path: outPath, images: copied };
      }

      if (!render) return { ok: false };

      if (format === 'html') {
        fs.writeFileSync(outPath, buildExportHtml(safeName, render, true), 'utf-8');
        return { ok: true, path: outPath };
      }

      const html = buildExportHtml(safeName, render, false);
      if (format === 'pdf') {
        const buf = await withRenderWindow(html, 900, (win) =>
          win.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
          }));
        fs.writeFileSync(outPath, buf);
        return { ok: true, path: outPath };
      }

      // png — the whole document, however tall it is
      const shot = await captureFullPage(html, 900);
      fs.writeFileSync(outPath, shot.img.toPNG());
      return { ok: true, path: outPath, truncated: shot.truncated };
    } catch (err) {
      console.error('export-note-rich failed', err);
      return { ok: false, error: String(err && err.message) };
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

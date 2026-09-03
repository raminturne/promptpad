const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', () => true);
  stub('load-settings', () => store.settings);
  stub('save-settings', () => true);
  stub('get-version', () => '3.8.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'D' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');

  const win = new BrowserWindow({
    width: 500, height: 560, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  win.webContents.on('console-message', (_e, l, m) => { if (l >= 2) console.log('CONSOLE: ' + m); });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  // Boot is not a fixed length of time, and waiting for the first render is not
  // enough: a later step of bootstrap() replaces the whole `settings` object,
  // which silently discards anything the driver has written and made these
  // runs fail about half the time. So plant a sentinel on `settings` and only
  // start once it has survived a beat — if the object was swapped, it is gone.
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = (src) => win.webContents.executeJavaScript(src, true);
  const ready = async () => {
    for (let i = 0; i < 150; i++) {
      try {
        const up = await evalJs(
          '(() => (typeof activeTab === "function" && !!activeTab()' +
          ' && !!settings && typeof settings.theme === "string"' +
          ' && document.querySelectorAll(".tab").length > 0))()');
        if (up) {
          await evalJs('(() => { settings.__driverReady = 1; return true; })()');
          await nap(700);
          if (await evalJs('(() => settings.__driverReady === 1)()')) return;
        }
      } catch (e) { /* renderer still parsing */ }
      await nap(120);
    }
    throw new Error('renderer never settled');
  };
  await ready();
  const NL = String.fromCharCode(10);
  const run = (s) => win.webContents.executeJavaScript('(async () => {' + NL + s + NL + '})()', true);

  await run('openSettings(); setSettingsPane("general"); return true;');
  await new Promise((r) => setTimeout(r, 300));
  require('fs').writeFileSync(require('path').join(__dirname, 'shot-fonts.png'),
    (await win.webContents.capturePage()).toPNG());
  console.log('tabs: ' + await run(
    'const t = document.getElementById("settingsTabs");' +
    'return JSON.stringify({scrollW: t.scrollWidth, clientW: t.clientWidth,' +
    ' overflows: t.scrollWidth > t.clientWidth + 1});'));
  const shot = async (pane, name) => {
    await run('setSettingsPane(' + JSON.stringify(pane) + '); return true;');
    await new Promise((r) => setTimeout(r, 500));
    require('fs').writeFileSync(require('path').join(__dirname, 'shot-' + name + '.png'),
      (await win.webContents.capturePage()).toPNG());
  };
  await run('settings.theme = "midnight"; applySettings(); return true;');
  await run([
    'await createVault("1234");',
    'state.tabs[0].locked = true;',
    'await lockNote(state.tabs[0].id);',
    'syncLockUI();',
    'return vaultExists();'
  ].join(NL));
  await new Promise((r) => setTimeout(r, 400));
  await shot('data', 'lock-settings');
  console.log('shots written');
  app.exit(0);
});

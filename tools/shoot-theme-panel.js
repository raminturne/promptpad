// Screenshot of the theme pane itself — the sections, the chips and the card
// sketches — which is the one part of the app no per-theme screenshot shows.
// Not part of the app.
//
//   electron tools/shoot-theme-panel.js [filter]
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const FILTER = process.argv[2] || '';
const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', () => true);
  stub('load-settings', () => store.settings);
  stub('save-settings', () => true);
  stub('get-version', () => '3.9.0');
  for (const ch of ['list-profiles', 'ai-providers', 'get-startup', 'get-always-on-top',
    'get-storage-path', 'grow-window', 'restore-window']) stub(ch, () => ({}));

  const win = new BrowserWindow({
    width: 900, height: 700, show: true, alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 120; i++) {
    try { if (await ev('(() => typeof activeTab === "function" && !!activeTab() && !!settings)()')) break; }
    catch (e) { /* still parsing */ }
    await nap(150);
  }
  await nap(900);

  // A couple of stars, so the Starred section is in the shot — it only exists
  // when the user has actually starred something.
  await ev('(() => { settings.favThemes = ["koi", "silk"];' +
    ' settings.seenThemes = Object.keys(PP_THEMES); return 1; })()');
  await ev('(() => { openSettings(); setSettingsPane("theme"); return 1; })()');
  await nap(1400);
  if (FILTER) {
    await ev('(() => { tbFilter = "' + FILTER + '"; renderThemeBrowser(); return 1; })()');
    await nap(1200);
  }

  const out = path.join(__dirname, 'shot-theme-panel' + (FILTER ? '-' + FILTER : '') + '.png');
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log('wrote ' + out);
  app.exit(0);
});

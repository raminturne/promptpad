// Forces the Last Train arrival and photographs it mid-pass. The train is on
// a counter that a burst of typing fills, so the driver types — there is no
// back door into a runtime's locals and there should not be one.
// Not part of the app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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
    width: 880, height: 600, show: true, alwaysOnTop: true,
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
  await nap(800);
  await ev('(() => { settings.theme = "lasttrain"; applySettings();' +
    ' const e = document.querySelector(".editor-area"); if (e) e.focus(); return 1; })()');
  await nap(900);

  const press = async (k) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
    win.webContents.sendInputEvent({ type: 'char', keyCode: k });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
    await nap(12);
  };
  for (let i = 0; i < 60; i++) await press('abcdefghij'[i % 10]);

  // Three frames across the pass, so the entry, the middle and the layering
  // against the platform furniture are all on record.
  for (const [name, wait] of [['1-arriving', 1400], ['2-passing', 2200], ['3-leaving', 2200]]) {
    await nap(wait);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'shot-train-' + name + '.png'), img.toPNG());
    console.log('wrote shot-train-' + name + '.png');
  }
  app.exit(0);
});

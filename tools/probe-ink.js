// One-off: types into a theme and reports what its canvas actually holds, at
// full resolution, so a "draws nothing" verdict can be checked against the
// pixels rather than against a downscale.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const THEME = process.argv[2] || 'typewriter';
const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('load-settings', () => store.settings);
  stub('save-notes', () => true);
  stub('save-settings', () => true);
  stub('get-version', () => '3.9.0');
  for (const ch of ['list-profiles', 'ai-providers', 'get-startup', 'get-always-on-top',
    'get-storage-path', 'grow-window', 'restore-window']) stub(ch, () => ({}));
  const win = new BrowserWindow({
    width: 760, height: 560, show: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 100; i++) {
    try { if (await ev('(() => !!window.settings && typeof activeTab === "function" && !!activeTab())()')) break; } catch (e) {}
    await nap(150);
  }
  await nap(900);
  await ev('(() => { settings.theme = "' + THEME + '"; applySettings(); return 1; })()');
  await nap(700);
  await ev('(() => { const e = document.querySelector(".editor-area"); if (e) e.focus(); return 1; })()');
  const press = async (k, ch) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
    if (ch !== false) win.webContents.sendInputEvent({ type: 'char', keyCode: k });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
    await nap(30);
  };
  for (const ch of 'hello there friend ') await press(ch === ' ' ? 'Space' : ch);
  const report = async (tag) => {
    const r = await ev(`(() => {
      const cs = [...document.querySelectorAll('#fxBack canvas, #fxLayer canvas')];
      return JSON.stringify(cs.map(c => {
        const g = c.getContext('2d', { willReadFrequently: true });
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0, maxA = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) n++; if (d[i] > maxA) maxA = d[i]; }
        return { cls: c.className, w: c.width, h: c.height, nonZero: n, maxAlpha: maxA };
      }));
    })()`);
    console.log(tag, r);
  };
  await report('right-after-typing');
  for (let i = 0; i < 8; i++) await press('Backspace', false);
  await report('after-deletes');
  await nap(400);
  await report('400ms-later');
  app.exit(0);
});

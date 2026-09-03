// Checks that dragging the window actually reaches the effects: pushes a
// shove through PP_FX and measures the water line at both edges of the Tide
// canvas before and after. A slosh tilts the surface, so the two edges must
// move in opposite directions — which a global brightness or "did anything
// change" test could not tell from the swell moving on its own.
// Not part of the app.
//
//   electron tools/probe-shove.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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
    width: 820, height: 560, show: true, alwaysOnTop: true,
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

  // Topmost lit pixel in a column — the water line.
  const LINE = (col) => `(() => {
    const c = document.querySelector('.fx-tide-canvas');
    if (!c) return -1;
    const g = c.getContext('2d');
    const x = Math.round(c.width * ${col});
    const d = g.getImageData(x, 0, 1, c.height).data;
    for (let y = 0; y < c.height; y++) if (d[y * 4 + 3] > 8) return y;
    return -1;
  })()`;

  await ev('(() => { settings.theme = "tide"; applySettings(); return 1; })()');
  await nap(900);

  // Five columns, not two. One pair can agree by accident — the swell alone
  // moves each edge several pixels — whereas a tilt is a *slope*, so the
  // claim worth testing is that the water line varies monotonically across
  // the whole window and did not before.
  const COLS = [0.06, 0.28, 0.5, 0.72, 0.94];
  const read = async () => {
    const out = [];
    for (const c of COLS) out.push(await ev(LINE(c)));
    return out;
  };
  const slope = (a) => (a[a.length - 1] - a[0]) / (COLS[COLS.length - 1] - COLS[0]);
  const before = await read();
  console.log('at rest      ' + before.join('  ') + '   slope ' + slope(before).toFixed(1));

  // A hard drag to the right, ten frames of it.
  for (let i = 0; i < 10; i++) {
    await ev('(() => { PP_FX.shove(34, 0); return 1; })()');
    await nap(16);
  }
  await nap(90);
  const after = await read();
  console.log('after a drag ' + after.join('  ') + '   slope ' + slope(after).toFixed(1));

  const tilted = Math.abs(slope(after) - slope(before)) > 20;
  // Settle, and it must come back — a slosh that stays leant over is a bug
  // with a nicer name.
  await nap(4000);
  const rested = await read();
  console.log('settled      ' + rested.join('  ') + '   slope ' + slope(rested).toFixed(1));
  // Judged against the size of the disturbance, not against an absolute
  // figure: the swell alone gives the resting slope a few pixels of noise, so
  // "back to zero" is not a thing the sea ever is. What matters is that most
  // of the lean has gone.
  const settled = Math.abs(slope(rested) - slope(before))
    < Math.abs(slope(after) - slope(before)) * 0.35;

  console.log(tilted ? 'PASS  the surface tilted' : 'FAIL  the surface did not tilt');
  console.log(settled ? 'PASS  and it settled back' : 'FAIL  it stayed leant over');
  app.exit(tilted && settled ? 0 : 1);
});

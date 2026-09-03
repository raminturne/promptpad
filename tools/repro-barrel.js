// Reproduces "picking Barrel Fire blanks the app". Drives it exactly the way
// a person would — through the theme board's own click handler — rather than
// by setting settings.theme, because those are different code paths and the
// screenshot driver only ever used the second one.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);
const NL = String.fromCharCode(10);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.9.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'D' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  // The real thing: the window animates to a new size when the theme pane
  // opens and animates back when it closes, which is a burst of resize events
  // straight through the runtime's rebuild.
  let saved = null, timer = null;
  const animateTo = (to) => {
    if (timer) clearInterval(timer);
    const from = win.getBounds();
    const t0 = Date.now();
    timer = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / 200);
      const e = 1 - Math.pow(1 - k, 3);
      win.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.round(from.width + (to.width - from.width) * e),
        height: Math.round(from.height + (to.height - from.height) * e)
      });
      if (k >= 1) { clearInterval(timer); timer = null; }
    }, 16);
  };
  stub('grow-window', (_e, w, h) => {
    const cur = win.getBounds();
    if (cur.width >= w && cur.height >= h) return false;
    if (!saved) saved = cur;
    animateTo({ x: cur.x, y: cur.y, width: w, height: h });
    return true;
  });
  stub('restore-window', () => {
    if (!saved) return false;
    const to = saved; saved = null;
    animateTo(to);
    return true;
  });

  const win = new BrowserWindow({
    width: 500, height: 440, show: true,   // the app's real default size
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, l, m) => {
    if (l >= 2) { errors.push(m); console.log('CONSOLE: ' + m); }
  });
  win.webContents.on('render-process-gone', (_e, d) => console.log('GONE ' + JSON.stringify(d)));

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 150; i++) {
    try {
      const up = await evalJs('(() => (typeof activeTab === "function" && !!activeTab() && !!settings))()');
      if (up) {
        await evalJs('(() => { settings.__driverReady = 1; return true; })()');
        await nap(700);
        if (await evalJs('(() => settings.__driverReady === 1)()')) break;
      }
    } catch (e) { /* still parsing */ }
    await nap(120);
  }
  const run = (s) => evalJs('(() => {' + NL + s + NL + '})()');

  // The console message alone says nothing about where; grab the stack.
  await run([
    'window.__trace = [];',
    'window.addEventListener("error", (ev) => {',
    '  window.__trace.push(String((ev.error && ev.error.stack) || ev.message));',
    '});',
    'return true;'
  ].join(NL));

  const state = () => run(
    'const cv = document.querySelector(".fx-retro-canvas");' +
    'const ed = document.getElementById("editor");' +
    'const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();' +
    '  return [b.width|0, b.height|0]; };' +
    'return JSON.stringify({' +
    ' fx: PP_FX.active(), theme: settings.theme,' +
    ' appClass: document.querySelector(".app").className,' +
    ' canvas: cv ? [cv.width, cv.height] : null,' +
    ' canvasBox: r(cv), editorBox: r(ed),' +
    ' backKids: document.getElementById("fxBack").children.length,' +
    ' layerKids: document.getElementById("fxLayer").children.length' +
    '});');

  await run('setEditorText("hello"); syncEditorToState(); return true;');
  console.log('before: ' + await state());

  // 1. the ordinary way: pick it off the board
  await run('openSettings(); setSettingsPane("theme"); return true;');
  await nap(500);
  await run('chooseTheme("nostalgia"); return true;');
  await nap(1600);
  console.log('after chooseTheme: ' + await state());
  fs.writeFileSync(path.join(__dirname, 'repro-1-chosen.png'),
    (await win.webContents.capturePage()).toPNG());

  await run('closeSettings(); return true;');
  await nap(900);
  console.log('after closeSettings: ' + await state());
  fs.writeFileSync(path.join(__dirname, 'repro-2-closed.png'),
    (await win.webContents.capturePage()).toPNG());

  // 2. switching away and back, which is where a shared-state bug would show
  await run('chooseTheme("midnight"); return true;');
  await nap(600);
  await run('chooseTheme("nostalgia"); return true;');
  await nap(1400);
  console.log('after round trip: ' + await state());

  // 3. quick double switch, to catch the deferred start racing itself
  await run('chooseTheme("sunset"); chooseTheme("nostalgia"); return true;');
  await nap(1600);
  console.log('after fast switch: ' + await state());
  fs.writeFileSync(path.join(__dirname, 'repro-3-fast.png'),
    (await win.webContents.capturePage()).toPNG());

  // 4. a resize while it runs
  win.setSize(1180, 760);
  await nap(1400);
  console.log('after resize: ' + await state());
  fs.writeFileSync(path.join(__dirname, 'repro-4-resize.png'),
    (await win.webContents.capturePage()).toPNG());

  // 5. leave it running, which is where anything cumulative would show
  win.setSize(500, 440);
  await nap(1200);
  await run('closeSettings(); return true;');
  for (let i = 0; i < 6; i++) {
    await nap(5000);
    const st = JSON.parse(await state());
    const px = await run(
      'const cv = document.querySelector(".fx-retro-canvas");' +
      'if (!cv) return "no canvas";' +
      'const g = cv.getContext("2d", { willReadFrequently: true });' +
      'const d = g.getImageData(0, 0, cv.width, cv.height).data;' +
      'let s = 0; for (let i = 0; i < d.length; i += 40) s += d[i] + d[i+1] + d[i+2];' +
      'return s;');
    const dbg = await run(
      'const cv = document.querySelector(".fx-retro-canvas");' +
      'return JSON.stringify({ raf: !!window.requestAnimationFrame,' +
      ' vis: document.visibilityState, w: cv && cv.width, h: cv && cv.height });');
    console.log('     ' + dbg);
    console.log('  soak ' + ((i + 1) * 5) + 's: fx=' + st.fx + ' canvas=' +
      JSON.stringify(st.canvas) + ' ink=' + px);
  }
  fs.writeFileSync(path.join(__dirname, 'repro-5-soak.png'),
    (await win.webContents.capturePage()).toPNG());

  console.log('=== TRACES ===');
  console.log(await run('return (window.__trace || []).slice(0, 3).join("  ###  ");'));
  console.log(errors.length ? errors.length + ' renderer errors' : 'no renderer errors');
  app.exit(0);
});

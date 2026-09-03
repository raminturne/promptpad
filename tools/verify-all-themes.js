// Sweeps every theme in the catalogue: applies it, lets it run, and checks
// that its runtime is the one the theme asked for and that it actually put
// ink on the canvas. Not part of the app.
//
//   npx electron tools/verify-all-themes.js            all 76
//   npx electron tools/verify-all-themes.js scope telex  just those two
//
// The "actually drew something" test is the point. A runtime that throws on
// its first frame still registers as active — `apply()` catches the throw at
// start() but a throw inside the rAF tick kills the loop silently and leaves
// a blank canvas behind. That is exactly the Barrel Fire bug, and it is
// invisible to every check that only looks at names.
//
// Themes that draw nothing of their own are listed in NO_CANVAS so the sweep
// does not demand pixels from them.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const store = { notes: {}, settings: {} };

function stub(ch, fn) { ipcMain.handle(ch, fn); }

// Themes with no canvas of their own. CRT is scanlines in CSS, Synesthesia
// only shifts the palette, and Music needs a system-audio capture that a
// headless run cannot get.
const NO_CANVAS = new Set(['basalt', 'vellum', 'crt', 'synesthesia', 'music']);

// Ones that build up slowly enough to need a longer look.
const SLOW = new Set(['cursive', 'silk', 'zen', 'ink', 'wound', 'filings',
  'ghost', 'kintsugi', 'blueprint', 'typewriter', 'mechanical']);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.9.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Default' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: 760, height: 580, show: true,
    // backgroundThrottling off, and always on top. Chromium throttles
    // requestAnimationFrame to a crawl when a window is occluded, and
    // `apply()` defers every runtime's start() by one frame — so a window
    // that something else covers halfway through a long sweep reports every
    // remaining theme as active with an empty layer. That is not a bug in
    // the themes and it cost a full run to work out.
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  // Errors are bucketed by the theme that was live when they arrived, so a
  // hundred-line sweep still says which theme broke.
  let phase = 'boot';
  const errors = [];
  win.webContents.on('console-message', (_e, level, m) => {
    // The willReadFrequently hint is provoked by this file's own readback,
    // not by the app, so it is not a finding.
    if (level >= 2 && !/willReadFrequently/.test(m)) errors.push(phase + ': ' + m);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const NL = String.fromCharCode(10);
  const evalJs = (src) => win.webContents.executeJavaScript(src, true);
  const run = (src) => evalJs('(() => {' + NL + src + NL + '})()', true);

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

  const results = [];
  const check = (n, ok, extra) =>
    results.push((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  — ' + extra : ''));

  // Put words in the note. Half the reactive themes key off the caret and
  // draw nothing at all into an empty editor.
  await run(
    'const ed = document.querySelector(".editor-area");' + NL +
    'if (ed) { ed.focus();' + NL +
    '  ed.textContent = "the quick brown fox jumps over the lazy dog";' + NL +
    '  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);' + NL +
    '  const s = getSelection(); s.removeAllRanges(); s.addRange(r); }' + NL +
    'return true;');

  // Real keystrokes, through Chromium's own input pipeline. A synthesised
  // KeyboardEvent is enough for the runtimes that only listen, but half of
  // them want the caret to have *moved* — a stroke paid out from where the
  // letter landed, a seam grown along the line, a ghost of a deleted word —
  // and a dispatched event inserts no text and shifts no caret. So type for
  // real, and delete for real, which is the only way Ghost sees anything.
  const press = async (keyCode, chars) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (chars !== false) win.webContents.sendInputEvent({ type: 'char', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await nap(28);
  };
  // Every canvas the runtime owns, summed. Reading back the alpha channel is
  // the only honest way to ask "did it draw" — a canvas with a live rAF loop
  // and a thrown exception looks identical to a working one from the DOM.
  //
  // Read at full resolution. The first version drew each canvas into a 96x96
  // scratch and counted that instead, which is a tenth of the memory and
  // reported Typewriter and Kintsugi as blank: drawImage from a canvas the
  // compositor is holding on the GPU into a willReadFrequently (software)
  // one came back empty here, and their marks are small enough that the
  // difference never showed on the themes that fill the window. A million
  // and a half pixels scanned in JS is about five milliseconds, which is
  // cheaper than being wrong.
  const INK = [
    'const cs = [...document.querySelectorAll("#fxBack canvas, #fxLayer canvas")];',
    'if (!cs.length) return JSON.stringify({ canvases: 0, ink: 0 });',
    'let ink = 0;',
    'for (const c of cs) {',
    '  try {',
    '    if (!c.width || !c.height) continue;',
    '    const g = c.getContext("2d");',
    '    if (!g) continue;',
    '    const d = g.getImageData(0, 0, c.width, c.height).data;',
    '    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;',
    '  } catch (e) { /* tainted, or a context this canvas does not have */ }',
    '}',
    'return JSON.stringify({ canvases: cs.length, ink });'
  ].join(NL);

  // Sampled *while* typing, not after it. Typewriter and Mechanical draw a
  // mark that fades in a couple of hundred milliseconds and Kintsugi grows a
  // seam only across a run of deletions — measuring once, half a second after
  // the last key, reported all three as blank canvases when what was actually
  // wrong was the stopwatch.
  const typeWords = async (sample) => {
    let best = { canvases: 0, ink: 0 };
    const keep = async () => {
      if (!sample) return;
      const r = JSON.parse(await run(INK));
      if (r.ink > best.ink) best = r;
      else if (r.canvases > best.canvases) best.canvases = r.canvases;
    };
    let n = 0;
    for (const ch of 'writing something more here ') {
      await press(ch === ' ' ? 'Space' : ch);
      if (++n % 5 === 0) await keep();
    }
    // Twenty, not ten. Kintsugi only opens a seam after sixteen deletions in
    // a row — that is the theme's own definition of a cut, and a driver that
    // stops at ten is testing that its own patience is shorter.
    for (let i = 0; i < 20; i++) {
      await press('Backspace', false);
      if (i % 4 === 3) await keep();
    }
    await keep();
    return best;
  };


  try {
    const themes = JSON.parse(await run(
      'return JSON.stringify(Object.keys(PP_THEMES).map(k => [k, PP_THEMES[k].fx || null, PP_THEMES[k].type]))'));
    const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
    const list = only.length ? themes.filter((r) => only.includes(r[0])) : themes;
    console.log('sweeping ' + list.length + ' themes');

    for (const [key, fx, type] of list) {
      phase = key;
      await run('settings.theme = "' + key + '"; applySettings(); return true;');
      await nap(SLOW.has(key) ? 900 : 520);

      await run('const ed = document.querySelector(".editor-area"); if (ed) ed.focus(); return true;');
      const want = fx && !NO_CANVAS.has(key);
      const peak = await typeWords(want);
      await nap(SLOW.has(key) ? 600 : 300);

      const active = await run('return PP_FX.active()');
      check(key + ' [' + type + '] runtime', active === fx,
        'wanted ' + fx + ', got ' + active);

      if (want) {
        const late = JSON.parse(await run(INK));
        const seen = late.ink > peak.ink ? late : peak;
        check(key + ' draws', seen.canvases > 0 && seen.ink > 0, JSON.stringify(seen));
      }
    }

    // Off the last theme entirely: nothing may be left running or on screen.
    phase = 'teardown';
    await run('settings.theme = "mono"; applySettings(); return true;');
    await nap(400);
    check('layers clean at the end',
      (await run('return document.querySelectorAll("#fxBack canvas, #fxLayer canvas").length')) === 0);
    check('no runtime left active', (await run('return PP_FX.active()')) === null);
  } catch (e) {
    check('sweep completed', false, e.message);
  }

  const fails = results.filter((r) => r.startsWith('FAIL'));
  console.log(fails.length ? fails.join('\n') : '(no failures)');
  console.log('\n' + (results.length - fails.length) + ' passing, ' + fails.length + ' failing');
  if (errors.length) console.log('\nconsole errors:\n' + errors.slice(0, 40).join('\n'));
  app.exit(fails.length || errors.length ? 1 : 0);
});

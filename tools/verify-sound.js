// Does the sample loader actually reach the files?
//
// loadSample() does fetch('sounds/rain.ogg') from a page served off file://,
// and Chromium blocks cross-file fetch by default. If it does, every sample
// silently fails — the try/catch swallows it and the theme quietly falls back
// to synthesis, so the app looks fine and the recordings are simply never
// heard. That is exactly the kind of failure a screenshot cannot show.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const store = { notes: {}, settings: {} };
const stub = (c, f) => ipcMain.handle(c, f);
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
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: 520, height: 460, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const evalJs = (s) => win.webContents.executeJavaScript(s, true);
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150; i++) {
    try {
      if (await evalJs('(() => (typeof activeTab === "function" && !!activeTab() && !!settings))()')) {
        await evalJs('(() => { settings.__driverReady = 1; return true; })()');
        await nap(700);
        if (await evalJs('(() => settings.__driverReady === 1)()')) break;
      }
    } catch (e) {}
    await nap(120);
  }

  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    (ok ? pass++ : fail++);
    console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : ''));
  };

  // 1. the raw question: can the renderer fetch a file next to itself?
  const raw = await evalJs([
    '(async () => {',
    '  try {',
    '    const r = await fetch("sounds/rain.ogg");',
    '    if (!r.ok) return "not ok: " + r.status;',
    '    const b = await r.arrayBuffer();',
    '    return "bytes:" + b.byteLength;',
    '  } catch (e) { return "threw: " + e.message; }',
    '})()'
  ].join(NL));
  check('fetch reaches sounds/rain.ogg', /^bytes:\d{5,}/.test(raw), raw);

  // 2. and can WebAudio decode what came back?
  const dec = await evalJs([
    '(async () => {',
    '  try {',
    '    const r = await fetch("sounds/rain.ogg");',
    '    const b = await r.arrayBuffer();',
    '    const ctx = new (window.AudioContext || window.webkitAudioContext)();',
    '    const buf = await ctx.decodeAudioData(b);',
    '    const out = buf.duration.toFixed(2) + "s @" + buf.sampleRate;',
    '    ctx.close();',
    '    return out;',
    '  } catch (e) { return "threw: " + e.message; }',
    '})()'
  ].join(NL));
  check('decodeAudioData accepts it', /^\d+\.\d+s @\d+/.test(dec), dec);

  // 3. every file the themes ask for, by the same path they use
  const names = ['rain', 'thunder', 'fire', 'key1', 'key2', 'key3', 'key4',
    'space', 'enter', 'back'];
  const found = await evalJs([
    '(async () => {',
    '  const out = {};',
    '  for (const n of ' + JSON.stringify(names) + ') {',
    '    out[n] = "-";',
    '    for (const ext of ["ogg", "mp3", "wav"]) {',
    '      try {',
    '        const r = await fetch("sounds/" + n + "." + ext);',
    '        if (r.ok) { out[n] = ext + ":" + (await r.arrayBuffer()).byteLength; break; }',
    '      } catch (e) { out[n] = "threw"; }',
    '    }',
    '  }',
    '  return JSON.stringify(out);',
    '})()'
  ].join(NL));
  const map = JSON.parse(found);
  for (const n of names) check('file present: ' + n, map[n] !== '-' && map[n] !== 'threw', map[n]);

  // 4. The part that matters: does a live theme end up playing the file, or
  //    does it fall through to synthesis anyway? The loader is inside a
  //    closure, so watch the thing it must do — a looping AudioBufferSource
  //    only exists if a file was decoded. Synthesis never creates one.
  await evalJs([
    '(() => {',
    '  window.__srcs = [];',
    '  const P = (window.AudioContext || window.webkitAudioContext).prototype;',
    '  const orig = P.createBufferSource;',
    '  P.createBufferSource = function () {',
    '    const s = orig.call(this);',
    '    const st = s.start.bind(s);',
    '    s.start = function (...a) {',
    '      window.__srcs.push({ loop: !!s.loop, dur: s.buffer ? +s.buffer.duration.toFixed(2) : 0 });',
    '      return st(...a);',
    '    };',
    '    return s;',
    '  };',
    '  PP_FX.setVolume(0.0001);',
    '  return true;',
    '})()'
  ].join(NL));

  const themeBed = async (theme, wantDur) => {
    await evalJs('(() => { window.__srcs = []; chooseTheme("' + theme + '"); return true; })()');
    await nap(2600);
    const got = JSON.parse(await evalJs('(() => JSON.stringify(window.__srcs))()'));
    const hit = got.find((s) => s.loop && Math.abs(s.dur - wantDur) < 0.2);
    check(theme + ' loops the recording', !!hit,
      hit ? hit.dur + 's looping' : 'sources: ' + JSON.stringify(got));
  };
  await themeBed('downpour', 20);
  await themeBed('hearth', 20);

  // Typing on the two keyboard themes has to reach for the key samples.
  const themeKeys = async (theme) => {
    await evalJs('(() => { chooseTheme("' + theme + '"); return true; })()');
    await nap(1400);
    await evalJs('(() => { window.__srcs = []; return true; })()');
    await evalJs([
      '(() => {',
      '  const ed = document.getElementById("editor");',
      '  if (ed) ed.focus();',
      '  for (const k of ["a", "b", "c", " ", "Enter", "Backspace"]) {',
      '    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));',
      '  }',
      '  return true;',
      '})()'
    ].join(NL));
    await nap(700);
    const got = JSON.parse(await evalJs('(() => JSON.stringify(window.__srcs))()'));
    // The key files are 0.13-0.26s; anything at those lengths came off disk.
    const shots = got.filter((s) => !s.loop && s.dur > 0.05 && s.dur < 0.4);
    check(theme + ' plays key recordings', shots.length >= 4,
      shots.length + ' sample one-shots of ' + got.length + ' sources');
  };
  await themeKeys('mechanical');
  await themeKeys('typewriter');

  console.log(NL + pass + ' passed, ' + fail + ' failed');
  app.exit(fail ? 1 : 0);
});

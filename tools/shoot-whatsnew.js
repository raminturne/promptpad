// Pictures for the "What's new" popup, taken from the running app into
// src/guide-images/. The fold is a motion, so it comes out as a GIF: the
// collapse is stepped by hand (the same max-height/opacity/transform the CSS
// animates) and each step is captured, which is the only way to record it
// frame by frame rather than at whatever speed a screenshot happens to land.
//
//   electron tools/shoot-whatsnew.js        (ffmpeg must be on PATH for the gif)
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --hd makes a big, sharp copy for posting somewhere, at twice the scale and
// without the two stills; the app's own picture stays small on purpose.
const HD = process.argv.includes('--hd');
const OUT = HD
  ? (process.env.HD_OUT || path.join(__dirname))
  : path.join(__dirname, '..', 'src', 'guide-images');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-whatsnew-'));
const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);
const NL = String.fromCharCode(10);
const S = (...lines) => lines.join(NL);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '4.2.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Work' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);

  const win = new BrowserWindow({
    width: HD ? 1180 : 720, height: HD ? 720 : 470, show: true, backgroundColor: '#000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true,
      zoomFactor: 1
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = (src) => win.webContents.executeJavaScript(src, true);
  const run = (src) => evalJs('(() => {' + NL + src + NL + '})()');

  for (let i = 0; i < 150; i++) {
    try {
      if (await evalJs('(() => typeof activeTab === "function" && !!settings)()')) break;
    } catch (e) { /* still parsing */ }
    await nap(120);
  }
  await nap(700);
  fs.mkdirSync(OUT, { recursive: true });

  // A workspace with enough tabs that the rail has something to show.
  console.log('workspace: ' + await run(S(
    'settings.theme = "next"; settings.animations = false;',
    'settings.railToolsCollapsed = false; settings.fastSaveEnabled = true;',
    'settings.aiChatEnabled = true; settings.promptLabEnabled = true;',
    'applySettings();',
    'const mk = (name, content) => ({ id: uid(), name, custom: true, content,',
    '  dir: "auto", align: "auto", color: null });',
    'state.tabs = [mk("Tea landing page", "Write a landing page for a tea company."),',
    '  mk("Release notes", "Summarise these commits for people who do not read code."),',
    '  mk("Interview questions", "Ten questions for a [role] candidate."),',
    '  mk("Cold email", "Rewrite this so it sounds warm and short."),',
    '  mk("Scratch", "ideas, unsorted")];',
    'state.activeId = state.tabs[0].id;',
    'renderTabs(); setEditorText(state.tabs[0].content); updateCounts();',
    'return state.tabs.length + " tabs";'
  )));
  await nap(400);

  // ---- 1. the fold, as a gif ----------------------------------------------
  // The strip captured is the rail and a little of the editor beside it, so
  // the tabs can be seen taking the space the buttons give up.
  const rect = await run(S(
    'const r = document.getElementById("rail").getBoundingClientRect();',
    'return { x: 0, y: 0, w: Math.round(r.width) + ' + (HD ? 330 : 150) + ', h: ' + (HD ? 690 : 420) + ' };'
  ));
  const clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };

  const shot = async (name, box) => {
    await nap(300);
    const img = await win.webContents.capturePage(box);
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log(name + ': ' + (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(0) + ' KB');
  };

  const H = await run('return railToolsEl.scrollHeight;');
  const steps = 16;
  const ease = (p) => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const frames = [];
  const grab = async (name) => {
    const img = await win.webContents.capturePage(clip);
    const f = path.join(TMP, name + '.png');
    fs.writeFileSync(f, img.toPNG());
    frames.push(f);
  };

  const setFold = (p) => run(S(   // p: 0 open .. 1 closed
    'const p = ' + p + ';',
    'railToolsEl.style.transition = "none";',
    'railToolsEl.style.maxHeight = (' + H + ' * (1 - p)) + "px";',
    'railToolsEl.style.opacity = String(1 - p);',
    'railToolsEl.style.transform = "translateY(" + (-6 * p) + "px)";',
    'document.querySelector(".rail-fold-chev").style.transform = "rotate(" + (180 * p) + "deg)";',
    'return true;'
  ));

  let n = 0;
  for (let i = 0; i < 8; i++) await grab('f' + String(n++).padStart(3, '0'));      // hold, open
  for (let i = 1; i <= steps; i++) { await setFold(ease(i / steps)); await grab('f' + String(n++).padStart(3, '0')); }
  for (let i = 0; i < 10; i++) await grab('f' + String(n++).padStart(3, '0'));     // hold, closed
  for (let i = steps - 1; i >= 0; i--) { await setFold(ease(i / steps)); await grab('f' + String(n++).padStart(3, '0')); }
  for (let i = 0; i < 6; i++) await grab('f' + String(n++).padStart(3, '0'));      // hold, open again
  await run('railToolsEl.style.cssText = ""; document.querySelector(".rail-fold-chev").style.transform = ""; return true;');
  console.log('fold frames: ' + frames.length);

  // 24 fps, halved in size: the card shows it at about 320px wide.
  const gif = path.join(OUT, HD ? 'fold-hd.gif' : 'new-fold.gif');
  const pal = path.join(TMP, 'pal.png');
  const fil = 'fps=24,scale=' + Math.round(rect.w * (HD ? 1 : 0.8)) + ':-1:flags=lanczos';
  let r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24',
    '-i', path.join(TMP, 'f%03d.png'), '-vf', fil + ',palettegen=max_colors=96', pal]);
  if (r.status === 0) {
    r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24',
      '-i', path.join(TMP, 'f%03d.png'), '-i', pal,
      '-lavfi', fil + ' [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', gif]);
  }
  console.log('gif: ' + (r.status === 0 ? (fs.statSync(gif).size / 1024).toFixed(0) + ' KB' : 'ffmpeg failed'));
  if (HD) {
    const mp4 = path.join(OUT, 'fold-hd.mp4');
    const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    const v = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24',
      '-i', path.join(TMP, 'f%03d.png'), '-vf', even + ',fps=30', '-c:v', 'libx264',
      '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    console.log('mp4: ' + (v.status === 0 ? (fs.statSync(mp4).size / 1024).toFixed(0) + ' KB' : 'ffmpeg failed'));
  }

  if (HD) { app.quit(); return; }

  // ---- the new face, whole-window ----------------------------------------
  // Wider than the rest: this card is the whole app, so it needs the rail, a
  // note with something in it, and the fill bar all in one frame.
  win.setContentSize(1000, 640);
  await nap(400);
  console.log('look: ' + await run(S(
    'settings.theme = "next"; settings.placeholderBarPosition = "right";',
    'const t = state.tabs[0];',
    't.name = "Landing page copy";',
    't.content = "Write a landing page for [product]." + String.fromCharCode(10) +',
    '  String.fromCharCode(10) + "Audience: [audience]" + String.fromCharCode(10) +',
    '  "Tone: warm, clear, confident." + String.fromCharCode(10) + String.fromCharCode(10) +',
    '  "## Structure" + String.fromCharCode(10) + String.fromCharCode(10) +',
    '  "1. One line that says what it is" + String.fromCharCode(10) +',
    '  "2. Three short paragraphs" + String.fromCharCode(10) + "3. A clear next step";',
    'state.activeId = t.id; applySettings(); showEditorView();',
    'setEditorText(t.content); editorLines().forEach(highlightLine);',
    'updatePlaceholderPanel(); renderTabs(); updateCounts();',
    'return settings.theme;'
  )));
  await nap(800);
  await shot('new-look.png');
  win.setContentSize(720, 470);
  await nap(400);

  // ---- 2. the password manager -------------------------------------------
  console.log('passwords: ' + await run(S(
    // A PIN exists in this picture, because that is the state worth showing:
    // every row encrypted. Nothing is ever decrypted for a screenshot.
    'settings.vault = { v: 1, salt: "x", wrapPin: { iv: "x", ct: "x" } };',
    'const e = (len) => ({ iv: "x", ct: "x", len });',
    'state.passwords = [',
    '  { id: "p1", site: "github.com", user: "ramin@example.com", enc: e(16), len: 16, created: Date.now() },',
    '  { id: "p2", site: "figma.com", user: "ramin@example.com", enc: e(12), len: 12, created: Date.now() },',
    '  { id: "p3", site: "openrouter.ai", user: "raminturne", enc: e(18), len: 18, created: Date.now() },',
    '  { id: "p4", site: "my router", user: "admin", enc: e(10), len: 10, created: Date.now() }',
    '];',
    'openPasswords(); pwSearchEl.value = "git"; pwFilter = "git"; renderPwList();',
    'return state.passwords.length + " logins";'
  )));
  await shot('new-passwords.png');

  // ---- 3. my tokens -------------------------------------------------------
  console.log('tokens: ' + await run(S(
    'closePasswords();',
    'state.tokens = [',
    '  { id: "t1", name: "OpenRouter", token: "sk-or-v1-0000placeholder0000", created: Date.now() },',
    '  { id: "t2", name: "OpenAI", token: "sk-proj-0000placeholder0000", created: Date.now() },',
    '  { id: "t3", name: "Google AI Studio", token: "AIza0000placeholder0000", created: Date.now() }',
    '];',
    'openTokens();',
    'return state.tokens.length + " tokens";'
  )));
  await nap(500);
  await shot('new-tokens.png');

  app.quit();
});

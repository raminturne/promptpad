// Rebuilds screenshots/banner.png — the picture at the top of the README.
//
//   electron tools/make-banner.cjs
//
// Two phases in one process: shoot the real app on the Next theme into a temp
// folder, then lay those shots out on a 1920x912 page with the mark and the
// line, and capture that. The windows in the banner are therefore the app, not
// a drawing of it.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-banner-'));
const OUT = path.join(ROOT, 'screenshots', 'banner.png');
const NL = String.fromCharCode(10);
const S = (...l) => l.join(NL);
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const store = { notes: {}, settings: {} };
const stub = (c, f) => ipcMain.handle(c, f);

const LAB = [
  { id: 'l1', ts: Date.now(), title: 'Landing page hero', category: 'website',
    prompt: 'Design a landing page hero for [product]: headline, subhead, one primary button.' },
  { id: 'l2', ts: Date.now(), title: 'Cinematic portrait', category: 'image',
    prompt: 'Cinematic portrait of [subject], 85mm, rim light, muted palette, film grain.' },
  { id: 'l3', ts: Date.now(), title: 'Boss fight loop', category: 'game',
    prompt: 'Design a boss fight for a [genre] game: three phases, one tell per attack.' },
  { id: 'l4', ts: Date.now(), title: 'Refactor plan', category: 'software',
    prompt: 'Read this module and propose a refactor in five steps.' }
];
const CHAT = [
  { id: 'c1', ts: Date.now() - 4e5, role: 'user', text: 'Make this prompt sharper.' },
  { id: 'c2', ts: Date.now() - 3e5, role: 'assistant',
    text: 'Name the length, the audience and the format, then leave the rest as blanks:\n\n"Write a [length] launch note for [audience]. Three short paragraphs, one clear next step."' }
];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '4.3.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Work' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);
  stub('get-storage-path', () => '');
  stub('grow-window', () => false);
  stub('restore-window', () => false);
  stub('is-maximized', () => false);
  stub('is-fullscreen', () => false);

  // ---------------------------------------------------------- phase 1: shots
  const win = new BrowserWindow({
    width: 940, height: 620, useContentSize: true, show: true, backgroundColor: '#202120',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  win.webContents.setZoomFactor(1);
  const ev = (s) => win.webContents.executeJavaScript(s, true);
  const run = (s) => ev('(() => {' + NL + s + NL + '})()');
  for (let i = 0; i < 150; i++) {
    try { if (await ev('(() => typeof activeTab === "function" && !!settings)()')) break; } catch (e) {}
    await nap(120);
  }
  await nap(800);

  console.log('seed: ' + await run(S(
    'settings.theme = "next"; settings.animations = false; settings.railWidth = 190;',
    'settings.placeholderBarPosition = "right"; settings.promptLabEnabled = true;',
    'settings.aiChatEnabled = true; settings.fastSaveEnabled = true;',
    'settings.whatsNewSeen = "4.3.0"; settings.lastVersion = "4.3.0"; settings.donateSeenVersion = "4.3.0";',
    'settings.ai = { provider: "openrouter", openrouterKey: "sk-or-v1-placeholder-not-a-real-key" };',
    'const mk = (name, content) => ({ id: uid(), name, custom: true, content,',
    '  dir: "auto", align: "auto", color: null });',
    'state.tabs = [mk("Landing page copy", "Write a landing page for [product]." + String.fromCharCode(10) +',
    '  String.fromCharCode(10) + "Audience: [audience]" + String.fromCharCode(10) +',
    '  "Tone: warm, clear, confident." + String.fromCharCode(10) + String.fromCharCode(10) +',
    '  "## Structure" + String.fromCharCode(10) + String.fromCharCode(10) +',
    '  "1. One line that says what it is" + String.fromCharCode(10) +',
    '  "2. Three short paragraphs" + String.fromCharCode(10) + "3. A clear next step"),',
    '  mk("System prompt v3", "You are a careful editor."), mk("Release notes", "Summarise these commits."),',
    '  mk("Interview questions", "Ten questions for a [role]."), mk("Scratch", "ideas, unsorted")];',
    'state.promptLab = ' + JSON.stringify(LAB) + ';',
    'state.aiChat = { messages: ' + JSON.stringify(CHAT) + ' };',
    'state.activeId = state.tabs[0].id;',
    'applySettings(); showEditorView(); setEditorText(state.tabs[0].content);',
    'editorLines().forEach(highlightLine); updatePlaceholderPanel(); renderTabs(); updateCounts();',
    'return state.tabs.length + " tabs";'
  )));
  await nap(900);

  const shot = async (name) => {
    await nap(400);
    const f = path.join(TMP, name + '.png');
    fs.writeFileSync(f, (await win.webContents.capturePage()).toPNG());
    console.log('  ' + name);
    return f;
  };
  const files = {};
  files.editor = await shot('editor');
  await run('switchToLab(); return true;'); await nap(900);
  files.lab = await shot('lab');
  await run('switchToAiChat(); return true;'); await nap(900);
  files.chat = await shot('chat');

  // ------------------------------------------------------- phase 2: the page
  const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const mark = 'data:image/svg+xml;base64,' +
    fs.readFileSync(path.join(ROOT, 'src', 'logo-next.svg')).toString('base64');

  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: x; src: local("Segoe UI Variable Display"), local("Segoe UI"); }
    html, body { margin: 0; width: 1920px; height: 912px; overflow: hidden; background: #0d0e0d; }
    .bg { position: absolute; inset: 0;
      background:
        radial-gradient(70% 90% at 78% 18%, rgba(233,234,229,.10), transparent 60%),
        radial-gradient(60% 70% at 12% 85%, rgba(233,234,229,.05), transparent 65%),
        linear-gradient(160deg, #15161500 0%, #0b0c0b 100%), #111211; }
    .grid { position: absolute; inset: 0; opacity: .35;
      background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 72px 72px;
      mask-image: radial-gradient(70% 70% at 30% 50%, #000 20%, transparent 80%);
      -webkit-mask-image: radial-gradient(70% 70% at 30% 50%, #000 20%, transparent 80%); }
    .copy { position: absolute; left: 104px; top: 262px; width: 700px;
      font-family: "Segoe UI Variable Display", "Segoe UI", Inter, sans-serif; color: #f1f1ec; }
    .brand { display: flex; align-items: center; gap: 20px; }
    .brand img { width: 84px; height: 84px; border-radius: 20px; }
    .brand b { font-size: 64px; font-weight: 600; letter-spacing: -1.6px; }
    .tag { margin-top: 30px; font-size: 27px; line-height: 1.5; color: #c9cac4; letter-spacing: -.2px; }
    .feats { margin-top: 34px; display: flex; gap: 10px; flex-wrap: wrap; }
    .feats span { font-size: 15px; letter-spacing: .4px; color: #a2a49e; text-transform: uppercase;
      border: 1px solid rgba(241,241,236,.16); border-radius: 999px; padding: 7px 15px; }
    .shots { position: absolute; inset: 0; }
    .w { position: absolute; border-radius: 12px; overflow: hidden;
      box-shadow: 0 50px 120px rgba(0,0,0,.72), 0 0 0 1px rgba(255,255,255,.07);
      transform-origin: 50% 50%; }
    .w img { display: block; width: 100%; height: auto; }
    /* three windows, fanned out, the active one in front */
    .w1 { width: 790px; left: 858px; top: 288px; transform: perspective(2600px) rotateY(-14deg) rotate(-1.5deg); }
    .w2 { width: 720px; left: 1148px; top: 178px; transform: perspective(2600px) rotateY(-14deg) rotate(-1.5deg); }
    .w3 { width: 660px; left: 1382px; top: 92px; transform: perspective(2600px) rotateY(-14deg) rotate(-1.5deg); }
    .fade { position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(95deg, rgba(13,14,13,.95) 20%, rgba(13,14,13,.25) 44%, rgba(13,14,13,0) 56%); }
  </style>
  <div class="bg"></div><div class="grid"></div>
  <div class="shots">
    <div class="w w3"><img src="${b64(files.lab)}"></div>
    <div class="w w2"><img src="${b64(files.chat)}"></div>
    <div class="w w1"><img src="${b64(files.editor)}"></div>
  </div>
  <div class="fade"></div>
  <div class="copy">
    <div class="brand"><img src="${mark}"><b>PromptPad</b></div>
    <div class="tag">A desktop notepad built for writing AI prompts.<br>
      Blanks you fill in when you use them, a library of the ones that worked,
      and a window that stays on top of your work.</div>
    <div class="feats"><span>Tabs</span><span>Blocks</span><span>Blanks</span>
      <span>Prompt Lab</span><span>AI Chat</span><span>78 themes</span></div>
  </div>`;

  const page = new BrowserWindow({
    width: 1920, height: 912, useContentSize: true, show: false, frame: false,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  page.setContentSize(1920, 912);
  await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await nap(1400);
  const img = await page.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, img.toPNG());
  console.log('banner: ' + img.getSize().width + 'x' + img.getSize().height +
    ', ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB -> ' + OUT);
  app.quit();
});

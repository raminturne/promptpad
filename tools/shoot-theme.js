// Screenshot driver for a theme: loads the renderer, switches to the theme
// named on the command line, types into the note so the effect has something
// to react to, and writes a PNG. Not part of the app.
//
//   electron tools/shoot-theme.js fountain [frames-delay-ms]
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const THEME = process.argv[2] || 'fountain';
const SETTLE = Number(process.argv[3] || 1400);
const store = { notes: {}, settings: {} };

function stub(ch, fn) { ipcMain.handle(ch, fn); }

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.8.0');
  stub('list-profiles', () => ({ ok: true, profiles: [{ id: 'p1', name: 'Default' }], activeId: 'p1' }));
  stub('ai-providers', () => ({ providers: [] }));
  stub('get-startup', () => false);
  stub('get-always-on-top', () => true);

  const win = new BrowserWindow({
    width: 880, height: 600, show: true,
    // Kept on top and unthrottled. An occluded window has its
    // requestAnimationFrame throttled to a crawl, so an effect that starts on
    // the next frame never starts at all — and capturePage on a fully covered
    // window returns an empty bitmap, which lands as a zero-byte PNG that
    // looks like a driver bug rather than a hidden window.
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, m) => { if (level >= 2) errors.push(m); });

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
  const run = (src) =>
    win.webContents.executeJavaScript('(() => {' + NL + src + NL + '})()', true);

  await run([
    'settings.theme = ' + JSON.stringify(THEME) + ';',
    'applySettings();',
    'switchTab(orderedTabs()[0].id);',
    'setEditorText("Design a landing page for a tea company." + String.fromCharCode(10) +',
    '  "Calm, unhurried, and it should smell like the shop." + String.fromCharCode(10) +',
    '  "Audience: [who]. Tone: [tone|warm, plain, poetic].");',
    'syncEditorToState(); updateCounts(); updatePlaceholderPanel();',
    'editorEl.focus(); placeCaretEnd();',
    'return true;'
  ].join(NL));

  // Real keystrokes, so the effect's own keydown listener fires the way it
  // does for a person typing rather than being poked directly.
  const keys = 'the quiet kind'.split('');
  for (const k of keys) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k === ' ' ? 'Space' : k });
    win.webContents.sendInputEvent({ type: 'char', keyCode: k });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k === ' ' ? 'Space' : k });
    await new Promise((r) => setTimeout(r, 55));
  }
  await new Promise((r) => setTimeout(r, SETTLE));

  const out = path.join(__dirname, 'shot-theme-' + THEME + '.png');
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log('wrote ' + out);
  console.log(errors.length ? 'ERRORS: ' + errors.slice(0, 8).join(' | ') : 'no renderer errors');
  app.exit(0);
});

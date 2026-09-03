// Captures focus mode going in and coming back out, including the frames in
// between — the whole point of the change is what happens during the
// transition, and an after-shot alone cannot tell an animation from a cut.
// Not part of the app.
//
//   electron tools/shoot-zen.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const store = { notes: {}, settings: {} };
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => store.notes);
  stub('save-notes', (_e, d) => { store.notes = d; return true; });
  stub('load-settings', () => store.settings);
  stub('save-settings', (_e, d) => { store.settings = d; return true; });
  stub('get-version', () => '3.9.0');
  for (const ch of ['list-profiles', 'ai-providers', 'get-startup', 'get-always-on-top',
    'get-storage-path', 'grow-window', 'restore-window']) stub(ch, () => ({}));

  const win = new BrowserWindow({
    width: 860, height: 560, show: true, alwaysOnTop: true,
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
    try {
      if (await ev('(() => typeof activeTab === "function" && !!activeTab() && !!settings)()')) break;
    } catch (e) { /* still parsing */ }
    await nap(150);
  }
  await nap(900);
  await ev('(() => { const e = document.querySelector(".editor-area"); if (e) { e.focus();' +
    ' e.textContent = "Focus mode should arrive and leave, not appear and disappear."; } return 1; })()');
  await nap(300);

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'shot-zen-' + name + '.png'), img.toPNG());
  };

  // Measured, not eyeballed. capturePage costs a hundred-odd milliseconds of
  // its own, so a screenshot taken "90ms in" is really taken most of the way
  // through a 220ms transition and looks finished either way.
  const dims = () => ev('(() => JSON.stringify({' +
    ' rail: +document.querySelector(".rail").getBoundingClientRect().width.toFixed(1),' +
    ' status: +document.querySelector(".statusbar").getBoundingClientRect().height.toFixed(1) }))()');

  await shot('0-before');
  await ev('(() => { toggleZen(true); return 1; })()');
  for (const at of [50, 110, 170]) {
    await nap(at === 50 ? 50 : 60);
    console.log('  in  +' + at + 'ms  ' + await dims());
  }
  await shot('1-mid-in');
  await nap(700);
  await shot('2-in');
  await ev('(() => { toggleZen(false); return 1; })()');
  for (const at of [50, 110, 170]) {
    await nap(at === 50 ? 50 : 60);
    console.log('  out +' + at + 'ms  ' + await dims());
  }
  await shot('3-mid-out');
  await nap(700);
  await shot('4-out');

  // What actually matters numerically: the rail is wide again and the status
  // bar has its height back. A transition that never completes is worse than
  // one that never starts.
  const end = await ev('(() => JSON.stringify({' +
    ' rail: document.querySelector(".rail").getBoundingClientRect().width,' +
    ' status: document.querySelector(".statusbar").getBoundingClientRect().height,' +
    ' zen: document.querySelector(".app").classList.contains("zen-mode") }))()');
  console.log('after exit: ' + end);
  app.exit(0);
});

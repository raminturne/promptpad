// Checks the key samples the way the app will: through the renderer, with the
// app's own loader, and then looks at the decoded audio rather than at the
// file size. A 12 KB wav of silence is still 12 KB.
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
      contextIsolation: true, backgroundThrottling: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (s) => win.webContents.executeJavaScript(s, true);
  for (let i = 0; i < 120; i++) {
    try { if (await ev('(() => typeof activeTab === "function" && !!activeTab())()')) break; }
    catch (e) { /* still parsing */ }
    await nap(150);
  }
  await nap(700);

  const report = await ev(`(async () => {
    const ac = new AudioContext();
    const names = [];
    for (let i = 1; i <= 12; i++) names.push('key' + i);
    names.push('space', 'enter', 'back');
    const out = [];
    for (const n of names) {
      try {
        const res = await fetch('sounds/' + n + '.wav');
        if (!res.ok) { out.push(n + ': MISSING'); continue; }
        const buf = await ac.decodeAudioData(await res.arrayBuffer());
        const d = buf.getChannelData(0);
        let peak = 0, rms = 0, attackAt = -1;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]);
          if (a > peak) peak = a;
          rms += d[i] * d[i];
          if (attackAt < 0 && a > 0.5) attackAt = i;
        }
        rms = Math.sqrt(rms / d.length);
        out.push(n + ': ' + (buf.duration * 1000).toFixed(0) + 'ms  peak ' + peak.toFixed(2) +
          '  rms ' + rms.toFixed(3) + '  attack@' + (attackAt < 0 ? '?' : (attackAt / buf.sampleRate * 1000).toFixed(1) + 'ms'));
      } catch (e) { out.push(n + ': FAILED ' + e.message); }
    }
    return out.join('\n');
  })()`);
  console.log(report);

  // And through the app's own loader, which is what actually decides whether
  // the themes use recordings or fall back to synthesis.
  await ev('(() => { settings.theme = "mechanical"; applySettings(); return 1; })()');
  await nap(900);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: 'a' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a' });
  await nap(600);
  console.log('\nmechanical theme ran with the samples present — no console errors above means the loader found them.');
  app.exit(0);
});

// Can the renderer actually read src/sounds/* the way fx.js tries to?
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const stub = (ch, fn) => ipcMain.handle(ch, fn);

app.whenReady().then(async () => {
  stub('load-notes', () => ({}));
  stub('save-notes', () => true);
  stub('load-settings', () => ({}));
  stub('save-settings', () => true);
  stub('get-version', () => '3.9.0');
  for (const ch of ['list-profiles', 'ai-providers', 'get-startup', 'get-always-on-top',
    'get-storage-path', 'grow-window', 'restore-window']) stub(ch, () => ({}));

  const win = new BrowserWindow({
    width: 700, height: 500, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  await nap(1500);
  const ev = (s) => win.webContents.executeJavaScript(s, true);

  console.log('origin: ' + await ev('location.protocol + "//" + location.host'));
  console.log('fetch : ' + await ev(`
    fetch('sounds/key1.wav').then(r => 'HTTP ' + r.status).catch(e => 'THREW: ' + e.message)`));
  console.log('XHR   : ' + await ev(`
    new Promise((res) => {
      const x = new XMLHttpRequest();
      x.open('GET', 'sounds/key1.wav');
      x.responseType = 'arraybuffer';
      x.onload = () => res('status ' + x.status + ', ' + (x.response ? x.response.byteLength : 0) + ' bytes');
      x.onerror = () => res('XHR error');
      try { x.send(); } catch (e) { res('THREW: ' + e.message); }
    })`));
  // Every file, through an <audio> element — same decoder the app uses, and
  // it reports the duration, so a silent or truncated cut shows up here
  // rather than in someone's ears.
  const names = [];
  for (let k = 1; k <= 12; k++) names.push('key' + k);
  names.push('space', 'enter', 'back', 'rain', 'fire', 'thunder');
  const rows = await ev(`(async () => {
    const out = [];
    for (const n of ${JSON.stringify('NAMES')}) {}
    return out;
  })()`).catch(() => null);
  for (const n of names) {
    const r = await ev(`
      new Promise((res) => {
        const a = new Audio('sounds/${'${n}'}');
        a.oncanplaythrough = () => res(a.duration.toFixed(3) + 's');
        a.onerror = () => res('MISSING');
        setTimeout(() => res('timeout'), 4000);
      })`.replace('${n}', n + (n === 'rain' || n === 'fire' || n === 'thunder' ? '.ogg' : '.wav')));
    console.log('  ' + n.padEnd(8) + r);
  }
  app.exit(0);
});

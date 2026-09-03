// Loads any local HTML file and photographs it, clicking through an opening
// panel if there is one. Used to look at a reference before designing from it.
// Not part of the app.
//
//   electron tools/shoot-page.js <file> <out-prefix>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const FILE = process.argv[2];
const OUT = process.argv[3] || 'page';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 760, show: true, alwaysOnTop: true,
    webPreferences: { backgroundThrottling: false }
  });
  await win.loadFile(FILE);
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, OUT + '-' + name + '.png'), img.toPNG());
    console.log('wrote ' + OUT + '-' + name + '.png');
  };
  await nap(1800);
  await shot('1-open');

  // Dismiss whatever opening panel is in the way, then let it settle and run.
  await win.webContents.executeJavaScript(
    "(() => { const b = document.querySelector('.btn'); if (b) b.click(); return !!b; })()", true);
  await nap(2600);
  await shot('2-scene');
  await nap(4000);
  await shot('3-later');
  app.exit(0);
});

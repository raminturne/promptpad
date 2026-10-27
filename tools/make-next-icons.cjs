// Renders the app icon from src/logo-next.svg — the mark the Next theme uses
// in the title bar — into the sizes Windows, macOS and Linux want.
//
//   electron tools/make-next-icons.cjs
//
// Every size is a render of the vector rather than a resize of a bitmap, so
// the small ones keep their strokes instead of turning to mush. The .ico is
// assembled afterwards by tools/make-next-icons.py from these PNGs.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'src', 'logo-next.svg'), 'utf-8');
const OUT = path.join(ROOT, 'build', 'icon-src');
fs.mkdirSync(OUT, { recursive: true });

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, useContentSize: true, show: false, frame: false,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));

  // A window cannot be made as small as a 16px icon (Windows clamps it to
  // about 48x39), so the page stays large and only the corner is captured.
  win.setContentSize(1024, 1024);
  for (const size of SIZES) {
    const html = '<!doctype html><meta charset="utf-8">' +
      '<style>html,body{margin:0;padding:0;background:transparent}' +
      'svg{display:block;width:' + size + 'px;height:' + size + 'px}</style>' + SVG;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await nap(180);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const file = path.join(OUT, 'icon-' + size + '.png');
    fs.writeFileSync(file, img.toPNG());
    const got = img.getSize();
    console.log(size + 'px -> ' + got.width + 'x' + got.height);
  }
  console.log('wrote', OUT);
  app.quit();
});

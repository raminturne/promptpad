// Which of the candidate faces are actually installed. Measuring is the only
// reliable test: a missing family silently falls back, so a face that renders
// exactly as the generic fallback does is not present.
const { app, BrowserWindow } = require('electron');

const CANDIDATES = [
  'Fixedsys', 'Terminal', 'Small Fonts', 'MS Sans Serif', 'Modern', 'System',
  'Courier', 'MS Gothic', 'Simsun', 'NSimSun', 'MingLiU', 'Consolas',
  'Press Start 2P', 'Silkscreen', 'Pixelify Sans', 'VT323', 'DotGothic16',
  'OCR A Extended', 'MS Reference Sans Serif', 'Rockwell', 'Impact'
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false });
  await win.loadURL('data:text/html,<body></body>');
  const res = await win.webContents.executeJavaScript(`
    (() => {
      const probe = document.createElement('span');
      probe.style.position = 'absolute';
      probe.style.fontSize = '72px';
      probe.textContent = 'mmmmmmmmmmlliWWQ@ سلام';
      document.body.appendChild(probe);
      const base = {};
      for (const g of ['monospace', 'serif', 'sans-serif']) {
        probe.style.fontFamily = g;
        base[g] = probe.getBoundingClientRect().width;
      }
      const out = {};
      for (const f of ${JSON.stringify(CANDIDATES)}) {
        let present = false;
        for (const g of ['monospace', 'serif', 'sans-serif']) {
          probe.style.fontFamily = '"' + f + '",' + g;
          if (Math.abs(probe.getBoundingClientRect().width - base[g]) > 0.5) {
            present = true; break;
          }
        }
        out[f] = present;
      }
      return JSON.stringify(out);
    })()
  `, true);
  const map = JSON.parse(res);
  console.log('INSTALLED:', Object.keys(map).filter((k) => map[k]).join(', '));
  console.log('MISSING  :', Object.keys(map).filter((k) => !map[k]).join(', '));
  app.exit(0);
});

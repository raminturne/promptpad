// Renders the moon at known phases and measures how much of the disc came out
// lit. A crescent that draws as a gibbous still looks like "a moon", so the
// only way to know the terminator is right is to count the pixels.
const { app, BrowserWindow } = require('electron');

const CASES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false });
  await win.loadURL('data:text/html,<canvas id=c width=200 height=200></canvas>');
  const out = await win.webContents.executeJavaScript(`
    (() => {
      const cv = document.getElementById('c');
      const ctx = cv.getContext('2d');
      const R = 80, cx = 100, cy = 100;

      function draw(p) {
        ctx.clearRect(0, 0, 200, 200);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 200, 200);
        const cos = Math.cos(p * Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        if (p < 0.5) {
          ctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2, false);
          ctx.ellipse(cx, cy, R * Math.abs(cos), R, 0, Math.PI / 2, -Math.PI / 2, cos > 0);
        } else {
          ctx.arc(cx, cy, R, Math.PI / 2, -Math.PI / 2, false);
          ctx.ellipse(cx, cy, R * Math.abs(cos), R, 0, -Math.PI / 2, Math.PI / 2, cos > 0);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const res = [];
      for (const p of ${JSON.stringify(CASES)}) {
        draw(p);
        const d = ctx.getImageData(0, 0, 200, 200).data;
        let lit = 0, total = 0;
        for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
          total++;
          if (d[(y * 200 + x) * 4] > 128) lit++;
        }
        // Which side the lit half sits on, so waxing/waning can be checked too.
        let leftLit = 0, rightLit = 0;
        const d2 = ctx.getImageData(0, 0, 200, 200).data;
        for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
          if (d2[(y * 200 + x) * 4] > 128) (x < cx ? leftLit++ : rightLit++);
        }
        res.push({ p, frac: lit / total, side: rightLit > leftLit ? 'right' : 'left' });
      }
      return JSON.stringify(res);
    })()
  `, true);

  let bad = 0;
  for (const r of JSON.parse(out)) {
    // The lit fraction of a disc is cosine, not linear: a quarter of the way
    // through the month only 15% of the face is lit, not 50%.
    const want = (1 - Math.cos(r.p * Math.PI * 2)) / 2;
    const side = r.p < 0.5 ? 'right' : 'left';           // waxing lights the right
    const okFrac = Math.abs(r.frac - want) < 0.06;
    const okSide = want < 0.02 || want > 0.98 || r.side === side;
    if (!okFrac || !okSide) bad++;
    console.log(
      (okFrac && okSide ? 'PASS  ' : 'FAIL  ') +
      'phase ' + r.p.toFixed(3) +
      '  lit=' + r.frac.toFixed(3) + ' want=' + want.toFixed(3) +
      '  side=' + r.side + ' want=' + side);
  }
  console.log(bad ? bad + ' wrong' : 'all phases correct');
  app.exit(0);
});

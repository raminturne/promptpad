// Renders one plucked note offline and measures it. The previous synthesis
// was a delay-line feedback loop that howled; the checks here are the ones
// that would have caught that: peak level, that it decays instead of
// sustaining, and that the partials are a harmonic series (a string) rather
// than the near-oscillation a runaway loop produces.
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 300, height: 200, show: false });
  await win.loadURL('data:text/html,<body></body>');
  const out = await win.webContents.executeJavaScript(`
    (async () => {
      const SR = 44100, ctx = new OfflineAudioContext(1, SR * 3, SR);
      const master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      const noise = ctx.createBuffer(1, SR, SR);
      const nd = noise.getChannelData(0);
      for (let i = 0; i < SR; i++) nd[i] = Math.random() * 2 - 1;

      const H = [[1,1.00,1.0],[2,0.44,1.8],[3,0.26,2.6],[4,0.14,3.6],[5,0.08,4.6],[6,0.05,5.8]];
      const freq = 196, gain = 0.075, dur = 2.1, now = 0;

      const src = ctx.createBufferSource(); src.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type='bandpass';
      bp.frequency.value = freq*4; bp.Q.value = 1.2;
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(gain*0.5, now);
      pg.gain.exponentialRampToValueAtTime(0.0001, now+0.03);
      src.connect(bp); bp.connect(pg); pg.connect(master);
      src.start(now, 0.1, 0.05); src.stop(now+0.05);

      for (const [mult, lvl, fast] of H) {
        const f = freq*mult;
        const osc = ctx.createOscillator(); osc.type='sine';
        osc.frequency.setValueAtTime(f*1.004, now);
        osc.frequency.exponentialRampToValueAtTime(f, now+0.06);
        const g = ctx.createGain();
        const d = Math.max(0.08, dur/fast);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(gain*lvl, now+0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now+d);
        osc.connect(g); g.connect(master);
        osc.start(now); osc.stop(now+d+0.02);
      }

      const buf = await ctx.startRendering();
      const d2 = buf.getChannelData(0);
      const rms = (a,b) => { let s=0,n=0; for (let i=a;i<b&&i<d2.length;i++){s+=d2[i]*d2[i];n++;} return Math.sqrt(s/Math.max(1,n)); };
      let peak = 0; for (let i=0;i<d2.length;i++) peak = Math.max(peak, Math.abs(d2[i]));

      const bins = [];
      const from = Math.round(SR*0.05), to = Math.round(SR*0.35);
      for (let f = 120; f < 2200; f += 6) {
        let re=0, im=0;
        for (let i=from;i<to;i+=2){ const t=i/SR; re+=d2[i]*Math.cos(2*Math.PI*f*t); im+=d2[i]*Math.sin(2*Math.PI*f*t); }
        bins.push({f, m: Math.hypot(re,im)});
      }
      bins.sort((a,b)=>b.m-a.m);
      const peaks=[];
      for (const b3 of bins){ if (peaks.some(p=>Math.abs(p-b3.f)<70)) continue; peaks.push(b3.f); if (peaks.length===3) break; }
      peaks.sort((a,b)=>a-b);

      return JSON.stringify({
        peak,
        early: rms(Math.round(SR*0.01), Math.round(SR*0.15)),
        mid:   rms(Math.round(SR*0.8),  Math.round(SR*1.0)),
        late:  rms(Math.round(SR*2.4),  Math.round(SR*2.8)),
        peaks
      });
    })()
  `, true);

  const r = JSON.parse(out);
  const say = (ok, n, x) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (x ? '  — ' + x : ''));

  say(r.peak > 0.02, 'the string sounds', 'peak ' + r.peak.toFixed(4));
  // The old loop peaked near 1.0 and clipped; a note should sit well under.
  say(r.peak < 0.45, 'and does not run away', 'peak ' + r.peak.toFixed(3));
  say(r.mid < r.early * 0.7, 'it decays rather than sustaining',
    'mid is ' + (r.mid / r.early * 100).toFixed(0) + '% of the attack');
  say(r.late < r.early * 0.02, 'and is gone by three seconds',
    'late is ' + (r.late / r.early * 100).toFixed(2) + '%');
  // A string is a harmonic series; a feedback loop is not.
  const ratios = r.peaks.map((f) => f / r.peaks[0]);
  say(ratios.every((x) => Math.abs(x - Math.round(x)) < 0.06),
    'its partials are a harmonic series, so it reads as a string',
    ratios.map((x) => x.toFixed(2)).join(' : '));
  app.exit(0);
});

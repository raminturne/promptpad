// Cuts individual keystrokes out of a recording of somebody typing, and
// writes them as src/sounds/key1..key12.wav, space.wav, enter.wav, back.wav.
//
//   electron tools/make-key-samples.js
//
// Run under Electron rather than node because the source files are Ogg
// Vorbis and Chromium can decode them; node cannot without a dependency, and
// this is a once-a-year script.
//
// The sources are two public-domain recordings from Wikimedia Commons —
// continuous typing, not isolated presses — so the work is onset detection:
// find where each strike begins, cut from just before it to the end of its
// decay, and keep the ones that are loud and clean. Twelve different strikes
// is the point of the exercise: two identical presses in a row is what gives
// a synthetic keyboard away, well before the timbre does.
'use strict';

const { app, BrowserWindow, net } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'sounds');
const SOURCES = [
  'https://upload.wikimedia.org/wikipedia/commons/4/4f/Typing_fast.ogg',
  'https://upload.wikimedia.org/wikipedia/commons/3/34/Typing_medium_speed.ogg'
];

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url });
    req.setHeader('User-Agent', 'PromptPad-sound-tool/1.0 (personal project)');
    const bufs = [];
    req.on('response', (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); return; }
      res.on('data', (c) => bufs.push(c));
      res.on('end', () => resolve(Buffer.concat(bufs)));
    });
    req.on('error', reject);
    req.end();
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<title>cut</title>');

  const raw = [];
  for (const url of SOURCES) {
    const b = await fetchBuf(url);
    console.log('fetched ' + path.basename(url) + '  ' + Math.round(b.length / 1024) + ' KB');
    raw.push(b.toString('base64'));
  }

  // All of the analysis runs in the page, because that is where
  // decodeAudioData lives, and the *selection* runs there too so only the
  // fifteen chosen cuts have to cross back.
  const picked = await win.webContents.executeJavaScript(`(async () => {
    const B64 = ${JSON.stringify(raw)};
    const ac = new AudioContext();
    const tracks = [];

    for (const b64 of B64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await ac.decodeAudioData(bytes.buffer);
      const n = buf.length;
      const d = new Float32Array(n);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const c = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) d[i] += c[i] / buf.numberOfChannels;
      }
      tracks.push({ d, sr: buf.sampleRate });
    }

    // Rectified, smoothed envelope. A short window on purpose: the attack of
    // a key is the only fast rise in these recordings, and a long window
    // smears two quick strikes into one.
    const envelope = (d, sr) => {
      const w = Math.round(sr * 0.003);
      const env = new Float32Array(d.length);
      let acc = 0;
      for (let i = 0; i < d.length; i++) {
        acc += Math.abs(d[i]);
        if (i >= w) acc -= Math.abs(d[i - w]);
        env[i] = acc / w;
      }
      return env;
    };

    // Find every strike, and measure the three things that tell the big keys
    // from the small ones.
    const strikes = [];
    tracks.forEach((tr, ti) => {
      const { d, sr } = tr;
      const env = envelope(d, sr);
      let peak = 0;
      for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
      const thr = peak * 0.28;
      const refractory = Math.round(sr * 0.055);
      let last = -refractory;
      for (let i = 1; i < d.length; i++) {
        if (env[i] < thr || env[i - 1] >= thr) continue;
        if (i - last < refractory) continue;
        last = i;
        // Back up to where the rise actually began. Cutting on the threshold
        // clips the front edge off the click and every sample sounds soft.
        let s = i;
        while (s > 0 && s > i - Math.round(sr * 0.006) && env[s] > peak * 0.02) s--;
        if (s + Math.round(sr * 0.25) >= d.length) break;

        // Measured over a fixed window so the numbers are comparable.
        const m = Math.round(sr * 0.13);
        let amp = 0, lowE = 0, allE = 0, lp = 0;
        for (let k = 0; k < m; k++) {
          const v = d[s + k];
          const a = Math.abs(v);
          if (a > amp) amp = a;
          lp += (v - lp) * 0.06;              // ~450Hz one-pole
          lowE += lp * lp;
          allE += v * v;
        }
        if (amp < 0.05) continue;
        // How long it takes the envelope to fall to a tenth of its peak. A
        // spacebar has a plate and stabilisers under it and rings on; a
        // letter key does not.
        let ep = 0;
        for (let k = 0; k < m; k++) if (env[s + k] > ep) ep = env[s + k];
        let decay = m;
        for (let k = 0; k < m; k++) if (env[s + k] < ep * 0.1 && k > sr * 0.01) { decay = k; break; }
        strikes.push({
          ti, s, sr, amp,
          dull: allE > 0 ? lowE / allE : 0,
          decay: decay / sr
        });
      }
    });

    // Cut a strike to a given length, normalised, with a 1ms fade in and a
    // fade out proportional to the length — a long cut with a short fade
    // stops with a click.
    const cut = (st, seconds) => {
      const { d } = tracks[st.ti];
      const len = Math.round(st.sr * seconds);
      const out = new Float32Array(len);
      let amp = 0;
      for (let k = 0; k < len; k++) {
        out[k] = st.s + k < d.length ? d[st.s + k] : 0;
        const a = Math.abs(out[k]);
        if (a > amp) amp = a;
      }
      if (amp < 1e-6) amp = 1;
      const fi = Math.round(st.sr * 0.001), fo = Math.round(len * 0.28);
      for (let k = 0; k < len; k++) {
        let v = out[k] / amp * 0.92;
        if (k < fi) v *= k / fi;
        if (k > len - fo) v *= (len - k) / fo;
        out[k] = v;
      }
      return { sr: st.sr, data: Array.from(out) };
    };

    // Which strike is the spacebar? Neither of these recordings has one.
    //
    // Two heuristics were tried and both failed for the same reason. Ranking
    // by dullness alone finds softly-struck letters, because a quiet press is
    // dull too. Ranking by dullness among the *well-struck* strikes finds
    // nothing: the best score in that set is 0.046, against 0.362 for a quiet
    // one — meaning that among the strikes hit hard enough to use, not one is
    // meaningfully low. These are keyboards where every key sounds the same,
    // and no amount of searching will find a space bar in them.
    //
    // So the big keys are *made* rather than found, and made out of the same
    // real strikes by applying the differences a bigger key actually makes.
    // A space bar is wider, sits on a plate, has stabilisers and is hit with
    // a thumb, so against a letter key it is lower, longer and fuller. Those
    // are three transforms on a recording, not an invention.
    const amps = strikes.map((st) => st.amp).sort((a, b) => a - b);
    const floor = amps[Math.floor(amps.length * 0.72)];
    const solid = strikes.filter((st) => st.amp >= floor);
    const pickFrom = solid.length > 12 ? solid : strikes;

    // Resample by linear interpolation. Slower than 1 lowers the pitch and
    // lengthens it at once, which is exactly the pair of things a bigger key
    // does — so one operation buys both.
    const resample = (c, rate) => {
      const src = c.data, len = Math.floor(src.length / rate);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const x = i * rate, i0 = x | 0, f = x - i0;
        out[i] = (src[i0] || 0) * (1 - f) + (src[i0 + 1] || 0) * f;
      }
      return { sr: c.sr, data: out };
    };
    // A low shelf, one pole, mixed back in. The plate under a big key is what
    // puts weight underneath the click.
    const body = (c, amount) => {
      const out = new Float32Array(c.data.length);
      let lp = 0;
      for (let i = 0; i < c.data.length; i++) {
        lp += (c.data[i] - lp) * 0.05;
        out[i] = c.data[i] + lp * amount;
      }
      let peak = 0;
      for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
      if (peak > 1e-6) for (let i = 0; i < out.length; i++) out[i] = out[i] / peak * 0.92;
      return { sr: c.sr, data: out };
    };
    const tail = (c, seconds) => {
      const len = Math.round(c.sr * seconds);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = i < c.data.length ? c.data[i] : 0;
      const fo = Math.round(len * 0.35);
      for (let i = len - fo; i < len; i++) out[i] *= (len - i) / fo;
      return { sr: c.sr, data: out };
    };
    const arr = (c) => ({ sr: c.sr, data: Array.from(c.data) });

    const loudest = pickFrom.slice().sort((a, b) => b.amp - a.amp);
    const spaceSrc = loudest[0];
    const enterSrc = loudest.find((st) => st.ti !== spaceSrc.ti) || loudest[1];
    // Backspace is the one key that is *smaller* in effect than a letter —
    // a quick, bright tick — so it goes the other way: shorter and up a bit.
    const backSrc = loudest[Math.min(loudest.length - 1, 3)];

    const space = arr(tail(body(resample(cut(spaceSrc, 0.20), 0.78), 0.55), 0.24));
    const enter = arr(tail(body(resample(cut(enterSrc, 0.18), 0.86), 0.38), 0.20));
    const back = arr(tail(resample(cut(backSrc, 0.10), 1.12), 0.085));

    const taken = new Set([spaceSrc, enterSrc, backSrc]);
    const pool = strikes.filter((st) => !taken.has(st));
    const keys = [];
    for (let i = 0; i < 12; i++) keys.push(pool[Math.floor(i * pool.length / 12)]);

    return {
      space, enter, back,
      keys: keys.map((st) => arr(cut(st, 0.13))),
      stats: { found: strikes.length, pool: pool.length, solid: solid.length }
    };
  })()`, true);

  console.log('found ' + picked.stats.found + ' strikes (' + picked.stats.solid + ' struck hard enough to use)');

  // WAV, 16-bit mono. Small enough that lossless costs nothing, and a
  // transform codec would smear the 5ms attack, which is the whole sound.
  const wav = (samples, sr) => {
    const n = samples.length;
    const b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
    b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
    b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    return b;
  };
  const write = (name, c) => {
    const p = path.join(OUT, name + '.wav');
    fs.writeFileSync(p, wav(c.data, c.sr));
    console.log('  ' + name + '.wav  ' + (c.data.length / c.sr * 1000).toFixed(0) + 'ms  ' +
      Math.round(fs.statSync(p).size / 1024) + ' KB');
  };
  console.log('writing:');
  picked.keys.forEach((c, i) => write('key' + (i + 1), c));
  write('space', picked.space);
  write('enter', picked.enter);
  write('back', picked.back);
  app.exit(0);
});

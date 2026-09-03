// Renders the theme sounds to src/sounds/*.wav.
//
//   node tools/make-sounds.js
//
// These are synthesised, not recordings — I have no way to fetch or record
// audio. But rendering them offline lifts the ceiling a long way above what
// the app can do in realtime: a rain loop here is twenty seconds built out of
// four thousand individual droplet impacts, which is not something you can
// schedule on a sixty-hertz budget while a text editor is also running.
//
// Everything is written straight into Float32 arrays rather than through an
// audio node graph. Four thousand node chains is slow and awkward; a biquad
// is nine lines.
//
// If real recordings ever turn up, drop them in with the same names and they
// win — src/sounds/README.md has the list.
'use strict';

const fs = require('fs');
const path = require('path');

const SR = 44100;
const OUT = path.join(__dirname, '..', 'src', 'sounds');

// ---------------------------------------------------------------- utilities

// RBJ cookbook biquad. One object per filter instance because the state
// (two samples in, two out) has to persist across the whole signal.
function biquad(type, freq, q) {
  const w0 = 2 * Math.PI * freq / SR;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else { // bandpass, constant peak gain
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

const rnd = (a, b) => a + Math.random() * (b - a);

// Mix one short event into a buffer at a sample offset, wrapping round the
// end. Wrapping is what lets a loop be seamless: an event that starts near
// the end simply continues at the beginning, so there is no silent seam and
// no crossfade artefact either.
function mixWrap(buf, at, sig, gain) {
  const n = buf.length;
  for (let i = 0; i < sig.length; i++) {
    buf[(at + i) % n] += sig[i] * gain;
  }
}

// A burst of noise through a bandpass, with an exponential decay. This is one
// water droplet, one crackle of resin, one pawl dropping — the pitch and the
// decay are the whole difference between them.
function ping(freq, q, decay, curve) {
  const n = Math.max(4, Math.round(decay * SR * 3));
  const out = new Float32Array(n);
  const f = biquad('bandpass', freq, q);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t / decay);
    out[i] = f(Math.random() * 2 - 1) * Math.pow(env, curve || 1);
  }
  return out;
}

// A struck body: partials at non-integer ratios, which is what metal and
// plastic both do and a harmonic series does not.
function body(f0, partials, decay, gain) {
  const n = Math.round(decay * SR * 4);
  const out = new Float32Array(n);
  for (let p = 0; p < partials.length; p++) {
    const f = f0 * partials[p];
    if (f > SR * 0.45) continue;
    const amp = gain * Math.pow(0.55, p);
    const d = decay * Math.pow(0.62, p);
    const w = 2 * Math.PI * f / SR;
    const ph = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      out[i] += Math.sin(w * i + ph) * amp * Math.exp(-(i / SR) / d);
    }
  }
  return out;
}

function normalise(buf, peak) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m < 1e-6) return buf;
  const k = (peak || 0.85) / m;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
  return buf;
}

// A short fade at both ends, for one-shots. Loops must NOT get this — a fade
// to silence is exactly the click a loop is trying to avoid.
function fadeEnds(buf, ms) {
  const n = Math.round((ms / 1000) * SR);
  for (let i = 0; i < n && i < buf.length; i++) {
    const k = i / n;
    buf[i] *= k;
    buf[buf.length - 1 - i] *= k;
  }
  return buf;
}

// A noise bed that genuinely loops.
//
// Two things break a synthesised loop and both showed up in measurement. The
// filters start with empty state, so the first fifty milliseconds are quieter
// than the rest — that alone put the end of the fire bed 5.6dB above its
// start. And the sample either side of the join comes from two unrelated
// places in the noise, which for a lowpassed signal is a step far outside
// what the waveform does anywhere else: measured 0.056 against a median of
// 0.013, i.e. an audible tick once per lap.
//
// So: render an extra `xf` seconds, then fold the overrun back over the head
// with an equal-power crossfade. Sample 0 of the result is raw[n] and the
// last is raw[n-1] — adjacent in the source, so the join is continuous by
// construction rather than by luck. Any LFO passed in must have a period that
// divides `seconds`, or the fold reintroduces exactly the level jump it is
// there to remove.
function loopBed(seconds, xf, make) {
  const n = seconds * SR;
  const nx = Math.round(xf * SR);
  const raw = new Float32Array(n + nx);
  for (let i = 0; i < raw.length; i++) raw[i] = make(i);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < nx; i++) {
    const w = (i / nx) * Math.PI / 2;
    out[i] = raw[i] * Math.sin(w) + raw[n + i] * Math.cos(w);
  }
  return out;
}

function writeWav(name, buf) {
  const n = buf.length;
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + n * 2, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);        // PCM
  out.writeUInt16LE(1, 22);        // mono
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), out);
  console.log('  ' + name.padEnd(12) + (n / SR).toFixed(1) + 's  ' +
    (out.length / 1024).toFixed(0) + 'KB');
}

// ---------------------------------------------------------------- the sounds

// Rain is three things at once and leaving any of them out is why synthesised
// rain usually sounds like static: a wide hiss (everything too far away to
// pick out), a low roar under it (the mass of it), and individual impacts near
// enough to hear as separate events.
function rain(seconds) {
  const n = seconds * SR;
  const hiss = biquad('bandpass', 3400, 0.5);
  const roar = biquad('lowpass', 420, 0.7);
  const tilt = biquad('highpass', 120, 0.7);
  // Both gust rates are whole cycles per lap, so the swell lines up with
  // itself at the fold.
  const w1 = 2 * Math.PI * 3 / (seconds * SR);
  const w2 = 2 * Math.PI * 2 / (seconds * SR);
  // Hiss-led, not roar-led. The first version had the low band at more than
  // twice the high one and came out as a rumble with clicks on it; rain heard
  // from inside is mostly the high, dense part, with the roar underneath.
  const buf = loopBed(seconds, 0.6, (i) => {
    const w = Math.random() * 2 - 1;
    const gust = 0.82 + 0.18 * Math.sin(i * w1) * Math.sin(i * w2);
    return tilt(hiss(w) * 0.46 + roar(w) * 0.30) * gust;
  });

  // The drops, and this is where the first version went wrong. It laid down
  // two hundred a second at up to four tenths of full scale, which is not
  // rain — it is a rattle, because at that spacing the ear hears each one.
  //
  // Real rain is thousands of impacts a second, individually far too quiet to
  // pick out: the hiss *is* the drops. So: eight hundred a second at a fortieth
  // of the amplitude, which blurs into the bed and gives it a texture no
  // filtered noise has...
  for (let d = 0; d < seconds * 800; d++) {
    mixWrap(buf, Math.floor(Math.random() * n),
      ping(rnd(1800, 5200), rnd(14, 30), rnd(0.003, 0.010)), rnd(0.006, 0.022));
  }
  // ...and then a *handful* of close ones, two a second, which is what you
  // actually hear hitting the glass. These are the ones meant to stand out,
  // and they only work because nothing else does.
  for (let d = 0; d < seconds * 2; d++) {
    mixWrap(buf, Math.floor(Math.random() * n),
      ping(rnd(700, 2200), rnd(8, 18), rnd(0.010, 0.030)), rnd(0.10, 0.22));
  }
  // Quieter overall. It was normalised to 0.78 and then played at a gain
  // chosen for something softer, so it arrived louder than everything else
  // in the app.
  return normalise(buf, 0.52);
}

function thunder() {
  const seconds = 7;
  const n = seconds * SR;
  const buf = new Float32Array(n);
  const lp1 = biquad('lowpass', 150, 0.6);
  const lp2 = biquad('lowpass', 70, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // Up over most of a second, down over five. A bang is lightning close
    // enough to kill you; from a window it is a roll.
    const env = t < 0.9
      ? Math.pow(t / 0.9, 1.6)
      : Math.exp(-(t - 0.9) / 1.9);
    // A couple of louder cracks inside the roll, which is the sound bouncing.
    const crack = (Math.abs(t - 1.4) < 0.06 || Math.abs(t - 2.6) < 0.05) ? 2.1 : 1;
    buf[i] = lp2(lp1(Math.random() * 2 - 1)) * env * crack;
  }
  return fadeEnds(normalise(buf, 0.82), 40);
}

// A fire is a low roar you stop hearing after a minute and a crackle you never
// stop hearing. The crackle is the whole thing, and the gaps between pops have
// to be irregular — evenly spaced ones sound like a machine.
function fire(seconds) {
  const n = seconds * SR;
  const roar = biquad('lowpass', 280, 0.6);
  const air = biquad('bandpass', 850, 0.35);
  const w1 = 2 * Math.PI * 2 / (seconds * SR);
  const w2 = 2 * Math.PI * 1 / (seconds * SR);
  const buf = loopBed(seconds, 0.9, (i) => {
    const w = Math.random() * 2 - 1;
    const breathe = 0.8 + 0.2 * Math.sin(i * w1 + Math.sin(i * w2));
    return (roar(w) * 0.75 + air(w) * 0.18) * breathe;
  });
  let at = 0;
  while (at < n) {
    // Gaps drawn from a squared uniform: mostly short, occasionally long.
    at += Math.round(rnd(0.02, 1.0) * Math.pow(Math.random(), 1.6) * SR + 0.02 * SR);
    if (at >= n) break;
    const big = Math.random() < 0.13;
    mixWrap(buf, at,
      ping(big ? rnd(280, 750) : rnd(900, 3600), big ? 6 : 12,
        big ? rnd(0.03, 0.09) : rnd(0.004, 0.016)),
      big ? rnd(0.5, 0.95) : rnd(0.10, 0.34));
    if (big) mixWrap(buf, at, body(rnd(70, 140), [1, 2.4, 3.9], 0.08, 0.5), 0.7);
  }
  return normalise(buf, 0.8);
}

// One keystroke. A switch is three sounds inside about twelve milliseconds:
// the stem hitting bottom, the housing ringing, and the mass of the board
// taking it. Four variants, because two identical presses in a row is what
// gives synthesis away long before the timbre does.
function key(variant) {
  const n = Math.round(0.16 * SR);
  const buf = new Float32Array(n);
  const bright = [2500, 2900, 2200, 3300][variant % 4];
  const low = [150, 168, 132, 182][variant % 4];
  mixWrap(buf, 0, ping(bright * rnd(0.94, 1.06), 7, 0.0055, 1.2), 0.75);
  mixWrap(buf, Math.round(0.0008 * SR),
    body(bright * 0.42, [1, 2.41, 3.87, 6.05], 0.022, 0.32), 1);
  mixWrap(buf, Math.round(0.0016 * SR), body(low, [1, 2.7], 0.030, 0.42), 1);
  // The release, a beat later and quieter — leaving it out is most of why a
  // synthesised keyboard sounds like a click track.
  mixWrap(buf, Math.round(rnd(0.052, 0.078) * SR),
    ping(bright * 1.35, 9, 0.0035), 0.26);
  return fadeEnds(normalise(buf, 0.72), 3);
}

function spacebar() {
  const n = Math.round(0.22 * SR);
  const buf = new Float32Array(n);
  mixWrap(buf, 0, ping(1500, 5, 0.010, 1.1), 0.8);
  mixWrap(buf, Math.round(0.001 * SR), body(96, [1, 2.3, 4.1], 0.075, 0.55), 1);
  // Stabiliser rattle: two small extra contacts either side of the main one.
  mixWrap(buf, Math.round(0.004 * SR), ping(2400, 10, 0.003), 0.22);
  mixWrap(buf, Math.round(0.007 * SR), ping(2100, 10, 0.003), 0.18);
  mixWrap(buf, Math.round(0.070 * SR), ping(2600, 9, 0.004), 0.24);
  return fadeEnds(normalise(buf, 0.80), 3);
}

function enterKey() {
  const n = Math.round(0.26 * SR);
  const buf = new Float32Array(n);
  mixWrap(buf, 0, ping(1250, 4, 0.013, 1.1), 0.85);
  mixWrap(buf, Math.round(0.001 * SR), body(78, [1, 2.2, 3.8], 0.095, 0.6), 1);
  mixWrap(buf, Math.round(0.005 * SR), ping(1900, 8, 0.004), 0.25);
  mixWrap(buf, Math.round(0.080 * SR), ping(2300, 9, 0.005), 0.28);
  return fadeEnds(normalise(buf, 0.85), 3);
}

function backKey() {
  const n = Math.round(0.13 * SR);
  const buf = new Float32Array(n);
  mixWrap(buf, 0, ping(3100, 9, 0.0045), 0.7);
  mixWrap(buf, Math.round(0.001 * SR), body(210, [1, 2.5], 0.018, 0.28), 1);
  mixWrap(buf, Math.round(0.048 * SR), ping(3600, 10, 0.003), 0.22);
  return fadeEnds(normalise(buf, 0.62), 3);
}

// The long beds go out as Vorbis and the short ones stay as WAV.
//
// Twenty seconds of 16-bit mono is 1.7MB, and three of those is most of an
// installer for no reason — Vorbis takes the same audio to 230KB and the
// loop survives it, because Ogg carries a sample-accurate granule position
// so the decoder hands back exactly the samples that went in (measured:
// delta 0, seam unchanged at 0.03dB).
//
// The keystrokes stay lossless. They are 14KB each so there is nothing to
// save, and a 5ms attack is the one thing a transform codec smears.
function toOgg(base) {
  const wav = path.join(OUT, base + '.wav');
  const ogg = path.join(OUT, base + '.ogg');
  const r = require('child_process').spawnSync('ffmpeg',
    ['-v', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', '6', ogg],
    { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.log('  (no ffmpeg — keeping ' + base + '.wav, which works fine, just bigger)');
    return;
  }
  fs.unlinkSync(wav);
  console.log('  ' + (base + '.ogg').padEnd(12) +
    (fs.statSync(ogg).size / 1024).toFixed(0) + 'KB');
}

// ---------------------------------------------------------------- go

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (/\.(wav|ogg)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
}
console.log('rendering to src/sounds/ …');
writeWav('rain.wav', rain(20));
writeWav('thunder.wav', thunder());
writeWav('fire.wav', fire(20));
for (let i = 1; i <= 4; i++) writeWav('key' + i + '.wav', key(i - 1));
writeWav('space.wav', spacebar());
writeWav('enter.wav', enterKey());
writeWav('back.wav', backKey());
console.log('encoding the beds …');
['rain', 'thunder', 'fire'].forEach(toOgg);
console.log('done. Delete any file you do not like and the theme falls back to');
console.log('its built-in synthesis; drop a real recording in with the same name');
console.log('and that wins instead.');

// Pro-theme effect engine.
//
// A normal theme only swaps the seven palette variables. A *Pro* theme changes
// what the app physically is: refracting glass, a decaying CRT, a grainy
// black-and-white print, a surface that moves with whatever music is playing.
// Each one is a small runtime here, started and stopped by name.
//
// Everything draws into #fxLayer (a fixed, pointer-events:none overlay) or, for
// effects that need to sit *behind* the UI, #fxBack. Nothing here ever touches
// app state — stopping an effect must leave the DOM exactly as it found it.
(function () {
  const RUNTIMES = {};
  let current = null;
  let rafId = null;
  // Bumped on every switch. Music's start() is async (it waits on the system
  // audio capture), so it can resolve after the user has already moved to
  // another theme — at which point stop() has run and its cleanup is done.
  // Without this check the late start would install a rAF loop nothing owns,
  // which goes on rewriting --accent under whatever theme is now active.
  let generation = 0;

  // Window motion, published to whichever runtime asked for it.
  //
  // A set rather than a single slot: nothing stops two effects overlapping
  // during the one-frame handover in apply(), and a runtime that has been
  // stopped must not keep receiving shoves — so subscribing returns its own
  // unsubscribe and stop() calls it.
  const shoveHandlers = new Set();
  function onShove(fn) {
    shoveHandlers.add(fn);
    return () => shoveHandlers.delete(fn);
  }
  function shove(dx, dy) {
    for (const fn of shoveHandlers) {
      try { fn(dx, dy); } catch (e) { console.error('fx shove failed', e); }
    }
  }

  const el = (id) => document.getElementById(id);
  const layer = () => el('fxLayer');
  const back = () => el('fxBack');

  function clearLayers() {
    const a = layer(), b = back();
    if (a) a.innerHTML = '';
    if (b) b.innerHTML = '';
  }

  function stopRaf() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // Where the caret is on screen. Several themes aim at it — a wound, a pulse
  // of current, the flame — and all of them want the same thing: a small
  // rectangle, or null when nothing is focused.
  //
  // Measured from a range collapsed at the selection's *focus*, never from the
  // selection itself: with Ctrl+A held, the selection's box is the whole note,
  // and effects that size themselves off it (the candle flame) blew up to fill
  // the window. The focus is where the caret sits either way.
  function caretRect() {
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const node = sel.focusNode;
      let r = null;
      if (node) {
        const max = node.nodeType === 3 ? node.length : node.childNodes.length;
        const cr = document.createRange();
        cr.setStart(node, Math.max(0, Math.min(sel.focusOffset, max)));
        cr.collapse(true);
        r = cr.getBoundingClientRect();
      }
      const measured = !!r && (r.height > 0);
      if (!measured) r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r || (!r.top && !r.left)) return null;
      // One line, always. When the collapsed range could not be measured the
      // box in hand may be the whole selection, so only its corner is used and
      // the height comes from the CSS.
      let h = measured ? r.height : 0;
      if (!h) {
        const el2 = node && (node.nodeType === 1 ? node : node.parentElement);
        h = (el2 && parseFloat(getComputedStyle(el2).lineHeight)) || 18;
      }
      h = Math.min(48, Math.max(10, h));
      const top = r.top;
      const width = measured ? Math.min(r.width, 40) : 1;
      return {
        x: r.left + width / 2, y: top + h / 2,
        top, bottom: top + h, left: r.left, right: r.left + width
      };
    } catch (e) { return null; }
  }

  // A canvas filling one of the two layers, at an optional fraction of the
  // window's real pixel size. Anything soft — glows, gradients, clouds — can
  // be drawn small and stretched by the CSS at a fraction of the fill cost;
  // `scale` sets that up so the drawing code can still work in CSS pixels.
  function makeCanvas(parent, className, scale) {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    parent.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const s = scale || 1;
    const state = { canvas, ctx, w: 0, h: 0 };
    state.resize = () => {
      state.w = window.innerWidth;
      state.h = window.innerHeight;
      canvas.width = Math.max(1, Math.round(state.w * s));
      canvas.height = Math.max(1, Math.round(state.h * s));
      if (s !== 1) ctx.setTransform(s, 0, 0, s, 0, 0);
    };
    state.resize();
    return state;
  }

  // The editor's own font and colour, so text an effect draws (the ghosts of
  // deleted words) matches what the note is set in rather than guessing.
  function editorTextStyle() {
    const el2 = document.querySelector('.editor-area');
    if (!el2) return { font: '13px monospace', color: '200,200,200' };
    const cs = getComputedStyle(el2);
    const m = (cs.color || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
    return {
      font: cs.fontSize + ' ' + cs.fontFamily,
      color: m ? m[1] + ',' + m[2] + ',' + m[3] : '200,200,200'
    };
  }


  // ────────────────────────────────────────────────────────────────────────
  // Shared audio, for the themes whose whole point is what they sound like.
  //
  // Everything is synthesised. Sample files would sound better for about a
  // week and then the same three recordings would loop under every word you
  // write; a little randomness per keystroke is what stops a keyboard sounding
  // like a machine playing a keyboard back at you.
  //
  // The context is created lazily on the first keystroke, which is also a user
  // gesture — starting one at theme-switch time gets it suspended and the
  // first dozen keys are silent.
  // ────────────────────────────────────────────────────────────────────────
  let audioCtx = null;
  let masterGain = null;
  let noiseBuf = null;
  let volume = 0.6;

  function audio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(audioCtx.destination);
      // One second of white noise, reused for every click. Each hit plays a
      // random slice of it, so no two strikes are the same waveform.
      const n = Math.floor(audioCtx.sampleRate);
      noiseBuf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v)));
    if (masterGain) masterGain.gain.value = volume;
  }

  // Close the context when the last sound theme goes away, so a silent theme
  // isn't holding an audio device open for the rest of the session.
  function closeAudio() {
    if (!audioCtx) return;
    try { audioCtx.close(); } catch (e) {}
    audioCtx = null;
    masterGain = null;
    noiseBuf = null;
  }

  // A filtered burst of noise: the clack of the switch itself.
  // `at` schedules it that many seconds ahead on the audio clock — setTimeout
  // is nowhere near tight enough for the 10ms gaps a mechanism is made of.
  function click(freq, q, gain, decay, at) {
    const ctx = audio();
    if (!ctx || !noiseBuf || volume <= 0) return;
    const now = ctx.currentTime + (at || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    // A random offset into the noise, so repeated keys never phase together.
    const off = Math.random() * (noiseBuf.duration - decay - 0.01);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    // Exponential, not linear: a linear tail on a click reads as a tick
    // followed by a fade, which is not a sound anything physical makes.
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    src.connect(bp); bp.connect(g); g.connect(masterGain);
    src.start(now, Math.max(0, off), decay + 0.02);
    src.stop(now + decay + 0.02);
  }

  // The body of the keycap hitting the plate — the low half of the sound.
  function thock(freq, gain, decay, at) {
    const ctx = audio();
    if (!ctx || volume <= 0) return;
    const now = ctx.currentTime + (at || 0);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(g); g.connect(masterGain);
    osc.start(now);
    osc.stop(now + decay + 0.01);
  }

  // ---- Real recordings, when there are any ----
  //
  // Everything else in here is synthesised, and synthesis has a ceiling: rain
  // is thousands of overlapping impacts with a room around them, and a keyboard
  // is a specific piece of plastic on a specific desk. Neither is something an
  // oscillator gets all the way to.
  //
  // So the sound themes look for real audio first and fall back to synthesis
  // when it is not there. Drop files into src/sounds/ and they are used
  // automatically — nothing to configure, no code to change:
  //
  //   rain.ogg     a seamless loop of rainfall
  //   thunder.ogg  one roll, played occasionally
  //   fire.ogg     a seamless loop of a fire burning
  //   key1.ogg ... one keystroke each; as many as you like, picked at random
  //   space.ogg    the spacebar
  //   enter.ogg    the return key
  //
  // .ogg, .mp3 and .wav are all tried, in that order. A missing file is not an
  // error — the theme just uses its synthesised voice instead, which is what
  // ships today.
  const sampleCache = new Map();

  function sampleUrl(name, ext) { return 'sounds/' + name + '.' + ext; }

  // Resolves to an AudioBuffer, or null if there is no such file. Cached both
  // ways, so a missing sample costs one failed fetch per session rather than
  // one per keystroke.
  function loadSample(name) {
    if (sampleCache.has(name)) return sampleCache.get(name);
    const ctx = audio();
    if (!ctx) return Promise.resolve(null);
    const tryNext = async (exts) => {
      for (const ext of exts) {
        try {
          const res = await fetch(sampleUrl(name, ext));
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          return await ctx.decodeAudioData(buf);
        } catch (e) { /* not there, or not decodable — try the next */ }
      }
      return null;
    };
    const p = tryNext(['ogg', 'mp3', 'wav']);
    sampleCache.set(name, p);
    return p;
  }

  // Fire and forget a one-shot sample. Returns whether one was actually
  // available, so a caller can synthesise instead when it was not.
  let sampleReady = {};
  function playSample(name, gain, rate) {
    const ctx = audio();
    if (!ctx || volume <= 0) return false;
    const buf = sampleReady[name];
    if (!buf) {
      // Warm it for next time; this call falls back to synthesis.
      if (sampleReady[name] === undefined) {
        sampleReady[name] = null;
        loadSample(name).then((b) => { sampleReady[name] = b || null; });
      }
      return false;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // A touch of pitch variation, so a handful of files does not read as a
    // handful of files.
    src.playbackRate.value = rate || (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = gain == null ? 1 : gain;
    src.connect(g); g.connect(masterGain);
    src.start();
    return true;
  }

  // A looping bed from a file, if there is one. Same handle shape as
  // noiseBed() so a theme can hold either without caring which it got.
  async function sampleBed(name, gain) {
    const ctx = audio();
    if (!ctx) return null;
    const buf = await loadSample(name);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = gain || 0.3;
    src.connect(g); g.connect(masterGain);
    src.start();
    return {
      gain: g,
      set(v, over) {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(Math.max(0.0001, v), now + (over || 0.4));
      },
      stop() {
        try { src.stop(); } catch (e) {}
        try { src.disconnect(); g.disconnect(); } catch (e) {}
      }
    };
  }

  // How many key samples were found, so a keystroke can pick one at random.
  let keySampleCount = -1;
  async function countKeySamples() {
    if (keySampleCount >= 0) return keySampleCount;
    keySampleCount = 0;
    for (let i = 1; i <= 12; i++) {
      const b = await loadSample('key' + i);
      if (!b) break;
      sampleReady['key' + i] = b;
      keySampleCount = i;
    }
    for (const n of ['space', 'enter', 'back']) {
      const b = await loadSample(n);
      if (b) sampleReady[n] = b;
    }
    return keySampleCount;
  }

  // One keystroke. Uses a recording when one is present and reports back so
  // the caller can synthesise when it is not.
  function playKeySample(kind, gain) {
    if (kind === 'space' && sampleReady.space) return playSample('space', gain);
    if (kind === 'enter' && sampleReady.enter) return playSample('enter', gain);
    if (kind === 'back' && sampleReady.back) return playSample('back', gain);
    if (keySampleCount > 0) {
      return playSample('key' + (1 + Math.floor(Math.random() * keySampleCount)), gain);
    }
    return false;
  }

  // A struck piece of metal.
  //
  // A sine is a flute and a filtered noise burst is a hiss; neither sounds
  // like steel, and stacking harmonics does not help — a harmonic series is a
  // *string*. What makes metal sound like metal is that it rings at ratios
  // that are not whole numbers, so the partials never line up into a pitch
  // and you hear a clang instead of a note. The ratios below are close to a
  // small struck bar. Higher partials are quieter and die faster, which is the
  // other half of it: the brightness collapses in the first few milliseconds
  // and a dull hum is left.
  const METAL_PARTIALS = [1, 2.39, 3.94, 6.12, 8.71];

  function metalHit(f0, gain, decay, at) {
    const ctx = audio();
    if (!ctx || volume <= 0) return;
    const now = ctx.currentTime + (at || 0);
    for (let i = 0; i < METAL_PARTIALS.length; i++) {
      // Anything past Nyquist gets clamped by the engine, and a clamped
      // partial sits right on the edge where it aliases into a harsh whistle.
      // A crackle at 3.4kHz has an eighth partial near 30kHz, so this is not
      // hypothetical — it was firing on every big pop in Hearth.
      const f = f0 * METAL_PARTIALS[i];
      if (f > 17000) break;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // Detuned a hair each time. Two identical strikes in a row is the thing
      // that gives synthesis away faster than any amount of wrong timbre.
      osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.03);
      const g = ctx.createGain();
      const a = gain * Math.pow(0.56, i);
      const d = Math.max(0.012, decay * Math.pow(0.6, i));
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(a, now + 0.0006);   // effectively instant
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      osc.connect(g); g.connect(masterGain);
      osc.start(now);
      osc.stop(now + d + 0.02);
    }
  }

  // The first few milliseconds of any impact: broadband, before the body has
  // had time to ring. Highpassed, because the low end of it is the thud and
  // that is voiced separately.
  function impact(gain, decay, at) {
    const ctx = audio();
    if (!ctx || !noiseBuf || volume <= 0) return;
    const now = ctx.currentTime + (at || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    src.connect(hp); hp.connect(g); g.connect(masterGain);
    src.start(now, Math.random() * (noiseBuf.duration - decay - 0.01), decay + 0.02);
    src.stop(now + decay + 0.02);
  }

  // A pawl running up a tooth flank before it drops off the top. Short, rising
  // and filtered — leaving it out is why a synthesised ratchet sounds like a
  // click track: a real one is a scrape *and* a click, in that order.
  function scrape(dur, gain, at) {
    const ctx = audio();
    if (!ctx || !noiseBuf || volume <= 0) return;
    const now = ctx.currentTime + (at || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, now);
    bp.frequency.linearRampToValueAtTime(4200, now + dur);
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    // Starting the ramp at a fifth of the target rather than at silence.
    // An exponential from 0.0001 puts essentially all of its energy in the
    // last millisecond, which measured as inaudible — the scrape was there in
    // the graph and not in the sound.
    g.gain.setValueAtTime(gain * 0.2, now);
    g.gain.exponentialRampToValueAtTime(gain, now + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.006);
    src.connect(bp); bp.connect(g); g.connect(masterGain);
    src.start(now, Math.random() * (noiseBuf.duration - dur - 0.02), dur + 0.03);
    src.stop(now + dur + 0.03);
  }


  // ────────────────────────────────────────────────────────────────────────
  // Shared 32-bit-console renderer.
  //
  // The Nostalgia themes are scenes, not filters, and they all need the same
  // four things: a buffer at a fraction of the window, ordered dithering, a
  // small palette, and whole-pixel drawing. That is the era in four bullet
  // points — the hardware had no sub-pixel precision, no smooth gradients and
  // very little colour, and the crosshatch you remember is what came out of
  // dithering between the few shades it did have.
  //
  // Scenes draw through this and never touch the canvas directly, so they all
  // sit in the same world and a change to the look lands on all of them.
  // ────────────────────────────────────────────────────────────────────────

  // The standard 4x4 ordered-dither threshold matrix.
  const BAYER4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];

  function makeRetro(parent, cellPx) {
    const CELL = cellPx || 5;
    const st = {
      canvas: null, ctx: null, img: null, d: null,
      W: 0, H: 0, CELL,
      // Deterministic noise, so a skyline or a starfield is the same shape
      // from one frame to the next without storing it.
      //
      // Math.imul, not `*`. A plain multiply of two 32-bit integers lands
      // around 2^61, well past the 2^53 a double can hold exactly, so the low
      // bits — the only ones the following shift and mask actually read — come
      // out as rounding noise. This function used to return nothing above 0.5,
      // which meant every `hash(..) > 0.7` test in these scenes was dead code:
      // the city had exactly zero lit windows and nobody could see why.
      hash(x, y) {
        let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      }
    };
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-retro-canvas';
    parent.appendChild(canvas);
    st.canvas = canvas;
    st.ctx = canvas.getContext('2d');

    st.resize = () => {
      st.W = Math.max(8, Math.ceil(window.innerWidth / CELL));
      st.H = Math.max(8, Math.ceil(window.innerHeight / CELL));
      canvas.width = st.W;
      canvas.height = st.H;
      st.ctx.setTransform(1, 0, 0, 1, 0, 0);
      st.img = st.ctx.createImageData(st.W, st.H);
      st.d = st.img.data;
      for (let i = 3; i < st.d.length; i += 4) st.d[i] = 255;
    };
    st.resize();

    // A missing colour is skipped rather than thrown on. An exception inside
    // a scene's tick does not just drop a frame — it stops the animation for
    // good, because the requestAnimationFrame that would schedule the next one
    // is at the end of the function it just escaped. One bad index should cost
    // a pixel, not the theme.
    st.px = (x, y, c) => {
      if (!c) return;
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= st.W || y >= st.H) return;
      const p = (y * st.W + x) * 4;
      st.d[p] = c[0]; st.d[p + 1] = c[1]; st.d[p + 2] = c[2]; st.d[p + 3] = 255;
    };

    // A pixel blended over what is already there — for anything that is a
    // light rather than a surface: a flame's glow, a lamp's cone, spray.
    st.blend = (x, y, c, a) => {
      if (!c) return;
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= st.W || y >= st.H || a <= 0) return;
      const p = (y * st.W + x) * 4;
      const k = a > 1 ? 1 : a;
      st.d[p] += (c[0] - st.d[p]) * k;
      st.d[p + 1] += (c[1] - st.d[p + 1]) * k;
      st.d[p + 2] += (c[2] - st.d[p + 2]) * k;
      st.d[p + 3] = 255;
    };

    st.rect = (x, y, w, h, c) => {
      if (!c) return;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) st.px(x + i, y + j, c);
    };

    // The one that matters: a vertical gradient quantised to `ramp` and
    // dithered between its steps. Straight interpolation would give a smooth
    // gradient, which is exactly what this hardware could not do — the
    // crosshatch between bands is the whole signature.
    st.vgrad = (y0, y1, ramp, curve) => {
      const n = ramp.length - 1;
      for (let y = Math.max(0, y0 | 0); y < Math.min(st.H, y1 | 0); y++) {
        let t = (y - y0) / Math.max(1, y1 - y0);
        if (curve) t = Math.pow(t, curve);
        // NaN would sail through Math.min/Math.max and index the ramp with it.
        const base = isFinite(t) ? t * n : 0;
        for (let x = 0; x < st.W; x++) {
          const th = BAYER4[(y & 3) * 4 + (x & 3)] / 16;
          const bi = Math.floor(base + th);
          st.px(x, y, ramp[bi < 0 ? 0 : (bi > n ? n : bi)]);
        }
      }
    };

    // A dithered wash of one colour at a coverage from 0 to 1 — fog, glow,
    // a shadow. Same trick, one colour: the threshold decides whether each
    // pixel takes it at all, so you get a stipple instead of a blend.
    st.stipple = (x, y, w, h, c, cover) => {
      for (let j = 0; j < h; j++) {
        const yy = (y + j) | 0;
        for (let i = 0; i < w; i++) {
          const xx = (x + i) | 0;
          const th = BAYER4[(yy & 3) * 4 + (xx & 3)] / 16;
          if (cover > th) st.px(xx, yy, c);
        }
      }
    };

    st.flush = () => st.ctx.putImageData(st.img, 0, 0);
    st.destroy = () => { try { canvas.remove(); } catch (e) {} };
    return st;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Old TV — a CRT that never quite settles: scanlines, a rolling refresh
  // band, and the slow brightness wander of a tube warming up.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.crt = {
    start() {
      const l = layer();
      if (!l) return;
      const roll = document.createElement('div');
      roll.className = 'fx-crt-roll';
      l.appendChild(roll);

      let y = -0.3;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(64, now - last);
        last = now;
        y += dt / 5200;          // one sweep every ~5s
        if (y > 1.25) y = -0.3;
        roll.style.transform = 'translate3d(0,' + (y * 100).toFixed(2) + 'vh,0)';
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() { stopRaf(); }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Matrix — glyph rain behind the UI. Sits in #fxBack so the panels read on
  // top of it rather than being washed out by it.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.rain = {
    start() {
      const b = back();
      if (!b) return;
      const canvas = document.createElement('canvas');
      canvas.className = 'fx-rain-canvas';
      b.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
      const SIZE = 14;
      let cols = 0;
      let drops = [];

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        cols = Math.ceil(canvas.width / SIZE);
        // Start columns scattered down the full height rather than all above
        // the top edge, so the rain is established immediately instead of
        // taking ten seconds to fill in.
        const rows = canvas.height / SIZE;
        drops = new Array(cols).fill(0).map(() => Math.random() * rows);
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let last = performance.now();
      const tick = (now) => {
        if (now - last > 55) {
          last = now;
          // Fade rather than clear, so each glyph leaves a decaying tail.
          ctx.fillStyle = 'rgba(0,0,0,0.09)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.font = SIZE + 'px monospace';
          for (let i = 0; i < cols; i++) {
            const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
            const x = i * SIZE;
            const y = drops[i] * SIZE;
            // Head of the column is bright, the trail behind it is dim.
            ctx.fillStyle = Math.random() > 0.94 ? '#dfffe6' : '#00e83c';
            ctx.fillText(ch, x, y);
            if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
            drops[i]++;
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Storm — drifting storm clouds behind the UI, struck by lightning: ambiently
  // at random intervals, and again on every keystroke while you're typing.
  // The bolt algorithm (jagged top-down walk, occasional branch, additive glow,
  // fast decay) is the one from raminturne.com's hero — same shape, restyled
  // to sit behind a text editor instead of a photo.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.storm = {
    start() {
      const b = back();
      if (!b) return;
      const wrap = document.createElement('div');
      wrap.className = 'fx-storm-wrap';
      const cloudCanvas = document.createElement('canvas');
      cloudCanvas.className = 'fx-storm-clouds';
      const boltCanvas = document.createElement('canvas');
      boltCanvas.className = 'fx-storm-bolts';
      wrap.appendChild(cloudCanvas);
      wrap.appendChild(boltCanvas);
      b.appendChild(wrap);

      const cctx = cloudCanvas.getContext('2d');
      const bctx = boltCanvas.getContext('2d');
      let w = 0;
      let h = 0;
      // The cloud layer is drawn into a quarter-scale buffer and stretched by
      // the CSS — six blurred gradients lose nothing at that size, and it cuts
      // the fill cost by ~16x. Bolts stay full-resolution: they are thin lines.
      const CLOUD_SCALE = 0.25;
      const resize = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        cloudCanvas.width = Math.max(1, Math.round(w * CLOUD_SCALE));
        cloudCanvas.height = Math.max(1, Math.round(h * CLOUD_SCALE));
        // Draw in CSS pixels regardless, so the cloud code below is unchanged.
        cctx.setTransform(CLOUD_SCALE, 0, 0, CLOUD_SCALE, 0, 0);
        boltCanvas.width = w; boltCanvas.height = h;
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, c) => a + Math.random() * (c - a);

      // A handful of large, soft, slowly-drifting blobs standing in for a
      // proper noise field — cheap enough to run continuously behind a text
      // editor, and reads as cloud cover at this scale.
      const BLOBS = Array.from({ length: 6 }, () => ({
        x: Math.random(), y: Math.random() * 0.6,
        r: 0.35 + Math.random() * 0.35,
        vx: (Math.random() - 0.5) * 0.006,
        vy: (Math.random() - 0.5) * 0.002,
        a: 0.045 + Math.random() * 0.05
      }));

      let strikes = [];
      let nextAmbientAt = 0;

      const makeBolt = () => {
        const segs = [];
        let x = rand(w * 0.1, w * 0.9);
        let y = 0;
        const step = rand(22, 40);
        let width = rand(2, 3.4);
        const endY = h * rand(0.55, 0.92);
        while (y < endY) {
          const nx = Math.min(w * 0.95, Math.max(w * 0.05, x + rand(-32, 32)));
          const ny = y + step + rand(-6, 12);
          segs.push({ x1: x, y1: y, x2: nx, y2: ny, w: width });
          if (Math.random() < 0.16) {
            const bx = Math.min(w, Math.max(0, nx + rand(-60, 60)));
            const by = ny + rand(24, 60);
            segs.push({ x1: nx, y1: ny, x2: bx, y2: by, w: width * 0.5 });
          }
          x = nx; y = ny;
          width *= 0.97;
        }
        return segs;
      };

      const strike = () => {
        if (!w || !h) return;
        strikes.push({ bolt: makeBolt(), alpha: 1, flash: rand(0.5, 0.9) });
        if (strikes.length > 5) strikes.shift();
      };

      const scheduleAmbient = (now) => { nextAmbientAt = now + rand(3200, 8000); };

      // Keystrokes strike too — capture phase, so it fires no matter which
      // element inside the app currently has focus.
      let lastKeyStrike = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const now = performance.now();
        if (now - lastKeyStrike < 140) return;   // don't strobe under fast typing
        lastKeyStrike = now;
        strike();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      let nextCloudAt = 0;
      let cloudLast = performance.now();
      let boltsDrawn = false;

      // Clouds are six soft gradients — nothing in them needs 60fps or full
      // resolution, and repainting six screen-sized gradients every frame was
      // enough to be felt as typing lag. They now redraw ~14 times a second
      // into a quarter-scale buffer the CSS stretches back up; the blobs move
      // per elapsed second, so the drift looks exactly as it did before.
      const drawClouds = (now) => {
        const step = Math.min((now - cloudLast) / 16.7, 6);
        cloudLast = now;
        cctx.fillStyle = '#020306';
        cctx.fillRect(0, 0, w, h);
        for (const c of BLOBS) {
          c.x += c.vx * step; c.y += c.vy * step;
          if (c.x < -0.2) c.x = 1.2; else if (c.x > 1.2) c.x = -0.2;
          if (c.y < -0.1) c.y = 0.7; else if (c.y > 0.7) c.y = -0.1;
          const cx = c.x * w, cy = c.y * h, r = c.r * Math.max(w, h);
          const g = cctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(55,64,82,' + c.a + ')');
          g.addColorStop(1, 'rgba(55,64,82,0)');
          cctx.fillStyle = g;
          cctx.fillRect(0, 0, w, h);
        }
      };

      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        if (now >= nextCloudAt) { drawClouds(now); nextCloudAt = now + 70; }

        if (now >= nextAmbientAt) { strike(); scheduleAmbient(now); }

        // Nothing is striking: leave the bolt layer alone instead of clearing
        // a screen-sized canvas 60 times a second for no pixels.
        if (strikes.length || boltsDrawn) {
          bctx.clearRect(0, 0, w, h);
          boltsDrawn = false;
          bctx.save();
          bctx.globalCompositeOperation = 'lighter';
          for (const s of strikes) {
            if (s.flash > 0.001) {
              bctx.fillStyle = 'rgba(220,225,235,' + (s.flash * 0.14) + ')';
              bctx.fillRect(0, 0, w, h);
              boltsDrawn = true;
            }
          }
          bctx.lineCap = 'round';
          bctx.lineJoin = 'round';
          // The glow used to be shadowBlur, which Chromium renders by blurring
          // the whole stroke offscreen — per segment, per frame, on the very
          // frames a keystroke had just added a bolt. Two passes (a wide dim
          // stroke under a bright thin one) read the same and cost nothing.
          for (const s of strikes) {
            if (s.alpha <= 0.001) continue;
            boltsDrawn = true;
            for (const pass of [0, 1]) {
              bctx.strokeStyle = pass
                ? 'rgba(225,230,245,' + s.alpha + ')'
                : 'rgba(160,180,235,' + (s.alpha * 0.22) + ')';
              bctx.beginPath();
              for (const seg of s.bolt) {
                bctx.lineWidth = pass ? seg.w : seg.w * 5;
                bctx.moveTo(seg.x1, seg.y1);
                bctx.lineTo(seg.x2, seg.y2);
              }
              bctx.stroke();
            }
          }
          bctx.restore();
        }

        for (const s of strikes) {
          s.flash = Math.max(0, s.flash - dt * 3.2);
          s.alpha = Math.max(0, s.alpha - dt * 4.5);
        }
        strikes = strikes.filter((s) => s.flash > 0 || s.alpha > 0);

        rafId = requestAnimationFrame(tick);
      };
      scheduleAmbient(performance.now());
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Wounds — every keystroke opens a cut in the app. The slash lands where
  // the caret is (so you are cutting the line you are typing), beads of blood
  // gather along it, run down under gravity leaving a drying trail, and the
  // whole thing darkens and fades out.
  //
  // Drawn into #fxLayer, above the UI: the wound is *on* the app, not behind
  // it. Nothing here reads or writes app state — only the caret rectangle,
  // which is a measurement.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.wound = {
    start() {
      const l = layer();
      if (!l) return;
      const canvas = document.createElement('canvas');
      canvas.className = 'fx-wound-canvas';
      l.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      let w = 0;
      let h = 0;
      const resize = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = w;
        canvas.height = h;
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, b) => a + Math.random() * (b - a);

      // Short lives on purpose: at speed you open cuts faster than they can
      // close, and a wound that is *removed* mid-fade to make room reads as a
      // glitch. Everything here fades out — nothing is ever deleted on screen.
      const CUT_LIFE = 2.4;    // seconds a cut takes to close up
      const DROP_LIFE = 3.4;   // a run of blood outlives the cut that made it
      const MAX_CUTS = 14;
      const MAX_DROPS = 90;
      const RUSH = 5;          // how much faster the overflow fades away

      let cuts = [];
      let drops = [];
      let painted = false;     // is there anything on the canvas right now

      // The blade lands where the caret is; the drip starts under its line.
      const caretPoint = caretRect;

      // Lines close enough to the caret to plausibly be on screen. Only these
      // ever need protecting from a cut — nothing off-screen can be crossed by
      // one, since the canvas is the whole window. Walking outward from
      // .caret-line (kept live by the renderer) costs nothing but pointer
      // chasing, unlike querying every line in the note: a 6000-line note
      // measured in full took 14-17ms of synchronous work on the keydown that
      // refreshed the cache below — over a full frame, and felt as a stutter
      // right in the middle of typing. Capped at a fixed count either side,
      // so the cost stays flat no matter how long the note grows.
      const NEARBY_MARGIN = 80;
      function nearbyLineNodes() {
        const anchor = document.querySelector('.editor-area .caret-line');
        if (anchor) {
          const out = [anchor];
          let p = anchor;
          let n = anchor;
          for (let i = 0; i < NEARBY_MARGIN && (p || n); i++) {
            if (p) { p = p.previousElementSibling; if (p) out.push(p); }
            if (n) { n = n.nextElementSibling; if (n) out.push(n); }
          }
          return out;
        }
        // No live caret line (e.g. editing inside the markdown preview, which
        // has no caret-line concept) — fall back to a capped scan. Preview
        // blocks are usually far fewer than raw editor lines, so this rarely
        // bites, but the cap keeps it bounded either way.
        return Array.from(document.querySelectorAll('.editor-area .ln, .md-preview [data-line]'))
          .slice(0, NEARBY_MARGIN * 2 + 1);
      }

      // Every rectangle on screen that has words in it. Cuts steer around
      // these: a slash across the line you are typing hides the one thing you
      // need to see. Measured with a Range, not the element box, so an RTL
      // line only protects the glyphs and not the empty half of its row.
      // Cached briefly — this runs on a keystroke, and a long note has a lot
      // of lines.
      let rectCache = null;
      let rectCacheAt = 0;
      const textRects = () => {
        const now = performance.now();
        if (rectCache && now - rectCacheAt < 400) return rectCache;
        const out = [];
        const range = document.createRange();
        nearbyLineNodes().forEach((el) => {
          if (!el.textContent.trim()) return;
          try {
            range.selectNodeContents(el);
            const r = range.getBoundingClientRect();
            if (r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < h) out.push(r);
          } catch (e) { /* element went away mid-measure */ }
        });
        rectCache = out;
        rectCacheAt = now;
        return out;
      };

      // A cut is a short, slightly bowed arc — a blade does not travel in a
      // straight line, and a straight line reads as a UI divider, not a wound.
      // Where it lands is chosen by rejection: somewhere random, anywhere in
      // the window, as long as none of it crosses text.
      const PAD = 10;
      let lastCut = null;
      const makeCut = () => {
        if (!w || !h) return;
        const rects = textRects();
        const overText = (x, y) => {
          for (const r of rects) {
            if (x > r.left - PAD && x < r.right + PAD && y > r.top - PAD && y < r.bottom + PAD) return true;
          }
          return false;
        };

        let pts = null;
        for (let attempt = 0; attempt < 18 && !pts; attempt++) {
          const cx = rand(w * 0.05, w * 0.95);
          const cy = rand(h * 0.05, h * 0.92);
          // Keep them scattered: early attempts refuse to land on top of the
          // last cut, so a burst of typing spreads across the window instead
          // of shredding one corner.
          if (attempt < 10 && lastCut &&
              Math.hypot(cx - lastCut.x, cy - lastCut.y) < 150) continue;
          // Later attempts try shorter blades — in a crowded window a small
          // cut still fits between two lines.
          const len = rand(34, 104) * (attempt < 12 ? 1 : 0.5);
          let ang = rand(-1.15, -0.32);
          if (Math.random() < 0.45) ang = Math.PI - ang;
          const bow = rand(-0.16, 0.16) * len;
          const nx = Math.cos(ang + Math.PI / 2);
          const ny = Math.sin(ang + Math.PI / 2);
          const N = 16;
          const cand = [];
          let clear = true;
          for (let i = 0; i <= N; i++) {
            const t = i / N;
            const off = Math.sin(t * Math.PI) * bow;
            const x = cx + Math.cos(ang) * (t - 0.5) * len + nx * off + rand(-1.2, 1.2);
            const y = cy + Math.sin(ang) * (t - 0.5) * len + ny * off + rand(-1.2, 1.2);
            if (x < 4 || x > w - 4 || y < 4 || y > h - 4 || overText(x, y)) { clear = false; break; }
            cand.push({ t, x, y });
          }
          if (clear) { pts = cand; lastCut = { x: cx, y: cy }; }
        }
        // Nothing but text on screen right now — skip the cut rather than
        // slashing through what is being written.
        if (!pts) return;

        cuts.push({ pts, life: 1, width: rand(1.5, 3.1) });
        // Over the cap the oldest do not disappear, they are simply told to
        // hurry: the fade still happens, just in a few tenths of a second.
        for (let i = 0; i < cuts.length - MAX_CUTS; i++) cuts[i].rush = RUSH;

        // Blood gathers where the cut is deepest — the middle — and only after
        // a beat, so the wound is seen opening before it bleeds.
        const beads = 1 + (Math.random() * 2 | 0);
        for (let i = 0; i < beads; i++) {
          const p2 = pts[3 + (Math.random() * (pts.length - 5) | 0)] || pts[0];
          drops.push({
            x: p2.x, y: p2.y, vy: 0, vx: rand(-6, 6),
            r: rand(1, 2.2), life: 1, wait: rand(0.05, 0.4), trail: []
          });
        }
        for (let i = 0; i < drops.length - MAX_DROPS; i++) drops[i].rush = RUSH;
      };

      // The line you are typing bleeds too — but from *under* it, never across
      // it. A bead forms just below the caret and runs down the page, so the
      // damage follows your hand without covering a single letter.
      const bleedUnderCaret = () => {
        const c = caretPoint();
        if (!c) return;
        drops.push({
          x: c.x + rand(-16, 16), y: c.bottom + rand(1, 5), vy: 0, vx: rand(-4, 4),
          r: rand(0.8, 1.6), life: 1, wait: rand(0.02, 0.3), trail: []
        });
        for (let i = 0; i < drops.length - MAX_DROPS; i++) drops[i].rush = RUSH;
      };

      let lastKeyCut = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const now = performance.now();
        if (now - lastKeyCut < 45) return;
        lastKeyCut = now;
        makeCut();
        // Not on every keystroke, or the line you are typing turns into a
        // curtain of blood within a sentence.
        if (Math.random() < 0.5) bleedUnderCaret();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // Fresh blood is bright and wet; as a run dries and the wound closes it
      // goes brown, so `life` drives colour as well as alpha.
      const blood = (life, a) => {
        const dry = 1 - life;
        const r = Math.round(168 - dry * 88);
        const g = Math.round(12 + dry * 6);
        const b = Math.round(16 + dry * 4);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
      };

      const drawCut = (cut) => {
        const a = cut.life < 0.4 ? cut.life / 0.4 : 1;
        const pts = cut.pts;
        // Three passes, outside in: the split skin, the open gash, then a lit
        // edge along one side so the cut has a lip instead of being a stroke.
        for (const pass of [0, 1, 2]) {
          for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const taper = Math.sin(((p0.t + p1.t) / 2) * Math.PI);
            if (taper < 0.02) continue;
            if (pass === 0) {
              ctx.strokeStyle = 'rgba(34,4,6,' + (a * 0.7).toFixed(3) + ')';
              ctx.lineWidth = cut.width * taper * 1.9 + 0.6;
            } else if (pass === 1) {
              ctx.strokeStyle = blood(cut.life, a * 0.95);
              ctx.lineWidth = cut.width * taper + 0.4;
            } else {
              ctx.strokeStyle = 'rgba(255,150,140,' + (a * 0.14).toFixed(3) + ')';
              ctx.lineWidth = Math.max(0.6, cut.width * taper * 0.28);
            }
            ctx.beginPath();
            if (pass === 2) {
              ctx.moveTo(p0.x, p0.y - cut.width * 0.45);
              ctx.lineTo(p1.x, p1.y - cut.width * 0.45);
            } else {
              ctx.moveTo(p0.x, p0.y);
              ctx.lineTo(p1.x, p1.y);
            }
            ctx.stroke();
          }
        }
      };

      const drawDrop = (d) => {
        const a = d.life < 0.5 ? d.life / 0.5 : 1;
        // The run it left behind, thinning and drying toward the top.
        for (let i = 1; i < d.trail.length; i++) {
          const t0 = d.trail[i - 1];
          const t1 = d.trail[i];
          const age = i / d.trail.length;   // 1 = nearest the bead
          ctx.strokeStyle = blood(d.life * (0.35 + age * 0.65), a * (0.25 + age * 0.5));
          ctx.lineWidth = Math.max(0.5, t1.r * (0.35 + age * 0.65));
          ctx.beginPath();
          ctx.moveTo(t0.x, t0.y);
          ctx.lineTo(t1.x, t1.y);
          ctx.stroke();
        }
        // The bead itself: pulled long by its own weight once it is moving.
        const stretch = 1 + Math.min(1.6, Math.abs(d.vy) / 240);
        ctx.fillStyle = blood(d.life, a);
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r, d.r * stretch, 0, 0, Math.PI * 2);
        ctx.fill();
        if (a > 0.5) {
          ctx.fillStyle = 'rgba(255,190,185,' + ((a - 0.5) * 0.22).toFixed(3) + ')';
          ctx.beginPath();
          ctx.ellipse(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.28, d.r * 0.34, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // Nothing bleeding and nothing left on the canvas: skip the frame
        // entirely rather than clearing a screen-sized canvas for no pixels.
        if (cuts.length || drops.length || painted) {
          ctx.clearRect(0, 0, w, h);
          painted = cuts.length > 0 || drops.length > 0;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const c of cuts) drawCut(c);
          for (const d of drops) {
            if (d.wait <= 0) drawDrop(d);   // still welling up inside the cut
          }
        }

        for (const c of cuts) c.life -= (dt / CUT_LIFE) * (c.rush || 1);
        cuts = cuts.filter((c) => c.life > 0);

        for (const d of drops) {
          if (d.wait > 0) { d.wait -= dt; continue; }
          d.vy += 240 * dt;                     // gravity, thick and slow
          d.vy = Math.min(d.vy, 320);
          d.y += d.vy * dt;
          d.x += d.vx * dt;
          d.vx *= 0.94;
          d.r = Math.max(0.5, d.r - dt * 0.28); // it leaves itself on the way down
          const tail = d.trail[d.trail.length - 1];
          if (!tail || Math.abs(d.y - tail.y) > 3) {
            d.trail.push({ x: d.x, y: d.y, r: d.r });
            if (d.trail.length > 44) d.trail.shift();
          }
          d.life -= (dt / DROP_LIFE) * (d.rush || 1);
          if (d.y > h + 20) d.life = Math.min(d.life, 0.2);
        }
        drops = drops.filter((d) => d.life > 0);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Ghosts — the only theme that reacts to what you *delete*. Every word you
  // take out stays where it was for a few seconds, pale and rising, before it
  // goes; and every so often something you cut a while ago flickers back for
  // an instant. The note remembers what you took out of it.
  //
  // The text is read from the range about to be deleted (a `beforeinput`
  // measurement) and drawn in the editor's own font — nothing is written back.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.ghost = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-ghost-canvas');
      const ctx = c.ctx;
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
      const LIFE = 5.5;        // long, because the fade is the whole point
      const MAX = 26;

      let ghosts = [];
      let memory = [];         // fragments of this session, for the echoes
      let word = '';           // what is being typed right now, letter by letter
      let painted = false;
      let style = editorTextStyle();
      let nextEcho = performance.now() + 1500;

      // No corners anywhere in the fade: in and out on a smoothstep, so a
      // ghost swells up out of nothing and sinks back without either end of
      // it being a visible edge.
      const ease = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

      // What is about to be removed, and where it sits. For a plain Backspace
      // the selection is collapsed, so the range is walked back one character
      // to find the letter under the cursor.
      const dying = () => {
        try {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return null;
          const r = sel.getRangeAt(0);
          let probe = r;
          if (r.collapsed) {
            probe = r.cloneRange();
            if (r.startOffset <= 0) return null;
            probe.setStart(r.startContainer, r.startOffset - 1);
          }
          const text = probe.toString();
          if (!text.trim()) return null;
          const box = probe.getBoundingClientRect();
          if (!box || (!box.top && !box.left)) return null;
          return { text: text.slice(-60), box };
        } catch (e) { return null; }
      };

      // One rasterisation per ghost, at full strength, into a bitmap just big
      // enough to hold it. Everything after that is a blit.
      const bake = (text, font, color, rtl) => {
        const cv = document.createElement('canvas');
        const probe = cv.getContext('2d');
        probe.font = font;
        const size = parseFloat(font) || 14;
        const pad = Math.ceil(size * 0.4) + 2;
        cv.width = Math.ceil(probe.measureText(text).width) + pad * 2;
        cv.height = Math.ceil(size * 1.7) + pad;
        const g2 = cv.getContext('2d');   // sizing the canvas resets its state
        g2.font = font;
        g2.textBaseline = 'top';
        g2.direction = rtl ? 'rtl' : 'ltr';
        g2.textAlign = rtl ? 'right' : 'left';
        g2.fillStyle = 'rgb(' + color + ')';
        g2.fillText(text, rtl ? cv.width - pad : pad, pad / 2);
        return { cv, pad };
      };

      const spawn = (text, rtl, x, y, peak) => {
        const baked = bake(text, style.font, style.color, rtl);
        ghosts.push({
          bmp: baked.cv, pad: baked.pad, rtl,
          // x is the edge the text was measured from; the bitmap carries the
          // padding, so shift by it to land the glyphs where the words were.
          x: rtl ? x - baked.cv.width + baked.pad : x - baked.pad,
          y: y - baked.pad / 2,
          life: 1, peak
        });
        if (ghosts.length > MAX) ghosts.shift();
      };

      const remember = (text, rtl) => {
        const t = text.slice(-40);
        if (memory.some((m) => m.text === t)) return;   // one entry per word
        memory.push({ text: t, rtl });
        if (memory.length > 60) memory.shift();
      };

      // A note you open has a past too. Without this, memory only ever filled
      // from `beforeinput`, so opening a note you wrote yesterday haunted you
      // with nothing at all until you typed — the room was empty precisely
      // where it had the most to remember. Seeding from the note's own words
      // costs nothing extra downstream: echo() already drops any word that
      // isn't in the note, so seeded and typed words are the same kind of thing.
      const seedFromNote = () => {
        const ed = document.querySelector('.editor-area');
        const text = ed ? ed.textContent : '';
        if (!text || !text.trim()) { memory = []; return; }
        // Words, not fragments — the same "longer than one character" bar that
        // remember() applies to what you type.
        const seen = new Set(memory.map((m) => m.text));
        const words = [];
        for (const raw of text.split(/[\s.,;:!?()[\]{}"'«»…،؛؟]+/)) {
          const w = raw.trim().slice(0, 40);
          if (w.length < 2 || seen.has(w)) continue;
          seen.add(w);
          words.push({ text: w, rtl: RTL_RE.test(w) });
        }
        // Take a spread across the whole note rather than the first 60 words,
        // so a long note doesn't only ever echo its opening paragraph.
        for (let i = words.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [words[i], words[j]] = [words[j], words[i]];
        }
        memory = memory.concat(words).slice(-60);
      };

      // Re-seed whenever the editor's whole content is swapped (tab switch,
      // undo, a whole-tab AI action). setEditorText() in the renderer raises
      // this; typing never does.
      const onNoteLoaded = () => {
        memory = [];
        noteAt = 0;      // drop the cached note text so inNote() re-reads it
        seedFromNote();
      };
      document.addEventListener('pp:note-loaded', onNoteLoaded);
      this._onNoteLoaded = onNoteLoaded;
      // The editor is already populated when a theme is switched on mid-session.
      seedFromNote();

      // What the note says right now. Read straight off the editor (the raw
      // lines are kept in the DOM even in markdown mode) and cached for a
      // moment, so checking a word costs nothing.
      let noteText = '';
      let noteAt = 0;
      const inNote = (word) => {
        const now = performance.now();
        if (now - noteAt > 700) {
          const ed = document.querySelector('.editor-area');
          noteText = ed ? ed.textContent : '';
          noteAt = now;
        }
        return noteText.indexOf(word) >= 0;
      };

      const onInput = (e) => {
        // Typing shows nothing at the time — it only files words. What you
        // write now is what surfaces, unasked, a few seconds from now.
        if (e.inputType === 'insertText' && e.data) {
          // Space (or any separator) closes the word behind the cursor and
          // files it — that word is now a candidate to surface later.
          if (/[\s.,;:!?()[\]{}"'«»…،؛؟]/.test(e.data)) {
            if (word.trim().length > 1) remember(word.trim(), RTL_RE.test(word));
            word = '';
          } else {
            word += e.data;
            if (word.length > 24) { remember(word, RTL_RE.test(word)); word = ''; }
          }
          return;
        }
        if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
          if (word.trim().length > 1) remember(word.trim(), RTL_RE.test(word));
          word = '';
          return;
        }
        if (!e.inputType || e.inputType.indexOf('delete') !== 0) return;
        const d = dying();
        if (!d) return;
        style = editorTextStyle();
        const rtl = RTL_RE.test(d.text);
        spawn(d.text, rtl, rtl ? d.box.right : d.box.left, d.box.top, 0.62);
      };
      document.addEventListener('beforeinput', onInput, true);
      this._onInput = onInput;

      // Something written (or cut) a while ago, surfacing somewhere it does
      // not belong. Nothing here is tied to the key you just pressed — it runs
      // on its own clock, which is what makes it read as haunting rather than
      // as feedback.
      const echo = () => {
        if (!memory.length) return;
        // Words you have since deleted do not haunt anything: the first time
        // one comes up for a turn it is checked against the note and dropped.
        let m = null;
        for (let i = 0; i < 6 && memory.length; i++) {
          const k = (Math.random() * memory.length) | 0;
          if (inNote(memory[k].text)) { m = memory[k]; break; }
          memory.splice(k, 1);
        }
        if (!m) return;
        // Re-read the font here too: an echo can surface long after the note
        // was resized, and a ghost baked at the old size looks like a bug.
        style = editorTextStyle();
        spawn(m.text, m.rtl,
          m.rtl ? c.w * (0.35 + Math.random() * 0.55) : c.w * (0.08 + Math.random() * 0.55),
          c.h * (0.1 + Math.random() * 0.75),
          0.16 + Math.random() * 0.16);
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // Often enough that the room is never quite empty: one every second
        // or three, and now and then two at once.
        if (now >= nextEcho) {
          echo();
          if (Math.random() < 0.3) echo();
          nextEcho = now + 750 + Math.random() * 2400;
        }

        if (ghosts.length || painted) {
          ctx.clearRect(0, 0, c.w, c.h);
          painted = ghosts.length > 0;
          for (const g of ghosts) {
            // Fade in over the first sliver of its life, then out — a ghost
            // that appears at full strength reads as a rendering glitch.
            let a = g.peak * ease((1 - g.life) * 7) * ease(g.life * 1.25);
            if (a <= 0.003) continue;
            // Sub-step noise: the fade crosses each of the 256 alpha levels
            // over several frames, and without this you watch it descend the
            // staircase. A little jitter around the true value averages out
            // to the value you wanted and reads as continuous.
            a += (Math.random() - 0.5) * 0.0055;
            ctx.globalAlpha = Math.max(0, Math.min(1, a));
            ctx.drawImage(g.bmp, g.x, g.y - (1 - g.life) * 10);
          }
          ctx.globalAlpha = 1;
        }

        for (const g of ghosts) g.life -= dt / LIFE;
        ghosts = ghosts.filter((g) => g.life > 0);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onInput) document.removeEventListener('beforeinput', this._onInput, true);
      if (this._onNoteLoaded) document.removeEventListener('pp:note-loaded', this._onNoteLoaded);
      this._resize = null;
      this._onInput = null;
      this._onNoteLoaded = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Ink — Wounds' calm twin, and the paper it is written on. Each keystroke
  // drops wet ink into the page: it soaks outward with a ragged edge, throws
  // a couple of satellite specks, then dries paler and stays a while.
  //
  // Drawn into #fxBack, *under* the UI — the surfaces of this theme are
  // translucent, so the ink blooms beneath the words instead of over them.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.ink = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-ink-canvas');
      const ctx = c.ctx;
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);
      const LIFE = 9;
      const MAX = 40;
      let blots = [];
      let painted = false;

      // A blot is a closed wobbly outline: one radius per angle, each with its
      // own bias, so no two are the same shape and none of them is a circle.
      const makeBlot = (x, y, r0) => {
        const N = 22;
        const edge = [];
        for (let i = 0; i < N; i++) {
          edge.push(rand(0.72, 1.28) + Math.sin(i * rand(1, 3)) * 0.08);
        }
        return { x, y, r: r0 * 0.25, rMax: r0, edge, life: 1, seed: Math.random() * 6.3 };
      };

      const spot = () => {
        const p = caretRect();
        const x = p ? p.x + rand(-70, 70) : rand(c.w * 0.1, c.w * 0.9);
        const y = p ? p.bottom + rand(-30, 60) : rand(c.h * 0.1, c.h * 0.9);
        blots.push(makeBlot(
          Math.min(c.w - 10, Math.max(10, x)),
          Math.min(c.h - 10, Math.max(10, y)),
          rand(14, 46)
        ));
        // Splashes: a drop that lands never lands alone.
        const n = Math.random() < 0.5 ? 1 : 2;
        for (let i = 0; i < n; i++) {
          blots.push(makeBlot(x + rand(-46, 46), y + rand(-34, 34), rand(3, 8)));
        }
        if (blots.length > MAX) blots.splice(0, blots.length - MAX);
      };

      let lastKey = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const now = performance.now();
        if (now - lastKey < 55) return;
        lastKey = now;
        spot();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const drawBlot = (bl) => {
        // Wet and near-black at first; dried ink on paper is a soft grey-blue.
        const dry = 1 - bl.life;
        const a = (bl.life > 0.82 ? (1 - bl.life) / 0.18 : 1) * (0.26 + bl.life * 0.6);
        const col = Math.round(28 + dry * 46);
        ctx.fillStyle = 'rgba(' + col + ',' + (col + 8) + ',' + (col + 26) + ',' + a.toFixed(3) + ')';
        ctx.beginPath();
        const N = bl.edge.length;
        for (let i = 0; i <= N; i++) {
          const k = i % N;
          const ang = (i / N) * Math.PI * 2;
          const rr = bl.r * bl.edge[k];
          const x = bl.x + Math.cos(ang) * rr;
          const y = bl.y + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        // The fibres of the paper pulling ink past the edge of the blot.
        if (bl.rMax > 10) {
          ctx.strokeStyle = 'rgba(' + col + ',' + (col + 8) + ',' + (col + 26) + ',' + (a * 0.5).toFixed(3) + ')';
          ctx.lineWidth = 0.7;
          for (let i = 0; i < N; i += 2) {
            const ang = (i / N) * Math.PI * 2 + bl.seed;
            const rr = bl.r * bl.edge[i];
            const hair = rr * (0.1 + ((i * 7) % 5) / 22);
            ctx.beginPath();
            ctx.moveTo(bl.x + Math.cos(ang) * rr, bl.y + Math.sin(ang) * rr);
            ctx.lineTo(bl.x + Math.cos(ang) * (rr + hair), bl.y + Math.sin(ang) * (rr + hair));
            ctx.stroke();
          }
        }
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        if (blots.length || painted) {
          ctx.clearRect(0, 0, c.w, c.h);
          painted = blots.length > 0;
          for (const bl of blots) drawBlot(bl);
        }

        for (const bl of blots) {
          // Soaks fast, then stops: paper only takes so much.
          bl.r += (bl.rMax - bl.r) * Math.min(1, dt * 5.5);
          bl.life -= dt / LIFE;
        }
        blots = blots.filter((bl) => bl.life > 0);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Embers — the bottom edge of the window is smouldering paper. Typing feeds
  // the fire: the glow climbs, and sparks lift off and die on their way up.
  // Stop, and it banks down to a dull char line waiting to be fed again.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.embers = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-embers-canvas');
      const ctx = c.ctx;
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, b) => a + Math.random() * (b - a);
      const MAX = 220;

      let sparks = [];
      let heat = 0.15;         // 0 = banked, 1 = burning
      let flicker = 0;

      // Sparks off the caret: the letter you just typed is the thing that
      // burns. They start just *above* the line and die within the leading —
      // starting at the baseline meant every spark climbed through the words
      // you were reading. Small, short-lived, and gone before they reach the
      // line above.
      const spawnAt = (p, n) => {
        for (let i = 0; i < n; i++) {
          sparks.push({
            x: p.x + rand(-13, 13),
            y: p.top - rand(1, 5),
            vx: rand(-8, 8),
            vy: -rand(14, 30),
            r: rand(0.5, 1.3),
            life: 1,
            fade: rand(1.1, 1.8),
            sway: rand(0, 6.3)
          });
        }
        if (sparks.length > MAX) sparks.splice(0, sparks.length - MAX);
      };

      const spawn = (n, hot) => {
        for (let i = 0; i < n; i++) {
          sparks.push({
            x: rand(0, c.w),
            y: c.h - rand(0, 14),
            vx: rand(-14, 14),
            vy: -rand(24, 78) * (hot ? 1.5 : 1),
            r: rand(0.9, 2.6),
            life: 1,
            fade: rand(0.18, 0.5),
            sway: rand(0, 6.3)
          });
        }
        if (sparks.length > MAX) sparks.splice(0, sparks.length - MAX);
      };

      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        heat = Math.min(1, heat + (e.key === 'Enter' ? 0.3 : 0.09));
        // Enter throws a real handful; an ordinary letter, a spark or two.
        spawn(e.key === 'Enter' ? 18 + (Math.random() * 12 | 0) : 2 + (Math.random() * 3 | 0),
          e.key === 'Enter');
        const p = caretRect();
        if (p) spawnAt(p, 2 + (Math.random() * 3 | 0));
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // Yellow-white at the heart, orange in the body, dark red as it dies.
      const emberColor = (life, a) => {
        const r = 255;
        const g = Math.round(60 + life * 175);
        const b = Math.round(20 + Math.max(0, life - 0.6) * 300);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        heat = Math.max(0.12, heat - dt * 0.16);
        flicker += dt * (5 + heat * 9);

        ctx.clearRect(0, 0, c.w, c.h);

        // The burning edge: a band of glow whose height and brightness are the
        // heat, with a flame-like wobble rather than a steady lamp.
        const wob = 0.82 + Math.sin(flicker) * 0.09 + Math.sin(flicker * 2.7) * 0.06;
        const bandH = (34 + heat * 120) * wob;
        const g = ctx.createLinearGradient(0, c.h, 0, c.h - bandH);
        g.addColorStop(0, 'rgba(255,150,40,' + (0.46 * heat * wob + 0.08).toFixed(3) + ')');
        g.addColorStop(0.35, 'rgba(226,74,16,' + (0.18 * heat * wob).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(120,20,6,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, c.h - bandH, c.w, bandH);
        // The char line itself, always there, brightening where it is hottest.
        ctx.fillStyle = 'rgba(255,120,30,' + (0.10 + heat * 0.5).toFixed(3) + ')';
        ctx.fillRect(0, c.h - 1.5, c.w, 1.5);

        for (const s of sparks) {
          const a = Math.min(1, s.life * 1.6);
          ctx.fillStyle = emberColor(s.life, a * 0.9);
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * (0.4 + s.life * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }

        for (const s of sparks) {
          s.sway += dt * 3;
          s.vy += 9 * dt;                       // it cools and stops climbing
          s.x += (s.vx + Math.sin(s.sway) * 12) * dt;
          s.y += s.vy * dt;
          s.life -= dt * s.fade;
        }
        sparks = sparks.filter((s) => s.life > 0 && s.y > -20);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Circuit — the app is a board, and you are its power supply. The traces
  // are laid down once (they never move); every keystroke sends a pulse of
  // current out from the caret, hopping node to node until it runs out.
  //
  // Two canvases: the etched board, painted once per resize and then left
  // alone, and the live one that only ever holds the pulses.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.circuit = {
    start() {
      const b = back();
      if (!b) return;
      const board = makeCanvas(b, 'fx-circuit-board');
      const live = makeCanvas(b, 'fx-circuit-live');

      const rand = (a, d) => a + Math.random() * (d - a);
      const STEP = 46;         // grid pitch of the traces

      let nodes = [];          // { x, y, links: [index...] , pad }
      let pulses = [];

      // A lattice with most of its links cut: what is left reads as routed
      // traces rather than as graph paper.
      const buildBoard = () => {
        board.resize();
        live.resize();
        const cols = Math.max(2, Math.ceil(board.w / STEP) + 1);
        const rows = Math.max(2, Math.ceil(board.h / STEP) + 1);
        nodes = [];
        const at = (cx, ry) => ry * cols + cx;
        for (let ry = 0; ry < rows; ry++) {
          for (let cx = 0; cx < cols; cx++) {
            nodes.push({
              x: cx * STEP + rand(-7, 7),
              y: ry * STEP + rand(-7, 7),
              links: [],
              pad: Math.random() < 0.16
            });
          }
        }
        const link = (a, d) => {
          if (!nodes[a] || !nodes[d]) return;
          nodes[a].links.push(d);
          nodes[d].links.push(a);
        };
        for (let ry = 0; ry < rows; ry++) {
          for (let cx = 0; cx < cols; cx++) {
            if (cx + 1 < cols && Math.random() < 0.62) link(at(cx, ry), at(cx + 1, ry));
            if (ry + 1 < rows && Math.random() < 0.62) link(at(cx, ry), at(cx, ry + 1));
          }
        }

        const ctx = board.ctx;
        ctx.clearRect(0, 0, board.w, board.h);
        ctx.lineCap = 'square';
        ctx.strokeStyle = 'rgba(46,132,110,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < nodes.length; i++) {
          for (const j of nodes[i].links) {
            if (j < i) continue;              // draw each trace once
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
          }
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(196,142,74,0.55)';
        for (const n of nodes) {
          if (!n.pad || !n.links.length) continue;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      buildBoard();
      window.addEventListener('resize', buildBoard);
      this._resize = buildBoard;

      const nearest = (x, y) => {
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < nodes.length; i++) {
          if (!nodes[i].links.length) continue;
          const d = (nodes[i].x - x) * (nodes[i].x - x) + (nodes[i].y - y) * (nodes[i].y - y);
          if (d < bd) { bd = d; best = i; }
        }
        return best;
      };

      // Current takes a route, not a straight line: a random walk along the
      // traces that will not immediately double back on itself.
      const route = (from, hops) => {
        const path = [from];
        let prev = -1;
        let cur = from;
        for (let i = 0; i < hops; i++) {
          const links = nodes[cur].links.filter((n) => n !== prev);
          if (!links.length) break;
          const next = links[(Math.random() * links.length) | 0];
          prev = cur;
          cur = next;
          path.push(cur);
        }
        return path;
      };

      const fire = () => {
        const p = caretRect();
        const x = p ? p.x : rand(0, live.w);
        const y = p ? p.y : rand(0, live.h);
        const start = nearest(x, y);
        if (start < 0) return;
        const branches = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < branches; i++) {
          const path = route(start, 7 + (Math.random() * 7 | 0));
          if (path.length < 2) continue;
          pulses.push({ path, head: 0, speed: rand(300, 520), life: 1 });
        }
        if (pulses.length > 26) pulses.splice(0, pulses.length - 26);
      };

      let lastKey = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const now = performance.now();
        if (now - lastKey < 40) return;
        lastKey = now;
        fire();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // Length along a pulse's path, so the head can be placed in pixels
      // rather than in hops (a long trace and a short one glow the same).
      const segLen = (p, i) => Math.hypot(
        nodes[p.path[i + 1]].x - nodes[p.path[i]].x,
        nodes[p.path[i + 1]].y - nodes[p.path[i]].y);

      const drawPulse = (p) => {
        const ctx = live.ctx;
        const TAIL = 86;
        let travelled = 0;
        for (let i = 0; i < p.path.length - 1; i++) {
          const len = segLen(p, i);
          const a0 = nodes[p.path[i]];
          const a1 = nodes[p.path[i + 1]];
          const segStart = travelled;
          travelled += len;
          if (segStart > p.head || travelled < p.head - TAIL) continue;
          // The lit part of this segment, clipped to the pulse's tail.
          const from = Math.max(0, (p.head - TAIL - segStart) / len);
          const to = Math.min(1, (p.head - segStart) / len);
          if (to <= from) continue;
          const g = ctx.createLinearGradient(
            a0.x + (a1.x - a0.x) * from, a0.y + (a1.y - a0.y) * from,
            a0.x + (a1.x - a0.x) * to, a0.y + (a1.y - a0.y) * to);
          g.addColorStop(0, 'rgba(80,255,190,0)');
          g.addColorStop(1, 'rgba(150,255,215,' + (0.9 * p.life).toFixed(3) + ')');
          ctx.strokeStyle = g;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(a0.x + (a1.x - a0.x) * from, a0.y + (a1.y - a0.y) * from);
          ctx.lineTo(a0.x + (a1.x - a0.x) * to, a0.y + (a1.y - a0.y) * to);
          ctx.stroke();
          if (to === 1 && nodes[p.path[i + 1]].pad) {
            ctx.fillStyle = 'rgba(190,255,225,' + (0.5 * p.life).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(a1.x, a1.y, 3.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        return travelled;
      };

      let last = performance.now();
      let painted = false;
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        if (pulses.length || painted) {
          live.ctx.clearRect(0, 0, live.w, live.h);
          painted = pulses.length > 0;
          live.ctx.lineCap = 'round';
          for (const p of pulses) {
            const total = drawPulse(p);
            p.total = total;
          }
        }
        for (const p of pulses) {
          p.head += p.speed * dt;
          if (p.total && p.head > p.total + 86) p.life -= dt * 2.2;
        }
        pulses = pulses.filter((p) => p.life > 0);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Aurora — ribbons of light behind the window that read your *rhythm*, not
  // your keystrokes. Sustained typing brightens and quickens them; a pause
  // lets them sink and cool. The quietest theme in the set, and the cheapest:
  // a handful of gradients into a third-scale buffer at ~24fps.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.aurora = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-aurora-canvas', 0.34);
      const ctx = c.ctx;
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const RIBBONS = [
        { hue: 152, y: 0.30, amp: 0.10, len: 1.5, speed: 0.055, a: 0.30 },
        { hue: 178, y: 0.42, amp: 0.14, len: 1.1, speed: -0.038, a: 0.24 },
        { hue: 268, y: 0.55, amp: 0.09, len: 1.9, speed: 0.028, a: 0.20 },
        { hue: 205, y: 0.66, amp: 0.16, len: 0.8, speed: -0.020, a: 0.16 }
      ];

      let energy = 0;          // 0..1, how hard you are working
      let phase = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        energy = Math.min(1, energy + 0.06);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let nextDraw = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        energy = Math.max(0, energy - dt * 0.16);
        phase += dt * (0.25 + energy * 0.75);

        if (now < nextDraw) { rafId = requestAnimationFrame(tick); return; }
        nextDraw = now + 42;

        ctx.clearRect(0, 0, c.w, c.h);
        for (const r of RIBBONS) {
          // Each ribbon is a band of vertical columns; the band's centre is a
          // slow sine of x, so it hangs and waves rather than scrolling past.
          const cols = 46;
          const step = c.w / cols;
          const lift = energy * c.h * 0.06;
          for (let i = 0; i <= cols; i++) {
            const x = i * step;
            const t = i / cols;
            const y = c.h * r.y - lift +
              Math.sin(t * Math.PI * 2 * r.len + phase * r.speed * 26) * c.h * r.amp +
              Math.sin(t * Math.PI * 5.3 + phase * r.speed * 11) * c.h * r.amp * 0.3;
            const height = c.h * (0.16 + r.amp) * (0.7 + Math.sin(t * 6.1 + phase) * 0.3);
            const alpha = (r.a * (0.6 + energy * 0.6)) * (0.5 + Math.sin(t * 3.7 + phase * 1.7) * 0.5);
            if (alpha <= 0.004) continue;
            const g = ctx.createLinearGradient(0, y - height, 0, y + height * 0.55);
            g.addColorStop(0, 'hsla(' + r.hue + ',85%,62%,0)');
            g.addColorStop(0.45, 'hsla(' + r.hue + ',88%,64%,' + alpha.toFixed(3) + ')');
            g.addColorStop(1, 'hsla(' + (r.hue + 30) + ',90%,55%,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - 1, y - height, step + 2, height * 1.55);
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Starfall — a night sky behind the window: a field of quietly twinkling
  // stars, crossed every few seconds by a comet with a tapering tail. Purely
  // ambient — nothing here reads the keyboard — the same way a real sky
  // doesn't care whether you're typing.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.starfall = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-starfall-canvas');
      const ctx = c.ctx;

      const rand = (a, d) => a + Math.random() * (d - a);

      let stars = [];
      const buildStars = () => {
        // Density off the panel area, not a fixed count — a maximised window
        // gets a full sky instead of the same handful of stars stretched
        // thin over it.
        const n = Math.round((c.w * c.h) / 2600);
        stars = Array.from({ length: n }, () => ({
          x: Math.random() * c.w, y: Math.random() * c.h,
          r: rand(0.4, 1.6), phase: rand(0, Math.PI * 2), speed: rand(0.6, 1.8)
        }));
      };
      const resize = () => { c.resize(); buildStars(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let comets = [];
      let nextCometAt = 0;
      const scheduleComet = (now) => { nextCometAt = now + rand(2600, 6200); };

      // Mostly-downward, tilted left or right — a real meteor's path, not a
      // ball bouncing off the edges — starting just off the top of the
      // window so it's already moving when it comes into view.
      const spawnComet = () => {
        if (!c.w || !c.h) return;
        const dir = Math.random() < 0.5 ? 1 : -1;
        const ang = Math.PI / 2 + dir * rand(0.35, 0.55);
        const speed = rand(700, 1150);
        comets.push({
          x: dir > 0 ? rand(-0.05, 0.5) * c.w : rand(0.5, 1.05) * c.w,
          y: rand(-0.05, 0.22) * c.h,
          vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          tail: rand(60, 110), life: 1
        });
        if (comets.length > 4) comets.shift();
      };

      let nextDraw = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        if (now >= nextCometAt) { spawnComet(); scheduleComet(now); }

        for (const cm of comets) {
          cm.x += cm.vx * dt;
          cm.y += cm.vy * dt;
          cm.life -= dt * 0.85;
        }
        comets = comets.filter((cm) => cm.life > 0 &&
          cm.x > -cm.tail - 20 && cm.x < c.w + cm.tail + 20 && cm.y < c.h + cm.tail + 20);

        // The stars only need to twinkle, not animate smoothly — 20fps for
        // the whole sky is imperceptible and a quarter of the paint cost.
        if (now < nextDraw) { rafId = requestAnimationFrame(tick); return; }
        nextDraw = now + 50;

        ctx.clearRect(0, 0, c.w, c.h);
        const t = now / 1000;
        for (const s of stars) {
          const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
          ctx.fillStyle = 'rgba(226,232,245,' + a.toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }

        for (const cm of comets) {
          const a = Math.min(1, cm.life * 2.4);
          if (a <= 0.01) continue;
          const len = Math.hypot(cm.vx, cm.vy) || 1;
          const tx = cm.x - (cm.vx / len) * cm.tail;
          const ty = cm.y - (cm.vy / len) * cm.tail;
          const g = ctx.createLinearGradient(cm.x, cm.y, tx, ty);
          g.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')');
          g.addColorStop(0.4, 'rgba(200,215,255,' + (a * 0.5).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(180,200,255,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cm.x, cm.y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(cm.x, cm.y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }

        rafId = requestAnimationFrame(tick);
      };
      scheduleComet(performance.now());
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Zen — raked sand behind the window. Typing drags through it: each key
  // presses a hollow into the rake lines around the caret, and the wind takes
  // the hollows back out over the following minute. Write a lot and the
  // garden is churned; sit still and it settles itself.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.zen = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-zen-canvas', 0.6);
      const ctx = c.ctx;

      const GAP = 18;          // spacing of the rake lines
      const SAMPLE = 9;        // px between sampled points along a line
      let dents = [];          // { x, y, r, s }
      let dirty = true;

      const resize = () => { c.resize(); dirty = true; };
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const p = caretRect();
        const x = p ? p.x : c.w * (0.2 + Math.random() * 0.6);
        const y = p ? p.y : c.h * (0.2 + Math.random() * 0.6);
        // One press deepens the hollow already there instead of stacking a
        // second one on top of it — the rake passes over the same spot.
        const near = dents.find((d) => Math.hypot(d.x - x, d.y - y) < 26);
        if (near) { near.s = Math.min(1.6, near.s + 0.35); near.r = Math.min(120, near.r + 6); }
        else dents.push({ x, y, r: 46 + Math.random() * 30, s: 0.75 + Math.random() * 0.4 });
        if (dents.length > 40) dents.shift();
        dirty = true;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const draw = () => {
        ctx.clearRect(0, 0, c.w, c.h);
        ctx.lineWidth = 1.1;
        for (let baseY = GAP; baseY < c.h + GAP; baseY += GAP) {
          // Two strokes per furrow: the shadow in the groove and the lit sand
          // ridge just above it. Without the pair it is a striped background.
          for (const pass of [0, 1]) {
            ctx.strokeStyle = pass
              ? 'rgba(255,253,246,0.95)'
              : 'rgba(104,88,64,0.58)';
            ctx.beginPath();
            for (let x = 0; x <= c.w + SAMPLE; x += SAMPLE) {
              let y = baseY + Math.sin(x / 190 + baseY / 90) * 2.2;
              for (const d of dents) {
                const dx = x - d.x;
                const dy = baseY - d.y;
                const dist = Math.hypot(dx, dy);
                if (dist > d.r) continue;
                // A cosine bump: deepest at the centre, flat where it ends, so
                // the furrow bends around the hollow instead of stepping.
                const k = (1 + Math.cos((dist / d.r) * Math.PI)) / 2;
                y += Math.sign(dy || 1) * k * d.s * 11;
              }
              if (pass) y -= 1.4;
              if (x === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
        dirty = false;
      };

      let nextDraw = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        let settling = false;
        for (const d of dents) {
          d.s -= dt * 0.02;                 // the wind, doing its slow work
          d.r += dt * 1.5;
          if (d.s > 0) settling = true;
        }
        const before = dents.length;
        dents = dents.filter((d) => d.s > 0.02);
        if (dents.length !== before) dirty = true;

        // Sand does not animate on its own: redraw only while something is
        // still settling, and at 20fps even then.
        if ((dirty || settling) && now >= nextDraw) { draw(); nextDraw = now + 50; }
        rafId = requestAnimationFrame(tick);
      };
      draw();
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Blackout — the app is running on a candle. The light gutters constantly
  // and sinks while you sit still; typing feeds it back up. What you are
  // writing is always lit: a pool of light rides the caret, and the darkness
  // has a floor, so the note stays readable however long you leave it.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.blackout = {
    start() {
      const l = layer();
      if (!l) return;
      // Full resolution: everything else here is a soft gradient that could
      // be drawn small and stretched, but the flame is a shape with an edge.
      const c = makeCanvas(l, 'fx-blackout-canvas');
      const ctx = c.ctx;
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const FLOOR = 0.30;      // how much light the room is given, always
      // Deliberately not a variable: an earlier version had the candle flare
      // up on every keystroke and sink while you paused, and the flicker of
      // the room brightening under your hands was the opposite of what this
      // theme is for. The light is steady; only the flame moves.
      const power = 0;
      let flick = 0;
      let at = null;           // where the light is now
      let goal = null;         // where the caret is

      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        goal = caretRect() || goal;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let nextDraw = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        flick += dt * 9;

        // The flame chases the caret rather than teleporting to it, but it
        // is a quick chase — light that lags behind your typing reads as lag.
        goal = caretRect() || goal;
        if (goal) {
          if (!at) at = { x: goal.x, y: goal.y, h: goal.bottom - goal.top };
          const k = Math.min(1, dt * 30);   // stays welded to the caret
          at.x += (goal.x - at.x) * k;
          at.y += (goal.y - at.y) * k;
          at.h = goal.bottom - goal.top || at.h;
        }

        if (now < nextDraw) { rafId = requestAnimationFrame(tick); return; }
        nextDraw = now + 22;

        // A flame never holds still, and the wobble is what sells it as a
        // flame rather than as a brightness slider.
        const wob = 1 + Math.sin(flick) * 0.05 + Math.sin(flick * 2.3) * 0.035 +
          (Math.random() - 0.5) * 0.03;
        const lit = (FLOOR + power * (1 - FLOOR)) * wob;
        const dark = Math.max(0, Math.min(0.82, (1 - lit) * 0.92));

        ctx.clearRect(0, 0, c.w, c.h);
        if (dark > 0.01) {
          ctx.fillStyle = 'rgba(3,2,1,' + dark.toFixed(3) + ')';
          ctx.fillRect(0, 0, c.w, c.h);
        }
        // Burn the pool of light back out of the dark, so what is under the
        // caret keeps its full contrast no matter how low the candle is.
        const p = at;
        if (p) {
          const lineH = Math.min(40, Math.max(12, p.h || 18));
          // The flame stands on the line you are writing, a hair above the
          // letters, and is not quite as tall as one line — a match held to
          // the page, not a lamp over it.
          const h = lineH * (0.8 + power * 0.16) * (1 + Math.sin(flick * 1.9) * 0.05 +
            Math.sin(flick * 4.7) * 0.035 + (Math.random() - 0.5) * 0.035);
          const wd = h * 0.4;
          const baseY = Math.max(h + 6, p.y - lineH * 0.58);
          // A draught: the tip leans, and the whole flame leans a little after
          // it. Two sines of different periods so it never repeats visibly.
          const lean = (Math.sin(flick * 1.3) + Math.sin(flick * 2.9) * 0.5) * wd * 0.34;

          // The silhouette, sampled rather than drawn with fixed curves: width
          // is a sine of height (widest about a third of the way up, closing to
          // a point at the tip), the centre line leans further the higher it
          // goes, and two out-of-phase sines ripple the edge so the shape is
          // never the same twice.
          const flamePath = (fh, fw, tipLean, phase) => {
            const N = 20;
            ctx.beginPath();
            // up the left edge, back down the right
            for (let i = 0; i <= N; i++) {
              const t = i / N;
              const half = fw * Math.sin(Math.pow(t, 0.6) * Math.PI) * (1 - t * 0.1);
              const ripple = (Math.sin(t * 6.1 + phase * 3.1) * 0.05 +
                Math.sin(t * 11.3 - phase * 2.2) * 0.03) * fw;
              const x = p.x + tipLean * Math.pow(t, 1.8) + ripple;
              const y = baseY - fh * t;
              if (i === 0) ctx.moveTo(x - half, y);
              else ctx.lineTo(x - half, y);
            }
            for (let i = N; i >= 0; i--) {
              const t = i / N;
              const half = fw * Math.sin(Math.pow(t, 0.6) * Math.PI) * (1 - t * 0.1);
              const ripple = (Math.sin(t * 6.1 + phase * 3.1) * 0.05 +
                Math.sin(t * 11.3 - phase * 2.2) * 0.03) * fw;
              const x = p.x + tipLean * Math.pow(t, 1.8) + ripple;
              const y = baseY - fh * t;
              ctx.lineTo(x + half, y);
            }
            ctx.closePath();
          };

          // The light it throws: cut the dark away around the flame, brightest
          // right under it, so the words beside it can be read.
          ctx.globalCompositeOperation = 'destination-out';
          const hole = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, h * 5.2);
          hole.addColorStop(0, 'rgba(0,0,0,1)');
          hole.addColorStop(0.42, 'rgba(0,0,0,0.85)');
          hole.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = hole;
          ctx.beginPath();
          ctx.arc(p.x, p.y, h * 5.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';

          // Its halo, warm and weak, sitting over the light it just let through.
          const glow = ctx.createRadialGradient(p.x, baseY - h * 0.5, 0, p.x, baseY - h * 0.5, h * 4);
          glow.addColorStop(0, 'rgba(255,176,70,0.22)');
          glow.addColorStop(0.45, 'rgba(255,150,50,0.08)');
          glow.addColorStop(1, 'rgba(255,140,40,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, baseY - h * 0.5, h * 4, 0, Math.PI * 2);
          ctx.fill();

          // Four layers, soft outside to hard inside — the way a flame reads
          // in a photograph. The blur is what does most of the work: a flame
          // has no edge, and a crisp outline is what made the old one look
          // like a sticker.
          const blur = (px) => { ctx.filter = px ? 'blur(' + px.toFixed(2) + 'px)' : 'none'; };

          // 1. The envelope of hot air: barely there, wider and taller.
          blur(h * 0.16);
          ctx.fillStyle = 'rgba(255,108,18,0.26)';
          flamePath(h * 1.12, wd * 1.22, lean * 1.1, flick);
          ctx.fill();

          // 2. The body.
          blur(h * 0.07);
          const body = ctx.createLinearGradient(p.x, baseY + h * 0.1, p.x, baseY - h);
          body.addColorStop(0, 'rgba(255,96,10,0.85)');
          body.addColorStop(0.3, 'rgba(255,150,32,0.95)');
          body.addColorStop(0.72, 'rgba(255,205,92,0.92)');
          body.addColorStop(1, 'rgba(255,238,178,0.35)');
          ctx.fillStyle = body;
          flamePath(h, wd, lean, flick + 1.3);
          ctx.fill();

          // 3. The core — small, low, and nearly white.
          blur(h * 0.045);
          const core = ctx.createLinearGradient(p.x, baseY, p.x, baseY - h * 0.62);
          core.addColorStop(0, 'rgba(255,226,164,0.9)');
          core.addColorStop(0.6, 'rgba(255,248,220,0.96)');
          core.addColorStop(1, 'rgba(255,255,246,0.35)');
          ctx.fillStyle = core;
          flamePath(h * 0.62, wd * 0.5, lean * 0.45, flick + 2.7);
          ctx.fill();

          // 4. The blue at the wick, where the flame is coldest and cleanest.
          blur(h * 0.06);
          ctx.fillStyle = 'rgba(96,150,255,0.34)';
          ctx.beginPath();
          ctx.ellipse(p.x, baseY - h * 0.02, wd * 0.46, h * 0.15, 0, 0, Math.PI * 2);
          ctx.fill();
          blur(0);
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Synesthesia — the accent colour itself is driven by what you type. Each
  // character maps to a hue; the app eases toward it and settles back to a
  // resting blue between keystrokes, so typing reads as painting.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.keys = {
    start() {
      const root = document.documentElement.style;
      let hue = 230;
      let targetHue = 230;
      let level = 0;

      const onKey = (e) => {
        if (e.key && e.key.length === 1) {
          targetHue = (e.key.toLowerCase().charCodeAt(0) * 13) % 360;
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          targetHue = (targetHue + 180) % 360;   // a complementary flash on delete
        } else {
          return;
        }
        level = 1;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const tick = () => {
        hue += (targetHue - hue) * 0.14;
        level *= 0.90;
        root.setProperty('--fx-key-level', level.toFixed(3));
        root.setProperty('--accent', 'hsl(' + hue.toFixed(1) + ' 85% 62%)');
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._onKey = null;
      document.documentElement.style.removeProperty('--fx-key-level');
      // --accent is deliberately NOT removed here. applyTheme() writes the
      // incoming theme's palette and only then swaps the runtime, so this
      // stop() runs *after* the new accent is already in place — removing it
      // wipes the colour of the theme being switched to, not this one's.
      // Every path into here comes from applyTheme, so there is nothing to
      // clean up: the next theme's own accent has already overwritten ours.
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Music — the window breathes with whatever Windows is playing. Electron can
  // hand us a loopback capture of the system mixer, so this follows Spotify,
  // a browser tab, anything, with no integration per app.
  //
  // Bass drives the pulse, overall brightness drives the hue, so a track's
  // character shows up as colour rather than just as motion.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.music = {
    start() {
      const root = document.documentElement.style;
      this._mine = generation;
      this._stream = null;
      this._ctx = null;
      this._level = 0;

      // A loopback capture is bound to the output device that existed when it
      // was opened. Plug in headphones and Windows moves the render endpoint,
      // leaving the old capture alive but permanently silent — so the theme
      // just stops responding. Re-acquire whenever the device list changes,
      // and keep a silence watchdog for the cases that don't fire an event.
      this._onDeviceChange = () => this.reacquire('device change');
      try { navigator.mediaDevices.addEventListener('devicechange', this._onDeviceChange); } catch {}

      this.idlePulse(root);   // something to look at while capture is opening
      this.acquire(root);
    },

    // A slow breath, used before the first capture and whenever audio is
    // unavailable — a dead-still window reads as a broken theme.
    idlePulse(root) {
      stopRaf();
      let t = 0;
      const idle = () => {
        t += 0.012;
        root.setProperty('--fx-music-level', ((Math.sin(t) * 0.5 + 0.5) * 0.3).toFixed(3));
        rafId = requestAnimationFrame(idle);
      };
      rafId = requestAnimationFrame(idle);
    },

    async acquire(root) {
      const mine = this._mine;
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // Only the audio is wanted; holding the video track open costs a
        // continuous screen capture for nothing.
        stream.getVideoTracks().forEach((t) => t.stop());
        // Switched theme while the capture was resolving.
        if (mine !== generation) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (!stream.getAudioTracks().length) throw new Error('no system audio track');

        // Tear down any previous capture only once the new one is in hand, so
        // a failed re-acquire doesn't leave the theme with nothing.
        try { if (this._stream) this._stream.getTracks().forEach((t) => t.stop()); } catch {}
        try { if (this._ctx) this._ctx.close(); } catch {}

        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const src = actx.createMediaStreamSource(stream);
        const an = actx.createAnalyser();
        an.fftSize = 512;
        // The AnalyserNode itself smooths every reading internally before we
        // ever see it (an exponential average, independent of anything in this
        // file) — 0.75 was high enough that the beat felt like it was arriving
        // late, because it genuinely was: that's the browser lagging the data,
        // not our own easing. Low smoothing here + our own snap-fast/decay-slow
        // easing below is what actually tracks a transient.
        an.smoothingTimeConstant = 0.25;
        src.connect(an);
        this._stream = stream;
        this._ctx = actx;

        // Windows can also end the track outright on an output switch.
        stream.getAudioTracks().forEach((t) => {
          t.addEventListener('ended', () => this.reacquire('track ended'));
        });

        const bins = new Uint8Array(an.frequencyBinCount);
        let level = this._level;
        let floor = 0.25;      // rolling noise floor
        let ceil = 0.45;       // rolling loudest-so-far
        let hFloor = 0.15, hCeil = 0.35;   // same auto-range, for the treble band
        let silentSince = 0;
        let hue = 230;         // eases toward whichever band is loudest right now

        stopRaf();
        const tick = (now) => {
          an.getByteFrequencyData(bins);
          const n = bins.length;
          // Just two bands, on purpose — bass for the pulse, treble for the
          // colour. A third mid band mostly tracks vocals/melody, which sit at
          // a fairly constant level through a whole song, so it blurred the
          // colour toward one average hue instead of visibly tracking the mix.
          let bass = 0, high = 0, total = 0;
          for (let i = 0; i < n; i++) {
            total += bins[i];
            if (i < n * 0.10) bass += bins[i];
            else if (i > n * 0.55) high += bins[i];
          }
          bass /= (n * 0.10);
          high /= (n * 0.45);
          const raw = bass / 255;
          const rawHigh = high / 255;

          // Raw magnitude alone almost never picks treble: bass frequencies
          // simply carry more energy in most recorded audio, so "whichever
          // number is bigger" stayed on blue for an entire song regardless of
          // what was actually playing. What matters is whether the treble is
          // busier than IT usually is, so it gets the same floor/ceil
          // auto-range as the level meter, and the two normalized bands are
          // compared on equal footing instead of raw magnitude.
          if (rawHigh < hFloor) hFloor += (rawHigh - hFloor) * 0.30; else hFloor += 0.00035;
          if (rawHigh > hCeil) hCeil += (rawHigh - hCeil) * 0.35; else hCeil -= 0.00055;
          if (hCeil < hFloor + 0.03) hCeil = hFloor + 0.03;
          const highNorm = Math.max(0, Math.min(1, (rawHigh - hFloor) / (hCeil - hFloor)));
          const bassNorm = Math.max(0, Math.min(1, (raw - floor) / (Math.max(ceil, floor + 0.045) - floor)));

          // Cool blue when bass is carrying it, warm amber when the treble
          // does — a clean two-way split reads as "synced" far more clearly
          // than a blend that's always some intermediate shade.
          const targetHue = highNorm > bassNorm ? 28 : 210;
          let dHue = targetHue - hue;
          if (dHue > 180) dHue -= 360; else if (dHue < -180) dHue += 360;
          hue += dHue * 0.15;
          if (hue < 0) hue += 360; else if (hue >= 360) hue -= 360;
          root.setProperty('--accent', 'hsl(' + hue.toFixed(1) + ' 82% 66%)');

          // Watchdog: a capture on a dead endpoint reads as exact digital
          // silence forever, which is distinguishable from quiet music.
          if (total === 0) {
            if (!silentSince) silentSince = now;
            else if (now - silentSince > 4000) {
              silentSince = 0;
              this.reacquire('silent stream');
              return;
            }
          } else {
            silentSince = 0;
          }

          // Music sits in a narrow loudness band, so a fixed scale reads as an
          // almost-constant glow. Track the running quiet/loud range instead
          // and stretch it to 0–1, which is what turns a steady hum into a
          // visible on/off pulse on the beat. Both bounds drift back toward
          // each other so a quiet passage re-sensitises rather than going dead.
          if (raw < floor) floor += (raw - floor) * 0.30;
          else floor += 0.00035;
          if (raw > ceil) ceil += (raw - ceil) * 0.35;
          else ceil -= 0.00055;
          if (ceil < floor + 0.045) ceil = floor + 0.045;

          let target = (raw - floor) / (ceil - floor);
          target = Math.max(0, Math.min(1, target));
          // Gamma < 1 lifts the mid-range so beats punch instead of hovering.
          target = Math.pow(target, 0.65);

          // Snap up on the transient, fall away slowly — that asymmetry is
          // what makes it read as a beat rather than a wobble.
          level += (target - level) * (target > level ? 0.80 : 0.10);
          this._level = level;

          root.setProperty('--fx-music-level', level.toFixed(3));
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        console.error('Music theme: could not read system audio', err);
        if (mine !== generation) return;
        this.idlePulse(root);
      }
    },

    reacquire(why) {
      if (this._mine !== generation) return;   // theme already changed
      if (this._reacquiring) return;
      this._reacquiring = true;
      console.info('Music theme: re-opening system audio (' + why + ')');
      const root = document.documentElement.style;
      // The device list settles a moment after the event fires.
      setTimeout(() => {
        this._reacquiring = false;
        if (this._mine === generation) this.acquire(root);
      }, 400);
    },

    stop() {
      stopRaf();
      try {
        if (this._onDeviceChange) {
          navigator.mediaDevices.removeEventListener('devicechange', this._onDeviceChange);
        }
      } catch {}
      this._onDeviceChange = null;
      this._reacquiring = false;
      try { if (this._stream) this._stream.getTracks().forEach((t) => t.stop()); } catch {}
      try { if (this._ctx) this._ctx.close(); } catch {}
      this._stream = null;
      this._ctx = null;
      document.documentElement.style.removeProperty('--fx-music-level');
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Heartbeat — a cardiac monitor wired to your typing. The ECG trace sweeps
  // behind the UI at a rate set by how fast you're writing: rest is ~58bpm,
  // a burst of typing drives it toward ~150, and stopping lets it wind back
  // down the way a pulse actually recovers — quickly at first, then slowly.
  // Every QRS spike also pulses the window chrome via --fx-pulse-level.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.pulse = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-pulse-canvas');
      const ctx = c.ctx;
      const root = document.documentElement.style;

      const resize = () => { c.resize(); ctx.clearRect(0, 0, c.w, c.h); headX = 0; lastY = null; };
      window.addEventListener('resize', resize);
      this._resize = resize;

      // Typing cadence, as keystrokes in a sliding window. The BPM target is
      // read off this rather than off inter-key gaps directly — gaps are
      // noisy (a Shift, a reach for a symbol), the running count is not.
      let taps = [];
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        taps.push(performance.now());
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // One heartbeat as a function of phase 0–1: flat, P bump, the QRS
      // spike, T bump, flat again. Piecewise cosines — smooth where the
      // real waveform is smooth, and a hard triangle where it isn't.
      const wave = (p) => {
        const bump = (at, w2, a) => {
          const d = (p - at) / w2;
          return Math.abs(d) < 1 ? a * (1 + Math.cos(d * Math.PI)) / 2 : 0;
        };
        let v = bump(0.16, 0.05, 0.12);          // P
        v += bump(0.46, 0.055, 0.24);            // T
        // QRS: sharp down, tall up, sharp down — drawn as triangles.
        const tri = (at, w2, a) => {
          const d = Math.abs(p - at) / w2;
          return d < 1 ? a * (1 - d) : 0;
        };
        v += tri(0.285, 0.012, -0.16);           // Q
        v += tri(0.305, 0.02, 1.0);              // R
        v += tri(0.33, 0.016, -0.3);             // S
        return v;
      };

      let bpm = 58;
      let phase = 0;
      let headX = 0;
      let level = 0;
      let lastY = null;
      const SWEEP = 170;       // px/s, the paper speed — constant, like a real monitor
      const GAP = 44;          // erase bar ahead of the pen

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // Keys in the last 3s → target BPM. Recovery is slower than the
        // climb, which is what makes it feel like a pulse and not a meter.
        while (taps.length && now - taps[0] > 3000) taps.shift();
        const targetBpm = 58 + Math.min(1, taps.length / 14) * 92;
        bpm += (targetBpm - bpm) * (targetBpm > bpm ? dt * 2.2 : dt * 0.35);

        const prevPhase = phase;
        phase += (bpm / 60) * dt;
        if (phase >= 1) { phase -= 1; level = 1; }
        // The chrome pulse rides the R spike itself, not just the wrap.
        if (prevPhase < 0.305 && phase >= 0.305) level = 1;
        level *= Math.pow(0.08, dt);   // fast decay, framerate-independent
        root.setProperty('--fx-pulse-level', level.toFixed(3));

        const baseY = c.h * 0.72;
        const amp = Math.min(120, c.h * 0.13);

        // The pen: advance the head, clear the strip just ahead of it, draw
        // the segment behind it. The old trace stays until overwritten —
        // that persistence is most of what reads as "monitor".
        const step = SWEEP * dt;
        const nx = headX + step;
        ctx.clearRect(nx, 0, GAP, c.h);
        if (nx > c.w) {
          headX = 0; lastY = null;
          ctx.clearRect(0, 0, GAP, c.h);
        } else {
          const y = baseY - wave(phase) * amp;
          if (lastY == null) lastY = y;
          ctx.strokeStyle = 'rgba(255,92,114,0.9)';
          ctx.lineWidth = 1.6;
          ctx.lineCap = 'round';
          ctx.shadowColor = 'rgba(255,60,90,0.75)';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(headX, lastY);
          ctx.lineTo(nx, y);
          ctx.stroke();
          ctx.shadowBlur = 0;
          headX = nx;
          lastY = y;
        }

        // The readout, redrawn in place each frame. It sits just *under* the
        // baseline rather than up in the corner: the corner is where the note's
        // own first line is, and a number sitting on the user's text is the one
        // thing a background effect must never do. Below the baseline is the
        // only band the trace never reaches — the deepest dip is the S wave at
        // 0.3 of the amplitude, so 0.42 clears it at any window size.
        const readY = baseY + amp * 0.42 + 22;
        ctx.clearRect(c.w - 150, readY - 20, 150, 28);
        ctx.font = '600 20px Consolas, monospace';
        ctx.textAlign = 'right';
        // Monitor-green would lie here: the whole room is red, so the number is.
        ctx.fillStyle = 'rgba(255,92,114,' + (0.32 + level * 0.45).toFixed(3) + ')';
        ctx.fillText(Math.round(bpm) + ' bpm', c.w - 18, readY);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
      document.documentElement.style.removeProperty('--fx-pulse-level');
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Deep — the window is underwater, and how deep you are is how much you
  // have written. An empty note floats at the surface with caustics playing
  // over the panels; a long one is most of a kilometre down, where the only
  // light left is the stuff that makes its own. Nothing here reads the
  // keyboard: the descent is the document, not the typing.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.deep = {
    start() {
      const b = back();
      if (!b) return;
      // The water column is a gradient and some blurred light, so it is drawn
      // into a quarter-scale buffer and stretched by the CSS. The motes are
      // 1px points and have to stay at full resolution.
      const col = makeCanvas(b, 'fx-deep-water', 0.25);
      const par = makeCanvas(b, 'fx-deep-motes');
      const cctx = col.ctx;
      const pctx = par.ctx;
      const root = document.documentElement.style;

      const rand = (a, d) => a + Math.random() * (d - a);
      // A long note, not an essay. The bottom has to be reachable in an
      // ordinary session, or the whole second half of the theme is something
      // nobody ever sees.
      const FLOOR = 2400;

      let motes = [];
      const buildMotes = () => {
        const n = Math.round((par.w * par.h) / 5000);
        motes = Array.from({ length: n }, () => ({
          x: Math.random() * par.w, y: Math.random() * par.h,
          r: rand(0.5, 1.9), v: rand(5, 24), drift: rand(-7, 7),
          // Whether a mote is debris or a light is fixed for its life: a
          // speck that lights up halfway through its drift reads as a bug.
          lit: Math.random() < 0.3, ph: rand(0, Math.PI * 2)
        }));
      };
      const resize = () => { col.resize(); par.resize(); buildMotes(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let depth = 0;
      let target = 0;
      // Reading the editor's text touches layout, so it happens twice a
      // second rather than per frame — the value is eased over seconds anyway.
      const readDepth = () => {
        const ed = document.querySelector('.editor-area');
        const n = ed ? (ed.textContent || '').length : 0;
        target = Math.min(1, n / FLOOR);
      };
      readDepth();
      depth = target;

      const mix = (a, d, k) => Math.round(a + (d - a) * k);
      let nextRead = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        if (now >= nextRead) { readDepth(); nextRead = now + 500; }
        // Slow on purpose: pasting a paragraph should sink you, not drop you.
        depth += (target - depth) * Math.min(1, dt * 0.55);
        const d = depth;
        root.setProperty('--fx-deep-depth', d.toFixed(3));

        // The column. The abyss is not black but very nearly, with the last
        // of the blue still in it.
        const g = cctx.createLinearGradient(0, 0, 0, col.h);
        g.addColorStop(0, 'rgb(' + mix(96, 5, d) + ',' + mix(178, 16, d) + ',' + mix(198, 30, d) + ')');
        g.addColorStop(1, 'rgb(' + mix(20, 1, d) + ',' + mix(74, 3, d) + ',' + mix(104, 7, d) + ')');
        cctx.fillStyle = g;
        cctx.fillRect(0, 0, col.w, col.h);

        // Caustics, near the surface only, because that is the only place
        // they exist. The light going is what sells the descent — more than
        // the colour going, which on its own just reads as a dimmer switch.
        const caust = Math.max(0, 1 - d * 2.6);
        if (caust > 0.01) {
          const t = now / 1000;
          cctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 9; i++) {
            const x = ((i / 9) + Math.sin(t * 0.25 + i) * 0.06) * col.w;
            const y = (0.02 + (i % 3) * 0.07) * col.h + Math.sin(t * 0.4 + i * 2) * col.h * 0.02;
            const rw = col.w * (0.10 + (i % 4) * 0.03);
            const rh = col.h * 0.07;
            const rg = cctx.createRadialGradient(0, 0, 0, 0, 0, rw);
            rg.addColorStop(0, 'rgba(198,244,255,' + (0.22 * caust).toFixed(3) + ')');
            rg.addColorStop(1, 'rgba(198,244,255,0)');
            cctx.save();
            cctx.translate(x, y);
            cctx.scale(1, rh / rw);
            cctx.fillStyle = rg;
            cctx.beginPath();
            cctx.arc(0, 0, rw, 0, Math.PI * 2);
            cctx.fill();
            cctx.restore();
          }
          cctx.globalCompositeOperation = 'source-over';
        }

        // The motes rise past you, because you are the thing going down.
        pctx.clearRect(0, 0, par.w, par.h);
        const t2 = now / 1000;
        for (const m of motes) {
          m.y -= m.v * dt;
          m.x += Math.sin(t2 * 0.5 + m.ph) * m.drift * dt;
          if (m.y < -4) { m.y = par.h + 4; m.x = Math.random() * par.w; }
          if (m.lit) {
            // Bioluminescence arrives as the caustics leave, rather than
            // being on the whole way down — it is the deep's only light.
            const a = Math.max(0, d - 0.42) / 0.58;
            if (a <= 0.01) continue;
            const al = a * (0.45 + 0.55 * Math.sin(t2 * 1.6 + m.ph));
            const rg = pctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 7);
            rg.addColorStop(0, 'rgba(150,255,226,' + (0.6 * al).toFixed(3) + ')');
            rg.addColorStop(1, 'rgba(90,220,255,0)');
            pctx.fillStyle = rg;
            pctx.beginPath();
            pctx.arc(m.x, m.y, m.r * 7, 0, Math.PI * 2);
            pctx.fill();
          } else {
            // Marine snow: bright in the lit water, gone once there is
            // nothing left to light it.
            const a = Math.max(0.05, 1 - d * 0.85);
            pctx.fillStyle = 'rgba(226,244,252,' + (0.32 * a).toFixed(3) + ')';
            pctx.beginPath();
            pctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
            pctx.fill();
          }
        }

        // The accent follows the light: pale surface blue down to the green
        // of the things that glow.
        root.setProperty('--accent', 'hsl(' + (194 - d * 32).toFixed(1) + ' ' +
          (58 + d * 30).toFixed(0) + '% ' + (72 - d * 8).toFixed(0) + '%)');

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
      document.documentElement.style.removeProperty('--fx-deep-depth');
      // --accent is deliberately NOT removed here. applyTheme() writes the
      // incoming theme's palette and only then swaps the runtime, so this
      // stop() runs *after* the new accent is already in place — removing it
      // wipes the colour of the theme being switched to, not this one's.
      // Every path into here comes from applyTheme, so there is nothing to
      // clean up: the next theme's own accent has already overwritten ours.
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Kintsugi — the Japanese repair that fills a break with gold instead of
  // hiding it. Throw a paragraph away and the gap is seamed in gold, and the
  // seam stays: by the end of a session the window carries a map of
  // everything you decided against. Deleting one character does nothing —
  // only a real cut leaves a scar.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.kintsugi = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-kintsugi-canvas');
      const ctx = c.ctx;
      const rand = (a, d) => a + Math.random() * (d - a);

      // Seams are permanent, so the canvas is repainted from a model rather
      // than accumulated into: otherwise a single resize would erase the
      // whole session's record.
      let seams = [];
      let dirty = true;

      // A break: a walk that mostly holds its heading and wanders off it.
      const walk = (x, y, ang, len, step) => {
        const pts = [{ x, y }];
        let a = ang;
        for (let d = 0; d < len; d += step) {
          a += rand(-0.42, 0.42);
          x += Math.cos(a) * step;
          y += Math.sin(a) * step;
          pts.push({ x, y });
        }
        return pts;
      };

      const addSeam = (p, mag) => {
        if (!c.w || !c.h) return;
        const x = p ? p.x : c.w * rand(0.2, 0.8);
        const y = p ? p.y : c.h * rand(0.2, 0.8);
        const len = Math.min(c.w, c.h) * (0.22 + mag * 0.5);
        const ang = rand(0, Math.PI * 2);
        const lines = [walk(x, y, ang, len, 9)];
        // A real break forks rather than running clean.
        const forks = 1 + (Math.random() < 0.55 ? 1 : 0);
        for (let i = 0; i < forks; i++) {
          const at = lines[0][(lines[0].length * rand(0.25, 0.75)) | 0];
          lines.push(walk(at.x, at.y, ang + rand(-1.3, 1.3), len * rand(0.3, 0.6), 9));
        }
        // Stored as fractions of the window, so a resize moves each seam with
        // the glass instead of leaving it hanging off the edge.
        seams.push({
          lines: lines.map((ln) => ln.map((q) => ({ u: q.x / c.w, v: q.y / c.h }))),
          w: 1.1 + mag * 2.2, grow: 0, fade: 1
        });
        // Old repairs give way rather than vanishing, so a long session does
        // not end as a solid sheet of gold.
        if (seams.length > 26) seams[seams.length - 27].fade = 0.999;
        dirty = true;
      };

      const paint = () => {
        ctx.clearRect(0, 0, c.w, c.h);
        for (const s of seams) {
          if (s.fade <= 0.02) continue;
          for (const ln of s.lines) {
            const n = Math.max(2, Math.round(ln.length * s.grow));
            if (n < 2) continue;
            const pts = ln.slice(0, n);
            // Three passes: the break, the gold poured into it, and the light
            // sitting on the gold. One stroke alone reads as a drawn line.
            const passes = [
              { col: 'rgba(0,0,0,' + (0.5 * s.fade).toFixed(3) + ')', w: s.w * 2.4, blur: 0, off: 1.4 },
              // The mid pass carries the colour, so it has to be gold and not
              // the brown that a literal 'antique gold' hex gives you: at this
              // width against near-black it read as a tree root, not metal.
              { col: 'rgba(214,158,52,' + (0.95 * s.fade).toFixed(3) + ')', w: s.w * 2.1, blur: 14, off: 0 },
              { col: 'rgba(255,206,104,' + (0.95 * s.fade).toFixed(3) + ')', w: s.w * 1.1, blur: 6, off: 0 },
              // Metal is only metal because of the specular line down it.
              { col: 'rgba(255,246,214,' + (0.9 * s.fade).toFixed(3) + ')', w: s.w * 0.45, blur: 0, off: -0.7 }
            ];
            for (const p of passes) {
              ctx.strokeStyle = p.col;
              ctx.lineWidth = p.w;
              ctx.lineJoin = 'round';
              ctx.lineCap = 'round';
              ctx.shadowColor = p.blur ? 'rgba(255,186,72,0.9)' : 'transparent';
              ctx.shadowBlur = p.blur;
              ctx.beginPath();
              ctx.moveTo(pts[0].u * c.w, pts[0].v * c.h + p.off);
              for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].u * c.w, pts[i].v * c.h + p.off);
              ctx.stroke();
            }
          }
        }
        ctx.shadowBlur = 0;
        dirty = false;
      };

      const resize = () => { c.resize(); dirty = true; };
      window.addEventListener('resize', resize);
      this._resize = resize;

      // The deletion is read off the keyboard, not off the note's length,
      // because the length also jumps when you switch tabs — and a gold seam
      // for changing tabs would be a lie.
      let run = 0;
      const onKey = (e) => {
        const del = e.key === 'Backspace' || e.key === 'Delete';
        const cut = (e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X');
        if (!del && !cut) { if (e.key && e.key.length === 1) run = 0; return; }
        let picked = '';
        try {
          const s = window.getSelection();
          picked = s && !s.isCollapsed ? String(s) : '';
        } catch (err) { picked = ''; }
        if (picked.length >= 8) {
          addSeam(caretRect(), Math.min(1, picked.length / 240));
          run = 0;
          return;
        }
        if (!del) return;
        // Holding Backspace through a line is a real cut too, just a slow one.
        run++;
        if (run >= 16) { addSeam(caretRect(), 0.4); run = 0; }
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        let busy = false;
        for (const s of seams) {
          if (s.grow < 1) { s.grow = Math.min(1, s.grow + dt * 1.7); busy = true; }
          if (s.fade < 1) { s.fade -= dt * 0.06; busy = true; }
        }
        const before = seams.length;
        seams = seams.filter((s) => s.fade > 0.02);
        if (seams.length !== before) busy = true;
        // Gold does not move. Repaint only while something is flowing in or
        // giving way.
        if (busy || dirty) paint();
        rafId = requestAnimationFrame(tick);
      };
      paint();
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Blueprint — the app as a drafting sheet. The grid, the outlined panels
  // and the title block are all CSS; this runtime only adds the part a
  // drawing gets while it is still being made — construction lines projected
  // out from wherever the pencil currently is.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.blueprint = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-blueprint-canvas');
      const ctx = c.ctx;
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let marks = [];
      let lastAt = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const now = performance.now();
        // A held key would otherwise stack fifty identical projections.
        if (now - lastAt < 150) return;
        lastAt = now;
        const p = caretRect();
        if (!p) return;
        marks.push({ x: p.x, y: p.y, life: 1 });
        if (marks.length > 6) marks.shift();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        for (const m of marks) m.life -= dt * 1.15;
        marks = marks.filter((m) => m.life > 0);

        ctx.clearRect(0, 0, c.w, c.h);
        ctx.lineWidth = 1;
        for (const m of marks) {
          const a = Math.min(1, m.life) * 0.5;
          // Projections are dashed, the way a construction line is; the
          // pencil point itself is solid, the way the drawn line is.
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = 'rgba(140,226,255,' + a.toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(0, m.y); ctx.lineTo(c.w, m.y);
          ctx.moveTo(m.x, 0); ctx.lineTo(m.x, c.h);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(200,246,255,' + Math.min(1, a * 1.7).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(m.x - 7, m.y); ctx.lineTo(m.x + 7, m.y);
          ctx.moveTo(m.x, m.y - 7); ctx.lineTo(m.x, m.y + 7);
          ctx.stroke();
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Koi — a pond under the window. These are the only autonomous things in
  // any of the Pro themes: they steer, they keep off each other, and they
  // come to whatever you are writing the way pond koi come to a hand at the
  // edge. Stop typing and they lose interest and go back to their own
  // business, which takes about ten seconds — a school that scattered the
  // instant you paused read as a light switch rather than as animals.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.koi = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-koi-canvas');
      const ctx = c.ctx;
      const rand = (a, d) => a + Math.random() * (d - a);

      // Four real varieties, so a school reads as koi rather than as a bag
      // of coloured shapes — including the near-black one you cannot quite
      // see until it turns.
      const KINDS = [
        { body: '#f2ece2', patch: '#e05a2a' },
        { body: '#e8873a', patch: '#f4dfc4' },
        { body: '#2c2622', patch: '#c8641f' },
        { body: '#f2ece2', patch: '#171310' }
      ];

      let fish = [];
      const build = () => {
        // Four fish in a normal-sized window is not a school, it is three
        // fish and a gap; the panels hide a good share of them at any moment.
        const n = Math.max(6, Math.min(12, Math.round((c.w * c.h) / 34000)));
        fish = Array.from({ length: n }, () => {
          const k = KINDS[(Math.random() * KINDS.length) | 0];
          return {
            x: Math.random() * c.w, y: Math.random() * c.h,
            a: rand(0, Math.PI * 2), v: rand(26, 46), len: rand(30, 50),
            ph: rand(0, Math.PI * 2), rate: rand(5.5, 8),
            body: k.body, patch: k.patch,
            // Each fish carries its own markings, so the pattern is stable
            // instead of being re-rolled every frame.
            spots: Array.from({ length: 2 + ((Math.random() * 2) | 0) }, () => ({
              s: rand(0.12, 0.72), off: rand(-0.5, 0.5), r: rand(0.12, 0.3)
            })),
            wx: Math.random() * c.w, wy: Math.random() * c.h
          };
        });
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // How interested the school is in the caret right now. Typing feeds it.
      let interest = 0;
      let ripples = [];
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        interest = 1;
        const p = caretRect();
        if (p && ripples.length < 8 && Math.random() < 0.5) {
          ripples.push({ x: p.x, y: p.y, r: 2, life: 1 });
        }
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const angTo = (from, to) => {
        let d = to - from;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      };

      const N = 10;
      const drawFish = (f, t) => {
        const spine = [];
        for (let i = 0; i <= N; i++) {
          const s = i / N;
          // The tail swings and the head barely does, which is the whole
          // difference between swimming and sliding.
          const sway = Math.sin(t * f.rate + f.ph - s * 3.1) * s * s * f.len * 0.24;
          spine.push({
            x: f.x - Math.cos(f.a) * s * f.len - Math.sin(f.a) * sway,
            y: f.y - Math.sin(f.a) * s * f.len + Math.cos(f.a) * sway,
            // A fish is widest just behind the head and tapers to a thin
            // peduncle. The obvious `1 - s` version of this puts the widest
            // point at s = 0.72, i.e. near the tail, which is why the first
            // pass read as a slug rather than as a koi. The `1 - s` term is
            // what keeps the nose blunt: a koi has a rounded head, and the
            // bare sine alone tapers it to a needle point.
            w: f.len * 0.2 * (Math.sin(Math.pow(s, 0.42) * Math.PI) * 0.85 + (1 - s) * 0.22 + 0.06)
          });
        }
        const bodyPath = () => {
          ctx.beginPath();
          for (let i = 0; i <= N; i++) {
            const p = spine[i];
            const x = p.x - Math.sin(f.a) * p.w;
            const y = p.y + Math.cos(f.a) * p.w;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          for (let i = N; i >= 0; i--) {
            const p = spine[i];
            ctx.lineTo(p.x + Math.sin(f.a) * p.w, p.y - Math.cos(f.a) * p.w);
          }
          ctx.closePath();
        };

        // The shadow on the pond floor. Without it the fish sit on the glass
        // rather than in the water.
        ctx.save();
        ctx.translate(5, 7);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        bodyPath();
        ctx.fill();
        ctx.restore();

        // The caudal fin, drawn first so the body's own edge cuts its root.
        // It is anchored one segment up the spine rather than at the very tip,
        // which is what keeps it attached instead of trailing behind as a
        // separate triangle — and it is forked, because an unforked one reads
        // as a paddle. Body colour at low alpha: a fin is translucent, and a
        // flat grey one belongs to no fish in particular.
        const tl = spine[N];
        const root2 = spine[N - 1];
        const fl = f.len * 0.32;
        ctx.fillStyle = f.body;
        ctx.globalAlpha = 0.42;
        ctx.beginPath();
        ctx.moveTo(root2.x, root2.y);
        ctx.lineTo(tl.x - Math.cos(f.a - 0.62) * fl, tl.y - Math.sin(f.a - 0.62) * fl);
        ctx.lineTo(tl.x - Math.cos(f.a) * fl * 0.45, tl.y - Math.sin(f.a) * fl * 0.45);
        ctx.lineTo(tl.x - Math.cos(f.a + 0.62) * fl, tl.y - Math.sin(f.a + 0.62) * fl);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        bodyPath();
        ctx.fillStyle = f.body;
        ctx.fill();

        // Markings, clipped to the body so they read as patterning rather
        // than as blobs floating over it.
        ctx.save();
        bodyPath();
        ctx.clip();
        ctx.fillStyle = f.patch;
        for (const sp of f.spots) {
          const p = spine[Math.min(N, Math.max(0, Math.round(sp.s * N)))];
          ctx.beginPath();
          ctx.arc(p.x - Math.sin(f.a) * p.w * sp.off * 2,
                  p.y + Math.cos(f.a) * p.w * sp.off * 2, f.len * sp.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const t = now / 1000;
        interest = Math.max(0, interest - dt * 0.1);

        const p = interest > 0.05 ? caretRect() : null;
        for (const f of fish) {
          let tx, ty, urge;
          if (p) { tx = p.x; ty = p.y; urge = 1.6 * interest; }
          else {
            // Their own business: a waypoint, re-picked on arrival.
            if (Math.hypot(f.wx - f.x, f.wy - f.y) < 40) {
              f.wx = rand(0.08, 0.92) * c.w;
              f.wy = rand(0.08, 0.92) * c.h;
            }
            tx = f.wx; ty = f.wy; urge = 0.7;
          }
          let turn = angTo(f.a, Math.atan2(ty - f.y, tx - f.x)) * urge;

          // Keep off each other, or the school converges into one fish.
          for (const o of fish) {
            if (o === f) continue;
            const dx = o.x - f.x;
            const dy = o.y - f.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 1 && d2 < 3600) {
              turn -= angTo(f.a, Math.atan2(dy, dx)) * (1 - Math.sqrt(d2) / 60) * 2.2;
            }
          }
          // And off the glass.
          const m = 40;
          if (f.x < m) turn += angTo(f.a, 0) * 1.4;
          else if (f.x > c.w - m) turn += angTo(f.a, Math.PI) * 1.4;
          if (f.y < m) turn += angTo(f.a, Math.PI / 2) * 1.4;
          else if (f.y > c.h - m) turn += angTo(f.a, -Math.PI / 2) * 1.4;

          f.a += Math.max(-2.4, Math.min(2.4, turn)) * dt;
          // Koi hurry when they think there is food, and cruise otherwise.
          const sp = f.v * (1 + interest * 0.5);
          f.x += Math.cos(f.a) * sp * dt;
          f.y += Math.sin(f.a) * sp * dt;
        }

        ctx.clearRect(0, 0, c.w, c.h);

        for (const rp of ripples) { rp.r += 60 * dt; rp.life -= dt * 1.1; }
        ripples = ripples.filter((rp) => rp.life > 0);
        ctx.lineWidth = 1.2;
        for (const rp of ripples) {
          ctx.strokeStyle = 'rgba(210,240,230,' + (rp.life * 0.3).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
          ctx.stroke();
        }

        for (const f of fish) drawFish(f, t);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Tuxedo — black tie. The window is a satin lapel with gold thread in it:
  // the weave is fixed, and a broad specular sheen travels across it the way
  // light moves on silk when the wearer turns. Typing throws an extra glint
  // from the caret, so the cloth catches the light on every word.
  //
  // Deliberately not named after the film series whose aesthetic this is —
  // that name is somebody's trademark. The dinner jacket is not.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.tuxedo = {
    start() {
      const b = back();
      if (!b) return;
      // The weave never changes, so it is drawn once and left alone; only the
      // sheen is repainted per frame. Both are soft, so both are drawn small.
      const cloth = makeCanvas(b, 'fx-tux-weave', 0.5);
      const shine = makeCanvas(b, 'fx-tux-sheen', 0.5);
      const wctx = cloth.ctx;
      const sctx = shine.ctx;

      // The weave runs on the bias, the way a lapel is cut.
      const ANG = -0.42;
      const DX = Math.cos(ANG);
      const DY = Math.sin(ANG);

      const drawWeave = () => {
        const w = cloth.w;
        const h = cloth.h;
        wctx.clearRect(0, 0, w, h);
        const base = wctx.createLinearGradient(0, 0, 0, h);
        base.addColorStop(0, '#141210');
        base.addColorStop(1, '#080706');
        wctx.fillStyle = base;
        wctx.fillRect(0, 0, w, h);
        // Anisotropy is the whole trick with satin: the highlights are
        // stretched along one axis, which is what separates cloth from a
        // plain dark gradient. Long thin streaks on the bias do it cheaply.
        const span = Math.abs(w * DX) + Math.abs(h * DY) + Math.abs(w * DY) + Math.abs(h * DX);
        wctx.save();
        wctx.translate(w / 2, h / 2);
        wctx.rotate(ANG);
        for (let i = 0; i < 150; i++) {
          const y = (i / 150 - 0.5) * span;
          const a = 0.03 + Math.random() * 0.075;
          wctx.strokeStyle = 'rgba(226,206,164,' + a.toFixed(3) + ')';
          wctx.lineWidth = 0.6 + Math.random() * 1.6;
          wctx.beginPath();
          wctx.moveTo(-span / 2, y);
          wctx.lineTo(span / 2, y + (Math.random() - 0.5) * 6);
          wctx.stroke();
        }
        wctx.restore();
      };

      const resize = () => { cloth.resize(); shine.resize(); drawWeave(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let glints = [];
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const p = caretRect();
        if (!p) return;
        // Halved, because the sheen canvas is drawn at half scale.
        glints.push({ x: p.x / 2, y: p.y / 2, life: 1 });
        if (glints.length > 7) glints.shift();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let phase = 0.2;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        // One pass roughly every twelve seconds: any faster and it stops
        // reading as light on cloth and starts reading as a loading bar.
        phase += dt / 12;
        if (phase > 1.35) phase = -0.35;

        const w = shine.w;
        const h = shine.h;
        sctx.clearRect(0, 0, w, h);
        sctx.globalCompositeOperation = 'lighter';

        const L = Math.abs(w * DX) + Math.abs(h * DY);
        const cx = w / 2;
        const cy = h / 2;
        const g = sctx.createLinearGradient(
          cx - DX * L / 2, cy - DY * L / 2, cx + DX * L / 2, cy + DY * L / 2);
        const at = Math.max(0, Math.min(1, phase));
        const lo = Math.max(0, at - 0.22);
        const hi = Math.min(1, at + 0.22);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(lo, 'rgba(0,0,0,0)');
        g.addColorStop(at, 'rgba(246,222,164,0.26)');
        g.addColorStop(hi, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, w, h);

        // The glints: gold, brief, and stretched along the weave, because a
        // round highlight on satin looks like a stray dot of paint.
        for (const gl of glints) gl.life -= dt * 1.6;
        glints = glints.filter((gl) => gl.life > 0);
        for (const gl of glints) {
          const r = 40 + (1 - gl.life) * 70;
          const a = gl.life * gl.life * 0.5;
          const rg = sctx.createRadialGradient(0, 0, 0, 0, 0, r);
          rg.addColorStop(0, 'rgba(255,232,170,' + a.toFixed(3) + ')');
          rg.addColorStop(0.5, 'rgba(226,180,92,' + (a * 0.35).toFixed(3) + ')');
          rg.addColorStop(1, 'rgba(200,150,60,0)');
          sctx.save();
          sctx.translate(gl.x, gl.y);
          sctx.rotate(ANG);
          sctx.scale(1, 0.28);
          sctx.fillStyle = rg;
          sctx.beginPath();
          sctx.arc(0, 0, r, 0, Math.PI * 2);
          sctx.fill();
          sctx.restore();
        }

        sctx.globalCompositeOperation = 'source-over';
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Frost — the only theme that watches you *not* type. Sit still and ice
  // grows in from the edges of the glass, branch by branch; the caret stays
  // warm and keeps a clear hole around whatever you are writing, so the note
  // never becomes unreadable however long you leave it. Start typing again
  // and the warmth spreads and takes the ice back.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.frost = {
    start() {
      const l = layer();
      if (!l) return;
      // On the glass, not behind it — frost that grew behind the panels would
      // be a pretty background rather than something happening to the window.
      // The canvas accumulates: it is never cleared, only added to and melted
      // out of, which is what lets an hour of ice actually build up.
      const c = makeCanvas(l, 'fx-frost-canvas');
      const ctx = c.ctx;
      const rand = (a, d) => a + Math.random() * (d - a);

      let tips = [];
      const seed = () => {
        // Crystals start on the frame and walk inward, because that is where
        // a window is coldest — and it conveniently frosts the text last.
        const n = 26;
        tips = Array.from({ length: n }, () => {
          const edge = (Math.random() * 4) | 0;
          const t = Math.random();
          if (edge === 0) return { x: t * c.w, y: 0, a: Math.PI / 2, len: 0 };
          if (edge === 1) return { x: t * c.w, y: c.h, a: -Math.PI / 2, len: 0 };
          if (edge === 2) return { x: 0, y: t * c.h, a: 0, len: 0 };
          return { x: c.w, y: t * c.h, a: Math.PI, len: 0 };
        });
      };
      const resize = () => { c.resize(); ctx.clearRect(0, 0, c.w, c.h); seed(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let lastKey = performance.now() - 4000;   // start with a little ice
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        lastKey = performance.now();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const grow = (steps) => {
        ctx.lineCap = 'round';
        for (let s = 0; s < steps; s++) {
          const t = tips[(Math.random() * tips.length) | 0];
          if (!t) continue;
          // Six-fold is what makes ice read as ice: the walk is snapped to
          // sixty-degree turns rather than wandering freely, which is the
          // difference between a frost fern and a crack.
          if (Math.random() < 0.22) t.a += (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 3);
          const step = rand(3, 7);
          const nx = t.x + Math.cos(t.a) * step;
          const ny = t.y + Math.sin(t.a) * step;
          ctx.strokeStyle = 'rgba(226,242,255,' + rand(0.10, 0.30).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.5, 1.9 - t.len / 90);
          ctx.beginPath();
          ctx.moveTo(t.x, t.y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          t.x = nx;
          t.y = ny;
          t.len += step;
          // A branch, and a retirement: a tip that ran a long way is replaced
          // at the edge so the growth keeps coming from the cold frame.
          if (Math.random() < 0.10 && tips.length < 150) {
            tips.push({ x: nx, y: ny, a: t.a + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 3), len: t.len });
          }
          if (t.len > 260 || nx < -20 || ny < -20 || nx > c.w + 20 || ny > c.h + 20) {
            const e2 = (Math.random() * 4) | 0;
            const u = Math.random();
            if (e2 === 0) { t.x = u * c.w; t.y = 0; t.a = Math.PI / 2; }
            else if (e2 === 1) { t.x = u * c.w; t.y = c.h; t.a = -Math.PI / 2; }
            else if (e2 === 2) { t.x = 0; t.y = u * c.h; t.a = 0; }
            else { t.x = c.w; t.y = u * c.h; t.a = Math.PI; }
            t.len = 0;
          }
        }
      };

      const melt = (p, r, strength) => {
        // destination-out is what makes this a melt rather than a smear: it
        // takes the ice away instead of painting warm colour over it.
        ctx.globalCompositeOperation = 'destination-out';
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
        g.addColorStop(0.55, 'rgba(0,0,0,' + (strength * 0.6).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      };

      const root = document.documentElement.style;
      let nextDraw = 0;
      const tick = (now) => {
        const idle = (now - lastKey) / 1000;
        root.setProperty('--fx-frost-idle', Math.min(1, idle / 45).toFixed(3));

        if (now >= nextDraw) {
          nextDraw = now + 60;
          // Nothing grows while a hand is on the keyboard. After a couple of
          // seconds of quiet it starts, and it speeds up the longer the quiet
          // lasts — an even rate reads as a screensaver.
          if (idle > 1.6) grow(Math.min(26, Math.round(2 + idle * 1.6)));
          const p = caretRect();
          if (p) {
            // The breath hole. It is kept open even while idle, because ice
            // over the words you are looking at is a broken editor, not a
            // theme; only its size follows how recently you typed.
            const warm = Math.max(0.35, 1 - idle / 10);
            melt(p, 92 + warm * 74, (0.5 + warm * 0.45).toFixed(3));
          }
          if (idle < 0.7) {
            // Actively writing: the warmth runs well past the caret.
            const q = p || { x: c.w / 2, y: c.h / 2 };
            melt(q, 250, '0.16');
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
      document.documentElement.style.removeProperty('--fx-frost-idle');
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Sundial — the sky behind the window is the real time of day. The light
  // physically crosses from one edge to the other between six and six, the
  // sidebar throws a shadow that swings round with it, and at night the
  // panels are lit by nothing but themselves. It is the only theme that
  // looks different depending on when you opened the app.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.sundial = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-sundial-canvas', 0.35);
      const ctx = c.ctx;
      const root = document.documentElement.style;

      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const mix = (a, d, k) => Math.round(a + (d - a) * k);

      // Where the rail ends, so the shadow it casts starts in the right
      // place. Measured occasionally rather than per frame — it only moves
      // when the window does.
      let railRight = 0;
      const measure = () => {
        const r = document.querySelector('.rail');
        railRight = r ? r.getBoundingClientRect().right : 0;
      };
      measure();

      let nextMeasure = 0;
      const tick = (now) => {
        if (now >= nextMeasure) { measure(); nextMeasure = now + 1000; }

        const d = new Date();
        const h = d.getHours() + d.getMinutes() / 60;
        // Six to six. Everything else — the colour, the shadow, the accent —
        // is a function of these two numbers.
        const dayT = (h - 6) / 12;
        const day = dayT >= 0 && dayT <= 1;
        const up = day ? Math.sin(dayT * Math.PI) : 0;
        // Compressed to the middle three quarters of the width: the true
        // 0-to-1 sweep puts the low sun behind the rail at exactly the hours
        // its colour is most worth seeing.
        const sunX = (0.13 + Math.max(0, Math.min(1, dayT)) * 0.74) * c.w;
        const sunY = (0.06 + (1 - up) * 0.72) * c.h;

        root.setProperty('--fx-sun-up', up.toFixed(3));

        // Night is not black: it is the deep blue you actually see out of a
        // window at three in the morning, which keeps the panels sitting in
        // a room rather than in a void.
        const g = ctx.createLinearGradient(0, 0, 0, c.h);
        g.addColorStop(0, 'rgb(' + mix(8, 128, up) + ',' + mix(13, 176, up) + ',' + mix(30, 220, up) + ')');
        g.addColorStop(1, 'rgb(' + mix(14, 62, up) + ',' + mix(18, 116, up) + ',' + mix(36, 172, up) + ')');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.w, c.h);

        if (day) {
          // Low sun is orange and high sun is white — the single most
          // legible signal of what time it is, more than the sky colour.
          const warm = 1 - up;
          const r0 = mix(255, 255, 1);
          const g0 = mix(150, 250, up);
          const b0 = mix(70, 232, up);
          const rad = c.h * (0.5 + warm * 0.35);
          const rg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, rad);
          rg.addColorStop(0, 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',' + (0.55 + up * 0.3).toFixed(3) + ')');
          rg.addColorStop(0.22, 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',0.22)');
          rg.addColorStop(1, 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',0)');
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(sunX, sunY, rad, 0, Math.PI * 2);
          ctx.fill();

          // A rake of light falling across the sheet, tilted with the sun
          // and travelling with it. The first version cast the rail's shadow
          // instead, which is more literal but only reads for half the day:
          // once the sun is past the rail the shadow falls behind the rail
          // itself and is invisible. This one is legible from dawn to dusk.
          const tilt = (dayT - 0.5) * 1.6;
          const band = c.w * (0.20 + (1 - up) * 0.22);
          const across = c.w * 1.9;
          const lg = ctx.createLinearGradient(-band, 0, band, 0);
          const la = (0.09 + up * 0.15).toFixed(3);
          lg.addColorStop(0, 'rgba(255,232,180,0)');
          lg.addColorStop(0.5, 'rgba(255,' + mix(196, 246, up) + ',' + mix(128, 226, up) + ',' + la + ')');
          lg.addColorStop(1, 'rgba(255,232,180,0)');
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.translate(c.w / 2 + (dayT - 0.5) * c.w * 0.7, c.h / 2);
          ctx.rotate(tilt);
          ctx.fillStyle = lg;
          ctx.fillRect(-band, -across / 2, band * 2, across);
          ctx.restore();

          // And the rail's shadow on the sheet, kept but only while the sun
          // is genuinely on the far side of it.
          const edge = railRight || c.w * 0.33;
          if (sunX < edge) {
            const len = (0.10 + (1 - up) * 0.5) * c.w;
            const sg = ctx.createLinearGradient(edge, 0, edge + len, 0);
            sg.addColorStop(0, 'rgba(0,0,0,' + (0.3 * (0.35 + up * 0.65)).toFixed(3) + ')');
            sg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = sg;
            ctx.fillRect(edge, 0, len, c.h);
          }
        }

        // Amber at the ends of the day, cold daylight at noon, moonlight at
        // night — interpolated in RGB rather than in hue. Sweeping the hue
        // from 32 to 200 is the obvious way to write this and it is wrong:
        // the shortest path between amber and blue on the wheel runs through
        // yellow and green, so seven in the morning came out lime.
        const k = day ? Math.max(0, Math.min(1, (up - 0.22) / 0.5)) : 0;
        root.setProperty('--accent', day
          ? 'rgb(' + mix(226, 202, k) + ',' + mix(168, 222, k) + ',' + mix(94, 246, k) + ')'
          : 'rgb(138,158,200)');

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
      document.documentElement.style.removeProperty('--fx-sun-up');
      // --accent is left alone on purpose; see the note in RUNTIMES.keys.stop.
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Clockwork — a gear train you are winding.
  //
  // This replaces Orrery, which span continuously and only changed *speed*
  // with your typing. Continuous rotation is the problem: a machine that runs
  // whether or not you touch it is scenery, and you never feel connected to
  // it. So the train is dead still, and one keystroke advances the driver by
  // exactly one tooth — with the ratchet you would hear if it were brass.
  // Everything downstream turns by its own gear ratio, in the right direction,
  // by the right amount, which is the part that makes it read as a mechanism
  // rather than as some circles rotating near each other.
  //
  // The escapement rocks on every step too. It is the smallest part on screen
  // and it is the one that sells the whole thing.

  // ────────────────────────────────────────────────────────────────────────
  // Filings — iron filings on a sheet of paper, and the caret is the magnet
  // under it. The field is a dipole lying along the line you are writing, so
  // the filings arch over and under the words the way they do in the picture
  // in every physics textbook. Move the caret and the whole sheet re-aligns.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.filings = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-filings-canvas');
      const ctx = c.ctx;

      const GAP = 19;
      let grid = [];
      const build = () => {
        grid = [];
        for (let y = GAP / 2; y < c.h; y += GAP) {
          for (let x = GAP / 2; x < c.w; x += GAP) {
            grid.push({
              // Jittered off the lattice, or the whole sheet reads as a
              // checkerboard rather than as scattered filings.
              x: x + (Math.random() - 0.5) * GAP * 0.55,
              y: y + (Math.random() - 0.5) * GAP * 0.55,
              a: Math.random() * Math.PI,
              len: 4 + Math.random() * 4
            });
          }
        }
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let jolt = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        jolt = 1;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let px = 0;
      let py = 0;
      let have = false;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        jolt = Math.max(0, jolt - dt * 2.2);

        // caretRect() is null until there is a real caret — on a fresh
        // window nobody has clicked into the note yet. Falling back to the
        // middle of the editor matters more here than in the other
        // caret-driven themes: without a pole there is no field at all, so
        // the theme was simply blank rather than merely static.
        let p = caretRect();
        if (!p) {
          const ed = document.querySelector('.editor-area');
          const r = ed && ed.getBoundingClientRect();
          p = r && r.width
            ? { x: r.left + r.width / 2, y: r.top + r.height * 0.42 }
            : { x: c.w / 2, y: c.h / 2 };
        }
        if (!have) { px = p.x; py = p.y; have = true; }
        // The magnet is dragged to the caret rather than teleported, so a
        // click across the note sweeps the field instead of cutting to it.
        const k = Math.min(1, dt * 7);
        px += (p.x - px) * k;
        py += (p.y - py) * k;

        ctx.clearRect(0, 0, c.w, c.h);

        // A dipole laid along the writing line: one pole a little to the left
        // of the caret and one a little to the right. A single pole gives a
        // plain starburst, which is a much less interesting picture.
        const D = 46;
        const n1x = px - D;
        const n2x = px + D;
        ctx.lineCap = 'round';
        for (const f of grid) {
          let bx = 0;
          let by = 0;
          for (let s = 0; s < 2; s++) {
            const q = s ? -1 : 1;
            const dx = f.x - (s ? n2x : n1x);
            const dy = f.y - py;
            const d2 = dx * dx + dy * dy + 260;
            const d = Math.sqrt(d2);
            const k = q / (d2 * d);
            bx += dx * k;
            by += dy * k;
          }
          const mag = Math.hypot(bx, by);
          const want = Math.atan2(by, bx);
          // A filing has no head or tail, so it aligns to the field modulo a
          // half turn — wrapping to ±90° is what stops them spinning a full
          // circle to reach an orientation they were already in.
          let dA = want - f.a;
          while (dA > Math.PI / 2) dA -= Math.PI;
          while (dA < -Math.PI / 2) dA += Math.PI;
          f.a += dA * Math.min(1, dt * (4 + mag * 2.4e5));
          if (jolt > 0) f.a += (Math.random() - 0.5) * jolt * 0.5 * dt * 10;

          // Strong field, dark filing: near the poles they crowd and stand up
          // black, and out at the corners they are barely there. Capped well
          // below opaque — the first pass topped out at 0.85 and the sheet
          // was legible but the titlebar and toolbar underneath it were not.
          const al = Math.min(0.44, 0.055 + mag * 1.4e5);
          const half = f.len * (0.7 + Math.min(1, mag * 1.6e5) * 0.6);
          ctx.strokeStyle = 'rgba(38,42,52,' + al.toFixed(3) + ')';
          ctx.lineWidth = 0.9 + Math.min(0.7, mag * 1.4e5);
          ctx.beginPath();
          ctx.moveTo(f.x - Math.cos(f.a) * half, f.y - Math.sin(f.a) * half);
          ctx.lineTo(f.x + Math.cos(f.a) * half, f.y + Math.sin(f.a) * half);
          ctx.stroke();
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // VIP runtimes.
  //
  // Each of these is a material rather than an effect: the app rendered in
  // brushed platinum, in velvet, in marble, in leather. They share a shape —
  // a static texture canvas drawn once, and a thin animated canvas over it
  // carrying whatever the light is doing — because that is how these
  // materials actually differ from one another. What separates satin from
  // brushed metal is not the colour, it is the way a highlight travels.
  // ────────────────────────────────────────────────────────────────────────

  // Black Card — matte black metal, machined and micro-brushed, with a hard
  // specular edge that rakes across it. Platinum rather than gold: Tuxedo
  // already owns the gold, and the second luxury theme reading as a second
  // gold theme is how a category stops feeling like a set.
  RUNTIMES.blackcard = {
    start() {
      const b = back();
      if (!b) return;
      const metal = makeCanvas(b, 'fx-card-metal', 0.5);
      const spec = makeCanvas(b, 'fx-card-spec', 0.5);
      const mctx = metal.ctx;
      const sctx = spec.ctx;

      const drawMetal = () => {
        const w = metal.w;
        const h = metal.h;
        const g = mctx.createLinearGradient(0, 0, w * 0.35, h);
        g.addColorStop(0, '#16171a');
        g.addColorStop(0.5, '#0e0f11');
        g.addColorStop(1, '#141518');
        mctx.fillStyle = g;
        mctx.fillRect(0, 0, w, h);
        // Brushed metal is horizontal micro-scratches and nothing else. The
        // temptation is to add a noise field on top; it reads as dirt.
        for (let i = 0; i < 700; i++) {
          const y = Math.random() * h;
          const x = Math.random() * w;
          const len = 30 + Math.random() * 220;
          const a = 0.012 + Math.random() * 0.05;
          mctx.strokeStyle = Math.random() < 0.5
            ? 'rgba(255,255,255,' + a.toFixed(3) + ')'
            : 'rgba(0,0,0,' + (a * 1.3).toFixed(3) + ')';
          mctx.lineWidth = Math.random() < 0.85 ? 0.5 : 1.1;
          mctx.beginPath();
          mctx.moveTo(x, y);
          mctx.lineTo(x + len, y + (Math.random() - 0.5) * 1.2);
          mctx.stroke();
        }
      };
      const resize = () => { metal.resize(); spec.resize(); drawMetal(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let kick = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        kick = 1;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let phase = 0.15;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        // Metal's highlight is narrow and hard-edged, where satin's is broad
        // and soft. That single difference is most of what tells the two
        // materials apart at a glance, so it is worth being strict about.
        kick = Math.max(0, kick - dt * 1.4);
        phase += dt * (0.055 + kick * 0.22);
        if (phase > 1.3) phase = -0.3;

        const w = spec.w;
        const h = spec.h;
        sctx.clearRect(0, 0, w, h);
        sctx.globalCompositeOperation = 'lighter';
        const at = Math.max(0, Math.min(1, phase));
        const g = sctx.createLinearGradient(0, 0, w, h * 0.55);
        const a = 0.10 + kick * 0.14;
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(Math.max(0, at - 0.07), 'rgba(0,0,0,0)');
        g.addColorStop(Math.max(0.001, at - 0.02), 'rgba(214,226,238,' + (a * 0.5).toFixed(3) + ')');
        g.addColorStop(at, 'rgba(236,244,252,' + a.toFixed(3) + ')');
        g.addColorStop(Math.min(0.999, at + 0.02), 'rgba(214,226,238,' + (a * 0.5).toFixed(3) + ')');
        g.addColorStop(Math.min(1, at + 0.07), 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, w, h);
        sctx.globalCompositeOperation = 'source-over';
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // Velvet — the one material here that gets darker the more directly you
  // look at it. The nap catches light at grazing angles and swallows it head
  // on, so the sheen is a wide soft pool rather than a band, and it gathers
  // around the caret: the pile is brushed by the hand that is writing.
  RUNTIMES.velvet = {
    start() {
      const b = back();
      if (!b) return;
      const pile = makeCanvas(b, 'fx-velvet-pile', 0.5);
      const glow = makeCanvas(b, 'fx-velvet-glow', 0.35);
      const pctx = pile.ctx;
      const gctx = glow.ctx;

      const drawPile = () => {
        const w = pile.w;
        const h = pile.h;
        const g = pctx.createRadialGradient(w * 0.5, h * 0.34, 0, w * 0.5, h * 0.34, Math.max(w, h) * 0.8);
        g.addColorStop(0, '#3a1220');
        g.addColorStop(0.6, '#260c16');
        g.addColorStop(1, '#160710');
        pctx.fillStyle = g;
        pctx.fillRect(0, 0, w, h);
        // The pile itself: very short strokes at random angles. Long ones
        // read as hair, and at this density the difference is the whole
        // distance between velvet and a dark carpet.
        for (let i = 0; i < 2600; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          const a = Math.random() * Math.PI;
          const l = 1.6 + Math.random() * 3.4;
          pctx.strokeStyle = Math.random() < 0.5
            ? 'rgba(255,196,214,0.05)'
            : 'rgba(0,0,0,0.07)';
          pctx.lineWidth = 0.7;
          pctx.beginPath();
          pctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
          pctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
          pctx.stroke();
        }
      };
      const resize = () => { pile.resize(); glow.resize(); drawPile(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let warm = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        warm = 1;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let ax = 0;
      let ay = 0;
      let have = false;
      let t = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        t += dt;
        warm = Math.max(0, warm - dt * 0.5);

        const p = caretRect();
        const tx = p ? p.x : glow.w / 2;
        const ty = p ? p.y : glow.h * 0.4;
        if (!have) { ax = tx; ay = ty; have = true; }
        // Slow: the pile is being brushed, not spotlit.
        ax += (tx - ax) * Math.min(1, dt * 2.2);
        ay += (ty - ay) * Math.min(1, dt * 2.2);

        const w = glow.w;
        const h = glow.h;
        gctx.clearRect(0, 0, w, h);
        gctx.globalCompositeOperation = 'lighter';
        // Two pools: one that drifts on its own so the cloth is never dead,
        // and one under the hand.
        const drift = gctx.createRadialGradient(
          w * (0.5 + Math.sin(t * 0.13) * 0.3), h * (0.35 + Math.cos(t * 0.09) * 0.2), 0,
          w * (0.5 + Math.sin(t * 0.13) * 0.3), h * (0.35 + Math.cos(t * 0.09) * 0.2),
          Math.max(w, h) * 0.55);
        drift.addColorStop(0, 'rgba(190,72,104,0.16)');
        drift.addColorStop(1, 'rgba(190,72,104,0)');
        gctx.fillStyle = drift;
        gctx.fillRect(0, 0, w, h);

        const r = 150 + warm * 90;
        const hand = gctx.createRadialGradient(ax, ay, 0, ax, ay, r);
        hand.addColorStop(0, 'rgba(232,120,150,' + (0.10 + warm * 0.14).toFixed(3) + ')');
        hand.addColorStop(1, 'rgba(232,120,150,0)');
        gctx.fillStyle = hand;
        gctx.beginPath();
        gctx.arc(ax, ay, r, 0, Math.PI * 2);
        gctx.fill();
        gctx.globalCompositeOperation = 'source-over';
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };

  // Marble — Calacatta: white stone with gold running through it. The only
  // light theme in the set, and the only static one. Stone does not move, so
  // this draws once and then does nothing at all until the window is
  // resized; the polish comes from CSS, which is the honest way round.
  RUNTIMES.marble = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-marble-canvas');
      const ctx = c.ctx;
      const rand = (a, d) => a + Math.random() * (d - a);

      // A vein is a walk that keeps its heading and drifts, drawn several
      // times at decreasing width — real veining is a bundle of near-parallel
      // seams, not one line, and the bundle is what makes it stone.
      const vein = (x, y, ang, len, w0, col, wobble) => {
        let a = ang;
        const pts = [{ x, y }];
        for (let d = 0; d < len; d += 12) {
          a += rand(-wobble, wobble);
          x += Math.cos(a) * 12;
          y += Math.sin(a) * 12;
          pts.push({ x, y });
        }
        for (let pass = 0; pass < 3; pass++) {
          ctx.strokeStyle = col(pass);
          ctx.lineWidth = w0 * (1 - pass * 0.3);
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          const off = (pass - 1) * w0 * 0.9;
          ctx.moveTo(pts[0].x, pts[0].y + off);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y + off);
          ctx.stroke();
        }
        return pts;
      };

      const draw = () => {
        ctx.clearRect(0, 0, c.w, c.h);
        const g = ctx.createLinearGradient(0, 0, c.w * 0.5, c.h);
        g.addColorStop(0, '#fbfaf7');
        g.addColorStop(0.55, '#f3f1eb');
        g.addColorStop(1, '#e9e6dd');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.w, c.h);

        const S = Math.max(c.w, c.h);
        // The grey structural veins first, then fewer gold ones on top: on
        // real Calacatta the gold follows the grey rather than crossing it.
        for (let i = 0; i < 7; i++) {
          vein(rand(-0.1, 0.9) * c.w, rand(-0.1, 0.4) * c.h,
            rand(0.45, 1.15), S * rand(0.7, 1.3), rand(1.4, 3.4),
            (p) => 'rgba(150,148,142,' + (0.1 + p * 0.05).toFixed(3) + ')', 0.30);
        }
        for (let i = 0; i < 3; i++) {
          vein(rand(-0.1, 0.85) * c.w, rand(-0.1, 0.5) * c.h,
            rand(0.5, 1.1), S * rand(0.6, 1.1), rand(1.2, 2.4),
            (p) => (p === 1
              ? 'rgba(198,158,72,0.42)'
              : 'rgba(176,140,66,0.20)'), 0.34);
        }
        // The polish: a broad low sheen across the slab.
        const sh = ctx.createLinearGradient(0, c.h, c.w, 0);
        sh.addColorStop(0, 'rgba(255,255,255,0)');
        sh.addColorStop(0.45, 'rgba(255,255,255,0.5)');
        sh.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, 0, c.w, c.h);
      };

      const resize = () => { c.resize(); draw(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;
      // No rAF at all. Stone is the one material in this set that has no
      // business animating, and a slab that shimmers reads as plastic.
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
    }
  };

  // Nightvision — a tactical HUD taking a hit. Corner targeting brackets and
  // a scanline sweep sit over everything all the time; every keystroke (and
  // the odd unprompted hiccup) throws a burst of torn, RGB-split scanlines
  // and a scatter of static, like a comms link losing sync for a moment.
  //
  // Everything here draws into #fxLayer (over the UI, not behind it) — a HUD
  // overlay belongs on top of what it's reading, the same reasoning Wounds
  // and CRT use. The per-keystroke handler only ever pushes a few plain
  // objects onto bounded arrays and queries nothing — a keydown handler is
  // on the input path, and Wounds once cost 14-17ms per recompute on a long
  // note by scanning every line in the note from exactly this kind of hook.
  RUNTIMES.nightvision = {
    start() {
      const l = layer();
      if (!l) return;

      // Corner brackets are static chrome, not per-frame drawing — plain
      // elements cost nothing to keep on screen, unlike redrawing them into
      // a canvas 60 times a second for no visual gain.
      const brackets = ['tl', 'tr', 'bl', 'br'].map((pos) => {
        const d = document.createElement('div');
        d.className = 'fx-nv-bracket fx-nv-' + pos;
        l.appendChild(d);
        return d;
      });
      this._brackets = brackets;

      const c = makeCanvas(l, 'fx-nv-canvas');
      const ctx = c.ctx;
      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let scan = 0;      // scanline scroll phase, px
      let glitch = 0;     // 0..1, decays — how hard the signal is glitching right now
      let bands = [];     // active tear bands: { y, h, dx, life }
      let nextAmbientAt = performance.now() + 4000 + Math.random() * 5000;

      const burst = (power) => {
        glitch = Math.min(1, glitch + power);
        const n = 1 + (Math.random() * 3 | 0);
        for (let i = 0; i < n; i++) {
          bands.push({ y: Math.random() * c.h, h: 3 + Math.random() * 14,
            dx: (Math.random() - 0.5) * 40 * power, life: 1 });
        }
        if (bands.length > 24) bands.splice(0, bands.length - 24);
      };

      let lastKey = 0;
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        const now = performance.now();
        if (now - lastKey < 60) return;
        lastKey = now;
        burst(e.key === 'Enter' ? 0.9 : 0.45 + Math.random() * 0.3);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // A HUD left alone still hiccups now and then — dead-still reads as
        // broken, not as calm.
        if (now >= nextAmbientAt) {
          burst(0.25 + Math.random() * 0.2);
          nextAmbientAt = now + 5000 + Math.random() * 9000;
        }

        glitch = Math.max(0, glitch - dt * 1.8);
        scan = (scan + dt * 40) % 28;

        ctx.clearRect(0, 0, c.w, c.h);

        // Persistent scanlines — always faintly there, brighter while
        // glitching so a burst reads as the *same* signal breaking up.
        ctx.strokeStyle = 'rgba(60,240,190,' + (0.05 + glitch * 0.10).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = -28 + scan; y < c.h; y += 4) { ctx.moveTo(0, y); ctx.lineTo(c.w, y); }
        ctx.stroke();

        // Torn bands: a strip that has slipped sideways, with red/cyan
        // fringes either side of the pale core — RGB-split edges are what
        // sell a signal fault instead of a plain drawn stripe.
        for (const bnd of bands) {
          const a = bnd.life;
          ctx.fillStyle = 'rgba(255,50,90,' + (0.10 * a).toFixed(3) + ')';
          ctx.fillRect(bnd.dx - 2, bnd.y, c.w, bnd.h);
          ctx.fillStyle = 'rgba(60,240,255,' + (0.10 * a).toFixed(3) + ')';
          ctx.fillRect(bnd.dx + 2, bnd.y, c.w, bnd.h);
          ctx.fillStyle = 'rgba(180,255,220,' + (0.14 * a).toFixed(3) + ')';
          ctx.fillRect(bnd.dx, bnd.y, c.w, bnd.h);
        }
        for (const bnd of bands) bnd.life -= dt * 3.2;
        bands = bands.filter((bnd) => bnd.life > 0);

        // A scatter of static, only while actively glitching — a few dozen
        // points, not a full-frame noise fill.
        if (glitch > 0.03) {
          const n = Math.round(glitch * 90);
          ctx.fillStyle = 'rgba(200,255,230,0.5)';
          for (let i = 0; i < n; i++) ctx.fillRect(Math.random() * c.w, Math.random() * c.h, 1.5, 1.5);
        }

        brackets.forEach((d) => { d.style.opacity = (0.55 + glitch * 0.45).toFixed(2); });

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._brackets) this._brackets.forEach((d) => d.remove());
      this._resize = null;
      this._onKey = null;
      this._brackets = null;
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Fountain — a lit onyx basin seen from above. The whole window is the water
  // surface; every keystroke sends a jet up from the caret whose droplets fall
  // back and ring the surface where they land.
  //
  // The ripples are a real height field (the two-buffer wave relaxation every
  // water demo uses) rather than expanding circles: circles look drawn on,
  // and the thing that makes water read as water is that two rings meeting
  // interfere instead of crossing.
  //
  // Cost is kept down by simulating at a quarter of the window's pixels and
  // letting the canvas scale it up — the field is smooth, so nothing is lost.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.fountain = {
    start() {
      const b = back();
      if (!b) return;

      // Sized by build() rather than makeCanvas: the water canvas is a grid of
      // simulation cells stretched over the window by CSS, not a 1:1 surface.
      const c = makeCanvas(b, 'fx-fountain-canvas');
      // The spray is drawn over the app, not under it — a droplet thrown up
      // out of the basin is in front of the glass on its way back down.
      const l = layer();
      const spray = l ? makeCanvas(l, 'fx-fountain-spray') : null;

      const CELL = 4;                 // window px per simulation cell
      // Rings have to die inside a couple of seconds. Held longer the window
      // fills with standing interference and stops reading as water in a basin
      // — it reads as a pattern. Much shorter and a ripple never gets away
      // from the caret, which reads as a glow rather than a wave.
      const DAMP = 0.976;
      let W = 0, H = 0, N = 0;
      let prev = null, cur = null, img = null;

      const build = () => {
        W = Math.max(8, Math.ceil(window.innerWidth / CELL));
        H = Math.max(8, Math.ceil(window.innerHeight / CELL));
        N = W * H;
        prev = new Float32Array(N);
        cur = new Float32Array(N);
        c.canvas.width = W;
        c.canvas.height = H;
        c.ctx.setTransform(1, 0, 0, 1, 0, 0);
        img = c.ctx.createImageData(W, H);
        // Opaque: the basin is a surface, not a veil. The panels above it are
        // the translucent part.
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      };

      const resize = () => {
        c.w = window.innerWidth; c.h = window.innerHeight;
        if (spray) spray.resize();
        build();
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // Push the surface down at a point. Spread over a few cells so a drop
      // makes a ring rather than a single-pixel spike.
      const poke = (px, py, power, radius) => {
        const gx = Math.round(px / CELL);
        const gy = Math.round(py / CELL);
        const r = radius || 2;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const d = Math.hypot(dx, dy);
            if (d > r) continue;
            const x = gx + dx, y = gy + dy;
            if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
            cur[y * W + x] -= power * (1 - d / (r + 0.001));
          }
        }
      };

      // Spray. `h` is height above the surface, so a droplet is drawn at
      // (x, y - h) and lands — ringing the water — when h comes back to 0.
      let drops = [];
      const MAX_DROPS = 220;
      const rand = (a, d) => a + Math.random() * (d - a);

      const jet = (x, y, strength) => {
        poke(x, y, 13 * strength, 3);
        const n = Math.round(rand(5, 9) * strength);
        for (let i = 0; i < n; i++) {
          drops.push({
            x, y,
            vx: rand(-46, 46) * strength,
            vy: rand(-16, 16),
            h: 0,
            vh: rand(120, 260) * strength,
            r: rand(0.9, 2.2)
          });
        }
        if (drops.length > MAX_DROPS) drops.splice(0, drops.length - MAX_DROPS);
      };

      let lastKey = 0;
      const onKey = (e) => {
        if (!e.key) return;
        const now = performance.now();
        if (now - lastKey < 28) return;
        lastKey = now;
        const p = caretRect();
        if (!p) return;
        if (e.key === 'Enter') {
          // A whole line finished: the basin takes it across, not at a point.
          for (let i = 0; i < 7; i++) {
            jet(p.x + (i - 3) * 34, p.y, 0.55);
          }
        } else if (e.key === ' ') {
          jet(p.x, p.y, 1.5);
        } else if (e.key.length === 1 || e.key === 'Backspace') {
          jet(p.x, p.y, 1);
        }
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // Onyx water lit from above, with the basin's gold rim caught in the
      // slopes. Two colours only — the metal and the water — because a third
      // stops it reading as one material.
      const BASE = [10, 20, 26];
      const GOLD = [214, 170, 92];
      const FOAM = [206, 226, 232];

      // A fed basin is never perfectly still. One faint drip every second or so
      // keeps the surface alive while nobody is typing, without ever competing
      // with what a keystroke does.
      let nextDrip = 0;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        if (now >= nextDrip) {
          nextDrip = now + rand(900, 2100);
          poke(rand(0.1, 0.9) * window.innerWidth, rand(0.1, 0.9) * window.innerHeight, 2.6, 2);
        }

        // ---- water: one relaxation pass, then swap the buffers
        for (let y = 1; y < H - 1; y++) {
          const row = y * W;
          for (let x = 1; x < W - 1; x++) {
            const i = row + x;
            prev[i] = ((cur[i - 1] + cur[i + 1] + cur[i - W] + cur[i + W]) * 0.5 - prev[i]) * DAMP;
          }
        }
        const swap = prev; prev = cur; cur = swap;

        // ---- shade it from the slope, which is what you actually see on
        // water: the height itself is invisible, the tilt catches the light.
        const d = img.data;
        for (let y = 1; y < H - 1; y++) {
          const row = y * W;
          // The basin is lit from above, so flat water is a shade brighter at
          // the top of the window than at the bottom. Without it the still
          // parts are flat black and the whole thing reads as a screen with a
          // ripple drawn on it rather than as a body of water.
          const sheen = 1 + (1 - y / H) * 0.85;
          const b0 = BASE[0] * sheen, b1 = BASE[1] * sheen, b2 = BASE[2] * sheen;
          for (let x = 1; x < W - 1; x++) {
            const i = row + x;
            const sx = cur[i - 1] - cur[i + 1];
            const sy = cur[i - W] - cur[i + W];
            const lit = (sx + sy) * 0.24;
            const p = i * 4;
            // Squared, so gentle slopes stay near-black and only the crest of
            // a ripple picks up the rim. Linear made the whole basin gold the
            // moment anything moved, which reads as amber, not water.
            const m = Math.min(1, Math.abs(lit));
            const k = m * m * 1.5;
            const g = lit > 0 ? Math.min(1, k) : 0;
            const f = lit < 0 ? Math.min(1, k) * 0.5 : 0;
            d[p]     = b0 + (GOLD[0] - b0) * g + (FOAM[0] - b0) * f;
            d[p + 1] = b1 + (GOLD[1] - b1) * g + (FOAM[1] - b1) * f;
            d[p + 2] = b2 + (GOLD[2] - b2) * g + (FOAM[2] - b2) * f;
          }
        }
        c.ctx.putImageData(img, 0, 0);

        // ---- spray
        if (spray) {
          const sc = spray.ctx;
          sc.clearRect(0, 0, spray.w, spray.h);
          for (const p of drops) {
            p.vh -= 620 * dt;              // gravity, in height rather than y
            p.h += p.vh * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.h <= 0) { p.dead = true; poke(p.x, p.y, 4.5, 2); continue; }
            // Higher droplets are further from the camera and catch more of
            // the light — the only depth cue a top-down view can give.
            const a = Math.max(0, Math.min(1, 0.35 + p.h / 90));
            sc.fillStyle = 'rgba(226,238,242,' + a.toFixed(3) + ')';
            sc.beginPath();
            sc.arc(p.x, p.y - p.h, p.r, 0, Math.PI * 2);
            sc.fill();
          }
          drops = drops.filter((p) => !p.dead && p.x > -20 && p.x < spray.w + 20);
        }

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Sandbox — the first theme you can put your hand into.
  //
  // Every character you type drops a few grains from the caret. They fall,
  // pile up against the bottom of the window, and stay there; run the mouse
  // through the heap and it parts and slumps back the way sand does.
  //
  // The interaction costs nothing structurally: the canvas stays
  // pointer-events:none like every other effect layer, and the cursor is read
  // from a document-level mousemove. Making the layer itself clickable would
  // have put a sheet of glass over the editor.
  //
  // Classic falling-sand cellular automaton on a coarse grid — scanned bottom
  // row first, so a grain moves at most one cell per step and a column
  // collapses over several frames instead of teleporting to the floor.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.sandbox = {
    start() {
      // Behind the app, not over it. Sand drawn on top buries the note you are
      // writing, which is charming for about ten seconds and then it is a
      // notepad you cannot read. The panels are translucent instead, so the
      // heap builds up visibly under the glass.
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-sandbox-canvas');

      const CELL = 4;
      let W = 0, H = 0;
      let grid = null;      // 0 = air, otherwise 1..SHADES (which grain colour)
      let img = null;
      const SHADES = 5;

      // Warm quartz, five tones. A heap in one flat colour reads as a shape;
      // the variation is what makes it read as a material made of grains.
      const PALETTE = [
        [214, 178, 116], [198, 160, 100], [226, 196, 140],
        [176, 140, 86], [236, 214, 170]
      ];

      const build = () => {
        W = Math.max(8, Math.ceil(window.innerWidth / CELL));
        H = Math.max(8, Math.ceil(window.innerHeight / CELL));
        const old = grid;
        const oldW = c.canvas.width, oldH = c.canvas.height;
        grid = new Uint8Array(W * H);
        // Carry the heap through a resize rather than emptying the window —
        // a pile you built disappearing because you dragged the corner is
        // the sort of thing that makes an effect feel like a screensaver.
        if (old && oldW && oldH) {
          const cw = Math.min(W, oldW), ch = Math.min(H, oldH);
          for (let y = 0; y < ch; y++) {
            const from = (oldH - ch + y) * oldW;
            const to = (H - ch + y) * W;
            for (let x = 0; x < cw; x++) grid[to + x] = old[from + x];
          }
        }
        else seedBed();
        c.canvas.width = W;
        c.canvas.height = H;
        c.ctx.setTransform(1, 0, 0, 1, 0, 0);
        img = c.ctx.createImageData(W, H);
      };

      // A shallow bed along the bottom, laid down once when the theme starts.
      // Without it the window opens empty and there is nothing to put your
      // hand into until you have typed a paragraph — which is most of the
      // theme, withheld until you have earned it.
      const seedBed = () => {
        // Deep enough to clear the status bar — a bed that sits entirely
        // behind the toolbar is a bed nobody ever sees.
        const base = Math.max(5, Math.round(H * 0.12));
        for (let x = 0; x < W; x++) {
          // A drifted top edge rather than a ruled line: a flat surface reads
          // as a floor, an uneven one reads as sand that has settled.
          const dune = base + Math.round(
            Math.sin(x * 0.045) * 2.2 + Math.sin(x * 0.011 + 1.7) * 3.4);
          for (let k = 0; k < Math.max(1, dune); k++) {
            const y = H - 1 - k;
            if (y < 0) break;
            grid[y * W + x] = 1 + Math.floor(Math.random() * SHADES);
          }
        }
      };

      const resize = () => { c.w = window.innerWidth; c.h = window.innerHeight; build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);

      const spill = (px, py, n) => {
        const gx = Math.round(px / CELL);
        const gy = Math.round(py / CELL);
        for (let i = 0; i < n; i++) {
          const x = gx + Math.round(rand(-2, 2));
          const y = gy + Math.round(rand(-1, 1));
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i2 = y * W + x;
          if (!grid[i2]) grid[i2] = 1 + Math.floor(Math.random() * SHADES);
        }
      };

      let lastKey = 0;
      const onKey = (e) => {
        if (!e.key) return;
        const now = performance.now();
        if (now - lastKey < 25) return;
        lastKey = now;
        const p = caretRect();
        if (!p) return;
        if (e.key === 'Enter') spill(p.x, p.bottom, 26);
        else if (e.key === ' ') spill(p.x, p.bottom, 12);
        else if (e.key.length === 1) spill(p.x, p.bottom, 7);
        else if (e.key === 'Backspace') spill(p.x, p.bottom, 3);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // The hand. Only the last position and the direction of travel matter —
      // sand is pushed by a moving finger, not held by a resting one.
      let mx = -1, my = -1, mdx = 0, mdy = 0, moved = false;
      const onMove = (e) => {
        if (mx >= 0) { mdx = e.clientX - mx; mdy = e.clientY - my; }
        mx = e.clientX; my = e.clientY;
        moved = true;
      };
      document.addEventListener('mousemove', onMove, true);
      this._onMove = onMove;

      // Shove every grain inside the cursor out of the way, along the
      // direction the mouse is travelling. Grains that have nowhere to go stay
      // put and get pushed on the next pass, which is what makes a heap slump
      // rather than vanish.
      const PUSH_R = 5;
      const plough = () => {
        if (!moved || mx < 0) return;
        moved = false;
        const speed = Math.hypot(mdx, mdy);
        if (speed < 1) return;
        const ux = mdx / speed, uy = mdy / speed;
        const reach = Math.max(1, Math.min(6, Math.round(speed / CELL)));
        const gx = Math.round(mx / CELL), gy = Math.round(my / CELL);
        for (let dy = -PUSH_R; dy <= PUSH_R; dy++) {
          for (let dx = -PUSH_R; dx <= PUSH_R; dx++) {
            if (dx * dx + dy * dy > PUSH_R * PUSH_R) continue;
            const x = gx + dx, y = gy + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const i = y * W + x;
            const v = grid[i];
            if (!v) continue;
            const tx = x + Math.round(ux * reach);
            const ty = y + Math.round(uy * reach);
            if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
            const j = ty * W + tx;
            if (grid[j]) continue;
            grid[j] = v;
            grid[i] = 0;
          }
        }
      };

      // One settling step. Bottom row upward, and each row alternates which
      // side it tries first — scanning one direction every time builds a
      // visible lean in the heap.
      const settle = () => {
        for (let y = H - 2; y >= 0; y--) {
          const flip = (y & 1) === 0;
          for (let k = 0; k < W; k++) {
            const x = flip ? k : W - 1 - k;
            const i = y * W + x;
            const v = grid[i];
            if (!v) continue;
            const below = i + W;
            if (!grid[below]) { grid[below] = v; grid[i] = 0; continue; }
            const first = Math.random() < 0.5 ? -1 : 1;
            for (const s of [first, -first]) {
              const nx = x + s;
              if (nx < 0 || nx >= W) continue;
              const d = below + s;
              if (!grid[d] && !grid[i + s]) { grid[d] = v; grid[i] = 0; break; }
            }
          }
        }
      };

      // The sim runs at 30Hz. Sand settling at 60 looks like it is draining;
      // at 30 it looks like it is pouring.
      let nextStep = 0;
      const tick = (now) => {
        if (now >= nextStep) {
          nextStep = now + 33;
          plough();
          settle();

          const d = img.data;
          for (let i = 0, p = 0; i < grid.length; i++, p += 4) {
            const v = grid[i];
            if (!v) { d[p + 3] = 0; continue; }
            const col = PALETTE[v - 1];
            d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255;
          }
          c.ctx.putImageData(img, 0, 0);
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._onMove) document.removeEventListener('mousemove', this._onMove, true);
      this._resize = null;
      this._onKey = null;
      this._onMove = null;
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Almanac — the theme reads the calendar off the machine and dresses the
  // window for the day it actually is. Blossom drifts through the spring,
  // heat shimmers over the summer, leaves come down in the autumn and it
  // snows in the winter; on a handful of days in the year it drops the season
  // and marks the day instead.
  //
  // Everything here is offline. A weather theme was the obvious version of
  // this idea and was not built: it needs the user's location and a network
  // call to show them something they can see by looking out of a window. The
  // calendar is the part a notepad can actually tell you.
  //
  // The season is re-read every few minutes rather than only at startup: this
  // is a window people leave open for days, and the one night of the year
  // Yalda arrives, it should arrive.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.almanac = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-almanac-canvas');
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);

      // Each season names its own falling thing and the two colours the room
      // takes. `accent` is written onto the theme so the chrome agrees with
      // the weather rather than sitting outside it.
      const SEASONS = {
        spring: { fall: 'petal', tint: [255, 214, 226], accent: '#f0a8c0', drift: 26, rate: 0.55 },
        summer: { fall: 'mote', tint: [255, 236, 176], accent: '#e8c060', drift: 8, rate: 0.30 },
        autumn: { fall: 'leaf', tint: [230, 150, 70], accent: '#d98a44', drift: 34, rate: 0.50 },
        winter: { fall: 'snow', tint: [226, 238, 250], accent: '#9fc4e8', drift: 14, rate: 0.95 },
        // Yalda: the longest night, marked with pomegranate rather than snow.
        yalda: { fall: 'seed', tint: [214, 56, 66], accent: '#d64252', drift: 6, rate: 0.7 },
        // Nowruz: the first day of spring, and the sprouting green that goes
        // with it — brighter and busier than the ordinary spring it displaces.
        nowruz: { fall: 'petal', tint: [150, 226, 150], accent: '#6ecf7a', drift: 30, rate: 1.1 }
      };

      // Which season it is, by the real date. Northern hemisphere, because
      // the two named days this also knows about are northern ones.
      const seasonNow = () => {
        const d = new Date();
        const m = d.getMonth() + 1, day = d.getDate();
        // Nowruz and Yalda take the day outright — they are the point of
        // knowing the date rather than just the month.
        if (m === 3 && (day === 20 || day === 21)) return 'nowruz';
        if (m === 12 && (day === 20 || day === 21)) return 'yalda';
        if (m === 3 || m === 4 || m === 5) return 'spring';
        if (m === 6 || m === 7 || m === 8) return 'summer';
        if (m === 9 || m === 10 || m === 11) return 'autumn';
        return 'winter';
      };

      let key = seasonNow();
      let S = SEASONS[key];
      let bits = [];

      const spawn = (atTop) => {
        const x = Math.random() * c.w;
        const y = atTop ? -10 : Math.random() * c.h;
        bits.push({
          x, y,
          vy: rand(14, 44) * (S.fall === 'snow' ? 0.7 : 1),
          phase: rand(0, Math.PI * 2),
          spin: rand(-2.4, 2.4),
          rot: rand(0, Math.PI * 2),
          r: rand(1.6, 4.2),
          a: rand(0.28, 0.72)
        });
      };

      const restock = (fill) => {
        const want = Math.round((c.w * c.h) / 26000 * S.rate * 10);
        while (bits.length < want) spawn(!fill);
        if (bits.length > want) bits.length = want;
      };
      restock(true);

      // Push the season's accent onto the app itself. Nothing is saved to put
      // back: applyTheme() writes the incoming theme's accent and only *then*
      // stops the outgoing runtime, so a restore here would land after the new
      // accent and paint the next theme in this one's autumn.
      const root = document.documentElement;
      const dressUp = () => root.style.setProperty('--accent', S.accent);
      dressUp();

      // Re-read the calendar every five minutes. Cheap, and it means the app
      // does not have to be restarted on the one evening a year that matters.
      const recheck = setInterval(() => {
        const next = seasonNow();
        if (next === key) return;
        key = next;
        S = SEASONS[key];
        bits = [];
        restock(true);
        dressUp();
      }, 300000);
      this._recheck = recheck;

      const drawLeaf = (ctx, p) => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 1.9, p.r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);

        const t = now / 1000;
        for (const p of bits) {
          p.y += p.vy * dt;
          // Side-to-side is what separates a falling leaf from a falling
          // pixel; snow gets the least of it, leaves the most.
          p.x += Math.sin(t * 0.9 + p.phase) * S.drift * dt;
          p.rot += p.spin * dt;
          if (p.y > c.h + 12) {
            p.y = -10;
            p.x = Math.random() * c.w;
          }
          ctx.fillStyle = 'rgba(' + S.tint[0] + ',' + S.tint[1] + ',' + S.tint[2] + ',' + p.a.toFixed(3) + ')';
          if (S.fall === 'leaf' || S.fall === 'petal') {
            drawLeaf(ctx, p);
          } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, S.fall === 'mote' ? p.r * 0.5 : p.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._recheck) clearInterval(this._recheck);
      this._resize = null;
      this._recheck = null;
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Mechanical — the first theme you hear rather than watch.
  //
  // Every key is a switch: a filtered noise clack for the stem and a low
  // thock for the cap meeting the plate, with the pitch and level jittered per
  // press. Space and Enter get the deeper, rattlier sound their stabilised
  // keys actually make, and the release is its own quieter click a beat later
  // — leaving it out is what makes synthesised typing sound like a toy.
  //
  // The picture is deliberately almost nothing: a keycap outline blinking at
  // the caret. Anything more and the sound stops being the theme.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.mechanical = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-mechanical-canvas');
      countKeySamples();
      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);
      let caps = [];

      const strike = (heavy) => {
        // A recording first, if there is one in src/sounds/. A real switch is
        // a specific piece of plastic on a specific desk and synthesis only
        // ever gets close to it.
        if (playKeySample(heavy === 'space' ? 'space' : (heavy === 'enter' ? 'enter' : 'key'),
          heavy ? 0.9 : 0.75)) return;
        // Jitter, because two presses of the same switch are never identical
        // and the ear picks that up long before the eye picks up a repeated
        // animation.
        const j = rand(0.88, 1.14);
        if (heavy === 'space') {
          click(1500 * j, 5, 0.16, 0.028);
          thock(96 * j, 0.16, 0.075);
        } else if (heavy === 'enter') {
          click(1250 * j, 4, 0.19, 0.034);
          thock(78 * j, 0.2, 0.095);
        } else {
          click(2400 * j, 7, 0.12, 0.018);
          thock(150 * j, 0.09, 0.045);
        }
      };

      // The switch coming back up. Quieter, brighter, and late by roughly how
      // long a finger stays down.
      const release = () => {
        setTimeout(() => click(rand(3000, 3800), 9, 0.045, 0.012), rand(45, 85));
      };

      const onKey = (e) => {
        if (e.repeat) return;
        if (!e.key) return;
        const printable = e.key.length === 1;
        if (!printable && e.key !== 'Enter' && e.key !== 'Backspace' && e.key !== 'Tab') return;
        strike(e.key === ' ' ? 'space' : (e.key === 'Enter' ? 'enter' : null));
        release();
        const p = caretRect();
        if (p) caps.push({ x: p.x, y: p.y, life: 1, w: e.key === ' ' ? 46 : 16 });
        if (caps.length > 14) caps.shift();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);
        for (const k of caps) {
          k.life -= dt * 3.4;
          if (k.life <= 0) continue;
          const a = k.life * 0.5;
          // The cap grows a little as it fades, so a fast typist gets a
          // widening stack rather than one square flickering in place.
          const w = k.w * (1 + (1 - k.life) * 0.5);
          const h = 15 * (1 + (1 - k.life) * 0.5);
          ctx.strokeStyle = 'rgba(226,214,190,' + a.toFixed(3) + ')';
          ctx.lineWidth = 1;
          const r = 3;
          const x = k.x - w / 2, y = k.y - h / 2;
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
          ctx.stroke();
        }
        caps = caps.filter((k) => k.life > 0);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
      closeAudio();
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Nostalgia — a snow level on a 32-bit console.
  //
  // The look is not "snow with a filter on it"; it is a list of the specific
  // things that made 1997 hardware look the way it did, done deliberately:
  //
  //   · the whole scene renders at a fifth of the window and is scaled up with
  //     nearest-neighbour, so a pixel is a visible square
  //   · the sky is quantised to six colours and ordered-dithered with a 4x4
  //     Bayer matrix — the crosshatch in every PS1 gradient is this, and it is
  //     the single most recognisable part of the era
  //   · everything moves on whole pixels only. The console had no sub-pixel
  //     precision, which is where the characteristic shimmer came from
  //   · it runs at 15fps. Smooth snow reads as modern no matter how blocky
  //     the pixels are
  //
  // Typing throws up a flurry, so it is not purely wallpaper.


  // ────────────────────────────────────────────────────────────────────────
  // Typewriter — the other sound theme, and deliberately a different machine
  // from Mechanical. A switch clicks; a typebar *strikes*, through a ribbon,
  // onto a rubber platen. So this one is brighter and shorter at the top end
  // with a wooden thump under it, the bell rings as the line runs out, and
  // Enter throws the carriage back across.
  //
  // The bell is the part people remember, and it only works if it is rare:
  // it rings once per line, near the end, not on a timer.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.typewriter = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-typewriter-canvas');
      countKeySamples();
      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);
      let strikes = [];
      let belled = false;      // one ring per line

      // A single struck note, for the bell. Two partials is enough to read as
      // metal rather than as a beep.
      const ring = () => {
        const ctx = audio();
        if (!ctx || volume <= 0) return;
        const now = ctx.currentTime;
        [1, 2.76].forEach((mult, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 1180 * mult * rand(0.99, 1.01);
          const g = ctx.createGain();
          g.gain.setValueAtTime(i ? 0.05 : 0.09, now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + (i ? 0.6 : 1.1));
          osc.connect(g); g.connect(masterGain);
          osc.start(now);
          osc.stop(now + 1.2);
        });
      };

      // The carriage coming back: a rattle that sweeps rather than a hit.
      const carriage = () => {
        for (let i = 0; i < 9; i++) {
          setTimeout(() => click(rand(1700, 2600), 6, 0.06, 0.014), i * 26);
        }
        setTimeout(() => thock(70, 0.14, 0.09), 250);
      };

      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        if (e.key === 'Enter') {
          belled = false;
          if (!playKeySample('enter', 0.9)) carriage();
        } else if (e.key === 'Backspace') {
          if (playKeySample('back', 0.7)) return;
          click(rand(2200, 2800), 8, 0.05, 0.012);
        } else if (e.key.length === 1) {
          if (playKeySample('key', 0.85)) {
            // The bell and the ink still belong to the theme even when the
            // strike itself is a recording.
            const p2 = caretRect();
            if (p2 && !belled && p2.x > window.innerWidth * 0.72) { belled = true; ring(); }
            if (p2 && p2.x < window.innerWidth * 0.4) belled = false;
            if (p2) strikes.push({ x: p2.x, y: p2.bottom, life: 1 });
            if (strikes.length > 20) strikes.shift();
            return;
          }
          const j = rand(0.9, 1.12);
          click(3100 * j, 9, 0.13, 0.014);   // the typebar hitting the ribbon
          thock(210 * j, 0.07, 0.032);       // the platen taking it
          // The bell warns you the line is running out. Measured off the caret
          // rather than a character count, because the window can be any width
          // and it is the margin the bell is about.
          const p = caretRect();
          if (p && !belled && p.x > window.innerWidth * 0.72) { belled = true; ring(); }
          if (p && p.x < window.innerWidth * 0.4) belled = false;
          if (p) strikes.push({ x: p.x, y: p.bottom, life: 1 });
          if (strikes.length > 20) strikes.shift();
        }
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // The only thing drawn: the ink still wet under the last few letters.
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);
        for (const s of strikes) {
          s.life -= dt * 1.6;
          if (s.life <= 0) continue;
          ctx.fillStyle = 'rgba(58,44,36,' + (s.life * 0.30).toFixed(3) + ')';
          ctx.fillRect(s.x - 4, s.y - 1, 8, 1.5);
        }
        strikes = strikes.filter((s) => s.life > 0);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null;
      this._onKey = null;
      closeAudio();
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Moon — the actual phase, tonight.
  //
  // Computed from the machine's own date against a known new moon, so the
  // shape in the corner is the shape in the sky, and it is a different shape
  // three days from now. Nothing here is on a loop: leave the app open for a
  // fortnight and the moon fills out.
  //
  // The light level follows the phase too — a new moon is genuinely darker to
  // write against than a full one, which is the whole idea.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.moon = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-moon-canvas');
      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);

      // Synodic month against the new moon of 6 Jan 2000, 18:14 UTC. Good to
      // a few hours over a century, which is rather more than a wallpaper
      // needs.
      const phase = () => {
        const SYNODIC = 29.530588853;
        const known = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
        const now = Date.now() / 86400000;
        return ((now - known) % SYNODIC + SYNODIC) % SYNODIC / SYNODIC;  // 0..1
      };

      let stars = Array.from({ length: 90 }, () => ({
        x: Math.random(), y: Math.random() * 0.8,
        r: rand(0.4, 1.5), phase: rand(0, Math.PI * 2), speed: rand(0.5, 1.6)
      }));

      let p = phase();
      // Re-read hourly. The shape does not change fast, but a window left open
      // over a weekend should not still be showing Friday's moon.
      this._recheck = setInterval(() => { p = phase(); }, 3600000);

      const tick = (now) => {
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);
        const t = now / 1000;

        // How much of the disc is actually lit. Cosine, not a linear ramp: a
        // quarter of the way through the month only ~15% of the face is lit,
        // and using the ramp made every crescent look like a half moon.
        const lit = (1 - Math.cos(p * Math.PI * 2)) / 2;

        for (const s of stars) {
          // Stars wash out under a full moon, the way they actually do.
          const a = (0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase)))
            * (1 - lit * 0.45);
          ctx.fillStyle = 'rgba(214,226,248,' + a.toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(s.x * c.w, s.y * c.h, s.r, 0, Math.PI * 2);
          ctx.fill();
        }

        // The disc, high on the right.
        // Sized off the height and placed left of the side panel, so it is not
        // permanently hiding behind the placeholder bar.
        const R = Math.max(30, Math.min(c.w, c.h) * 0.15);
        const cx = c.w * 0.62, cy = c.h * 0.21;

        // Glow first, scaled by how much moon there is to glow.
        if (lit > 0.02) {
          const g = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 4.2);
          g.addColorStop(0, 'rgba(224,236,255,' + (0.16 * lit).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(224,236,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, R * 4.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // The dark disc is always drawn — an unlit moon is still a hole in
        // the stars, and leaving it out makes a new moon look like a bug.
        ctx.fillStyle = 'rgba(26,32,50,0.85)';
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();

        // The lit part: the lit limb as a half-circle, then the terminator
        // back across it as an ellipse whose width is |cos(phase)|. The
        // ellipse is what makes a crescent a crescent rather than a bitten
        // circle, and its sweep flag is what decides crescent from gibbous.
        // Verified by measuring the lit pixels at eight phases — see
        // tools/probe-moon.js; getting the flag backwards still draws a
        // perfectly convincing moon, just the wrong one.
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(238,244,255,0.94)';
        const k = Math.cos(p * Math.PI * 2);      // +1 at new, -1 at full
        ctx.beginPath();
        if (p < 0.5) {                            // waxing — lit on the right
          ctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2, false);
          ctx.ellipse(cx, cy, R * Math.abs(k), R, 0, Math.PI / 2, -Math.PI / 2, k > 0);
        } else {                                  // waning — lit on the left
          ctx.arc(cx, cy, R, Math.PI / 2, -Math.PI / 2, false);
          ctx.ellipse(cx, cy, R * Math.abs(k), R, 0, -Math.PI / 2, Math.PI / 2, k > 0);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._recheck) clearInterval(this._recheck);
      this._resize = null;
      this._recheck = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Bubbles — the second theme you can put your hand into.
  //
  // They rise from the bottom on their own and from the caret as you type.
  // Run the cursor through one and it pops, with the little ring a real
  // bubble leaves. No clicking: the editor needs the clicks, and a bubble
  // that pops on contact is the more satisfying of the two anyway.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.bubbles = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-bubbles-canvas');
      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);
      let bubbles = [];
      let pops = [];
      const MAX = 90;

      const spawn = (x, y, r) => {
        if (bubbles.length >= MAX) bubbles.shift();
        bubbles.push({
          x, y,
          r: r || rand(4, 15),
          vy: -rand(14, 44),
          sway: rand(6, 22),
          phase: rand(0, Math.PI * 2),
          wobble: rand(0.9, 1.9)
        });
      };

      let nextRise = 0;
      let lastKey = 0;
      const onKey = (e) => {
        if (!e.key || e.key.length !== 1) return;
        const now = performance.now();
        if (now - lastKey < 55) return;
        lastKey = now;
        const p = caretRect();
        if (p) spawn(p.x + rand(-6, 6), p.bottom, rand(3, 9));
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let mx = -999, my = -999;
      const onMove = (e) => { mx = e.clientX; my = e.clientY; };
      document.addEventListener('mousemove', onMove, true);
      this._onMove = onMove;

      const pop = (bb) => {
        pops.push({ x: bb.x, y: bb.y, r: bb.r, life: 1 });
        if (pops.length > 30) pops.shift();
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        if (now >= nextRise) {
          nextRise = now + rand(160, 520);
          spawn(rand(0, c.w), c.h + 12);
        }

        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);

        for (const bb of bubbles) {
          bb.y += bb.vy * dt;
          bb.x += Math.sin(now / 1000 * bb.wobble + bb.phase) * bb.sway * dt;
          // The hand. A generous radius, because a bubble you have to hit
          // exactly is not a toy, it is a test.
          if (Math.hypot(bb.x - mx, bb.y - my) < bb.r + 8) { bb.dead = true; pop(bb); continue; }
          if (bb.y < -20) { bb.dead = true; continue; }

          // A rim and one highlight — that is all a bubble is. A filled circle
          // reads as a ball.
          ctx.strokeStyle = 'rgba(190,226,240,0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(bb.x, bb.y, bb.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(226,244,255,0.16)';
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(bb.x - bb.r * 0.34, bb.y - bb.r * 0.36, Math.max(0.8, bb.r * 0.17), 0, Math.PI * 2);
          ctx.fill();
        }
        bubbles = bubbles.filter((bb) => !bb.dead);

        for (const pp of pops) {
          pp.life -= dt * 3.2;
          if (pp.life <= 0) continue;
          ctx.strokeStyle = 'rgba(214,240,252,' + (pp.life * 0.6).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, pp.r * (1 + (1 - pp.life) * 1.6), 0, Math.PI * 2);
          ctx.stroke();
        }
        pops = pops.filter((pp) => pp.life > 0);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._onMove) document.removeEventListener('mousemove', this._onMove, true);
      this._resize = null;
      this._onKey = null;
      this._onMove = null;
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Murmuration — a flock of starlings over the window at dusk.
  //
  // Nothing in the set does emergent behaviour, and this is the cheapest
  // beautiful example of it. Three rules per bird and no choreography at all:
  //
  //   separation  steer away from anyone too close
  //   alignment   match the heading of your neighbours
  //   cohesion    drift toward where your neighbours are
  //
  // Nobody is in charge and there is no path — the shape you watch is what
  // falls out of two hundred birds each minding only the dozen nearest them.
  //
  // Your typing is the weather: while you write the flock draws in and turns
  // tightly, and when you stop it loosens and spreads out across the sky. So
  // the shape of the last few minutes of your work is on the glass.

  // ────────────────────────────────────────────────────────────────────────
  // Foundry — molten metal, poured by typing and set by cooling.
  //
  // The other two Playable themes move things around; this one changes what
  // things *are*. Every cell carries a temperature. Above the melting point it
  // is liquid and it flows; below, it has set and it stays where it froze.
  // So the shape at the bottom of the window is a cast of how you typed —
  // a fast run pours a long ridge, a pause leaves a lump.
  //
  // Drag the cursor through it and you are the torch: cells under it heat up,
  // pass the melting point, and start running again. Cooling is what makes the
  // heat mean something.


  // ────────────────────────────────────────────────────────────────────────
  // Nostalgia — a snowy street at night, on 1997 hardware.
  //
  // Three planes, which is what makes it a place rather than an effect: a
  // dithered skyline with lit windows at the back, a street with a lamp in the
  // middle, and an oil drum burning in front of you. Snow falls through all of
  // them and settles on every horizontal surface.
  //
  // Typing feeds the fire. The flames climb, the light on the snow and the
  // drum climbs with them, and it dies back down when you stop — so the room
  // is brighter while you are working.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.nostalgia = {
    start() {
      const b = back();
      if (!b) return;
      const R = makeRetro(b, 5);

      // A city sky is never black — it is lit from underneath by the place
      // itself, and the top band being the darkest is what makes the horizon
      // glow read as a city rather than as a sunrise.
      const SKY = [[10, 11, 28], [18, 21, 48], [28, 34, 72], [44, 52, 100], [70, 74, 126]];
      const BUILDING = [10, 11, 26];
      const BUILDING2 = [16, 18, 36];
      const WINDOW = [244, 216, 132];
      const WINDOW_DIM = [128, 112, 92];
      const ROAD = [26, 26, 34];
      const SNOW = [226, 234, 250];
      const SNOW_LIT = [255, 236, 196];
      const DRUM = [58, 44, 38];
      const DRUM_HI = [96, 74, 62];
      const FLAME = [[255, 246, 200], [255, 196, 78], [244, 122, 30], [176, 52, 18]];
      const LAMP = [255, 226, 150];

      let horizon = 0, drift = null, flakes = [], fire = [], flame = [];
      let blaze = 0.45;               // 0..1, how hard the drum is burning
      // Declared up here so resize can reach them: resizing the canvas blanks
      // it, and at fifteen frames a second the scene would otherwise be gone
      // for up to seventy milliseconds after every resize event — which during
      // a window drag is the flicker.
      let t = 0;
      let nextFrame = 0;

      // Rebuilding keeps the scene going rather than starting it again.
      //
      // Dragging a window edge fires resize continuously, and this used to
      // throw away the snow and the fire on every one of those events — so a
      // slow drag looked like the scene restarting forty times over. What
      // carries across now: the flakes and the flame keep their positions,
      // scaled into the new grid, and only what is genuinely a function of the
      // size (the drift, the horizon) is recomputed.
      const build = (prevW, prevH) => {
        horizon = Math.round(R.H * 0.46);
        drift = new Uint16Array(R.W);
        // Deep enough to clear the status bar and read as lying snow rather
        // than a line at the bottom of the window.
        const base = Math.max(4, Math.round(R.H * 0.075));
        for (let x = 0; x < R.W; x++) {
          drift[x] = base + Math.round(Math.sin(x * 0.05) * 1.8 + Math.sin(x * 0.014 + 2) * 2.6);
        }
        if (prevW && prevH && prevW !== R.W) {
          const sx = R.W / prevW, sy = R.H / prevH;
          for (const f of flakes) { f.x *= sx; f.y *= sy; }
          for (const f of flame) { f.x *= sx; f.y *= sy; }
        }
        const want = Math.round((R.W * R.H) / 150);
        while (flakes.length < want) {
          flakes.push({
            x: Math.random() * R.W, y: Math.random() * R.H,
            // Slow. At fifteen frames a second every flake moves in whole
            // pixels, so anything above about a fifth of a cell per frame
            // reads as a jump rather than a fall — it was landing like sleet.
            v: 0.05 + Math.random() * 0.14, ph: Math.random() * 6.28
          });
        }
        if (flakes.length > want) flakes.length = want;
      };
      const resize = () => {
        const pw = R.W, phh = R.H;
        R.resize();
        build(pw, phh);
        nextFrame = 0;      // repaint on the very next frame, not in 66ms
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== ' ')) return;
        blaze = Math.min(1, blaze + (e.key === 'Enter' ? 0.16 : 0.07));
        // Sparks off the top of the drum when it is fed.
        for (let i = 0; i < 3; i++) {
          fire.push({
            x: (R.W * 0.5) + (Math.random() - 0.5) * 5, y: 0, life: 1,
            vx: (Math.random() - 0.5) * 0.16
          });
        }
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / 15;      // console framerate, deliberately
        t++;
        blaze = Math.max(0.32, blaze - 0.012);

        const W = R.W, H = R.H;
        const drumW = Math.max(11, Math.round(W * 0.07));
        const drumH = Math.max(14, Math.round(H * 0.16));
        const drumX = Math.round(W * 0.5 - drumW / 2);
        const drumY = H - drift[Math.min(W - 1, Math.round(W * 0.5))] - drumH - 1;
        const fireY = drumY - 1;

        // ---- sky
        R.vgrad(0, horizon, SKY, 1.5);

        // ---- stars, only where the sky is dark enough to hold them
        for (let i = 0; i < 70; i++) {
          const sx = Math.floor(R.hash(i, 1) * W);
          const sy = Math.floor(R.hash(i, 2) * horizon * 0.55);
          if (((t >> 2) + i) % 7 === 0) continue;   // a coarse twinkle
          R.px(sx, sy, [180, 190, 220]);
        }

        // A window with the light on spills onto the wall around it, exactly
        // the way the streetlamp does — that halo is the difference between a
        // light *source* and a yellow rectangle painted on a building. Dropped
        // off with distance and squashed vertically, because a window is
        // taller than it is wide and so is its glow.
        const litWindow = (wx, wy, col, strength) => {
          for (let dy = -2; dy <= 3; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && (dy === 0 || dy === 1)) continue;   // the opening
              const d = Math.hypot(dx * 1.35, (dy - 0.5) * 0.75);
              const f = 1 - d / 2.9;
              if (f > 0) R.blend(wx + dx, wy + dy, col, f * f * 0.34 * strength);
            }
          }
          R.rect(wx, wy, 1, 2, col);
        };

        // ---- skyline. Two ranks: a pale far one and a darker near one, which
        // is the cheapest depth there is and reads instantly as a city.
        for (const rank of [0, 1]) {
          const col = rank ? BUILDING : BUILDING2;
          const base = horizon - (rank ? 0 : Math.round(H * 0.03));
          let x = rank ? 0 : -3;
          let seed = rank ? 11 : 29;
          while (x < W) {
            const bw = 3 + Math.floor(R.hash(seed, rank) * 7);
            const bh = Math.round(H * (rank ? 0.09 : 0.07) * (0.5 + R.hash(seed, rank + 5) * 1.9));
            R.rect(x, base - bh, bw, bh + 2, col);
            // Lit windows, on a grid, a few of them on.
            if (rank) {
              for (let wy = base - bh + 2; wy < base - 1; wy += 3) {
                for (let wx = x + 1; wx < x + bw - 1; wx += 2) {
                  const h2 = R.hash(wx * 7, wy * 13);
                  // Sparse. Half the windows lit is an office block at nine in
                  // the morning; a city at night is mostly dark with lights
                  // scattered through it, and the scattering is what makes it
                  // read as a place where people live.
                  // A lit window is a rectangle, not a dot. The grid steps
                  // two across and three down, so 1x2 leaves a frame of wall
                  // around each one — and a rectangle of light is what says
                  // somebody is in there, where a single pixel says nothing.
                  if (h2 > 0.90) { litWindow(wx, wy, WINDOW, 1); continue; }
                  if (h2 > 0.78) { litWindow(wx, wy, WINDOW_DIM, 0.55); continue; }
                  // And a few that go on and off. Each has its own period of
                  // roughly half a minute to a minute and a half, offset from
                  // every other, so no two ever change together.
                  if (h2 > 0.72) {
                    const ph = R.hash(wx * 31, wy * 17);
                    const period = 340 + ph * 900;         // frames, at 15fps
                    if (((t + ph * period) % period) < period * 0.42) {
                      litWindow(wx, wy, ph > 0.5 ? WINDOW : WINDOW_DIM,
                        ph > 0.5 ? 0.85 : 0.5);
                    }
                  }
                }
              }
            }
            x += bw + 1;
            seed++;
          }
        }

        // ---- street
        R.rect(0, horizon, W, H - horizon, ROAD);

        // ---- streetlamp: post, arm, lantern, and the light it throws.
        // The cone is blended, not stippled. Stippling it put a third of the
        // pixels at full lamp yellow and the cone came out as a solid triangle
        // — a lit cone is dim light over the whole area, not a few very bright
        // pixels, and that is the difference between a glow and a Christmas
        // tree.
        const lampX = Math.round(W * 0.20);
        const lampTop = Math.round(H * 0.30);
        const lampBase = H - drift[Math.min(W - 1, lampX)];
        R.rect(lampX, lampTop, 2, lampBase - lampTop, [46, 46, 56]);
        R.rect(lampX, lampTop, 6, 1, [46, 46, 56]);
        R.rect(lampX + 5, lampTop + 1, 3, 2, [70, 66, 60]);
        R.px(lampX + 6, lampTop + 3, LAMP);
        const cx = lampX + 6, cy = lampTop + 3;
        for (let y = cy; y < lampBase + 2; y++) {
          const k = (y - cy) / Math.max(1, lampBase + 2 - cy);
          const spread = 2 + k * H * 0.16;
          for (let x = Math.round(cx - spread); x < cx + spread; x++) {
            const across = 1 - Math.abs(x - cx) / spread;
            if (across <= 0) continue;
            R.blend(x, y, LAMP, across * across * (1 - k) * 0.16);
          }
        }

        // ---- snow lying on the ground
        for (let x = 0; x < W; x++) {
          const top = H - drift[x];
          for (let y = top; y < H; y++) R.px(x, y, y === top ? SNOW : [196, 206, 226]);
        }

        // ---- the drum
        R.rect(drumX, drumY, drumW, drumH, DRUM);
        R.rect(drumX, drumY, 1, drumH, DRUM_HI);
        for (let y = drumY + 2; y < drumY + drumH; y += 4) R.rect(drumX, y, drumW, 1, DRUM_HI);
        R.rect(drumX - 1, drumY, drumW + 2, 1, DRUM_HI);

        // ---- the fire.
        //
        // These are real particles that live across frames. They used to be
        // re-randomised every frame from a hash of the frame number, which
        // means nothing persisted: every flame pixel jumped somewhere new
        // fifteen times a second, and what you saw was not a fire rising but
        // a field of noise flickering. A flame has to *travel* to read as one.
        //
        // They climb at a shade above the speed the snow falls, which is what
        // hot air actually does on a still night — it drifts up, it does not
        // shoot.
        // Slow flames live a long time, and a long life needs a lot of them in
        // the air at once or the column comes out as a few sparse specks. At
        // this climb rate a particle takes about seven seconds to reach the
        // top, so the population settles around three hundred — the cap has to
        // be above that or it starves the base of the fire instead of the tip.
        const hgt = Math.round(drumH * (0.5 + blaze * 1.15));
        const spawn = 3 + (blaze > 0.6 ? 2 : 0);
        for (let i = 0; i < spawn && flame.length < 340; i++) {
          flame.push({
            x: drumX + 1 + Math.random() * (drumW - 2),
            y: fireY,
            vy: 0.08 + Math.random() * 0.14,
            ph: Math.random() * 6.28,
            life: 1
          });
        }
        const mouth = drumX + drumW / 2;
        for (const f of flame) {
          f.y -= f.vy;
          f.x += Math.sin(t * 0.055 + f.ph) * 0.13;
          // Drawn toward the middle as it climbs. A flame narrows to a tip;
          // left to drift it spreads into a column, which reads as smoke.
          f.x += (mouth - f.x) * 0.011;
          // Cooling is by distance climbed, not by a timer: a flame that goes
          // out at a fixed age gives the column a flat top.
          //
          // Clamped at both ends. The window shrinking moves fireY up while
          // the particles keep the y they already had, so a particle can find
          // itself *below* the mouth — which made life exceed 1, the colour
          // index go negative, and the whole animation die on the spot.
          f.life = Math.max(0, Math.min(1, 1 - (fireY - f.y) / Math.max(1, hgt)));
          if (f.life <= 0) continue;
          // Hottest at the base and cooling upward, so the ramp runs the other
          // way from `life`.
          const band = Math.min(FLAME.length - 1,
            Math.floor((1 - f.life) * FLAME.length));
          R.px(Math.round(f.x), Math.round(f.y), FLAME[band]);
          if (f.life > 0.72) R.px(Math.round(f.x), Math.round(f.y) + 1, FLAME[0]);
        }
        flame = flame.filter((f) => f.life > 0);

        // Sparks thrown when the fire is fed. Faster than the flame, because
        // a spark is carried rather than convected — but not by much.
        for (const s of fire) {
          s.life -= 0.012;
          s.y += 0.30;
          s.x += s.vx;
          if (s.life > 0) R.blend(Math.round(s.x), Math.round(fireY - s.y - hgt * 0.4), FLAME[1], s.life);
        }
        fire = fire.filter((s) => s.life > 0);

        // ---- the light it throws. Stippled, falling off with distance, over
        // the snow and the front of the drum.
        const glow = 0.34 + blaze * 0.5;
        for (let y = drumY - hgt; y < H; y++) {
          for (let x = drumX - 22; x < drumX + drumW + 22; x++) {
            const dx = (x - (drumX + drumW / 2)) / 22;
            const dy = (y - fireY) / 26;
            const f = 1 - Math.min(1, Math.hypot(dx, dy));
            if (f <= 0) continue;
            R.blend(x, y, SNOW_LIT, f * f * glow * 0.5);
          }
        }

        // ---- snow in the air, on whole pixels only
        for (const f of flakes) {
          f.y += f.v;
          f.x += Math.sin(t * 0.045 + f.ph) * 0.16;
          if (f.y > H) { f.y = -1; f.x = Math.random() * W; }
          R.px(Math.round(f.x), Math.round(f.y), SNOW);
        }

        R.flush();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      this._retro = R;
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._retro) this._retro.destroy();
      this._resize = null; this._onKey = null; this._retro = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Arcade — inside, late, with the machines still on.
  //
  // A perspective floor running away from you, a row of cabinets along the
  // back wall with their screens alight, and a neon sign washing the ceiling.
  // Each cabinet is running its own little attract-mode loop, and they are
  // not in step with each other — which is most of what makes a room full of
  // machines feel like a room full of machines.
  //
  // Typing is a coin going in: the nearest screen wakes up and runs bright.

  // ────────────────────────────────────────────────────────────────────────
  // Sunset — the beach level, at the end of the day.
  //
  // The warm one. A dithered sun sitting on the horizon, a glitter path
  // running from it to the shore, chunky wave bands rolling in, and palms in
  // silhouette. Every console game of the period had a level like this and
  // they all looked like this, because banded orange over banded blue is what
  // you get when a sunset has to fit in a handful of colours.
  //
  // Typing sends a wave in. It arrives a moment later, which is the point —
  // the sea does not answer immediately.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.sunset = {
    start() {
      const b = back();
      if (!b) return;
      const R = makeRetro(b, 5);

      const SKY = [
        [40, 22, 62], [92, 38, 78], [162, 60, 76],
        [222, 104, 62], [250, 162, 68], [255, 214, 120]
      ];
      const SEA = [[16, 18, 48], [24, 30, 70], [36, 48, 96], [54, 74, 128]];
      const SUN = [255, 238, 170];
      const SUN2 = [255, 186, 84];
      const GLIT = [255, 214, 132];
      const PALM = [14, 10, 24];
      const FOAM = [236, 240, 250];

      let horizon = 0, waves = [], t = 0, nextFrame = 0;
      const build = () => {
        horizon = Math.round(R.H * 0.52);
        waves = [];
      };
      const resize = () => {
        R.resize();
        build();
        nextFrame = 0;      // same as Barrel Fire: repaint at once, not in 66ms
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter')) return;
        // Born at the horizon and travelling toward the shore.
        waves.push({ p: 0, w: e.key === 'Enter' ? 1 : 0.55 });
        if (waves.length > 7) waves.shift();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / 15;
        t++;
        const W = R.W, H = R.H;

        R.vgrad(0, horizon, SKY, 2.2);

        // ---- the sun, half sunk, with its lower edge banded by the sea's
        // own horizon line rather than drawn over it.
        const sunR = Math.max(7, Math.round(H * 0.13));
        const sunX = Math.round(W * 0.52);
        const sunY = horizon - Math.round(sunR * 0.25);
        for (let y = -sunR; y <= sunR; y++) {
          for (let x = -sunR; x <= sunR; x++) {
            if (x * x + y * y > sunR * sunR) continue;
            const yy = sunY + y;
            if (yy >= horizon) continue;
            // Horizontal bands across the disc — the era's sun was always
            // sliced like this, from the same dithering.
            const band = ((yy + (t >> 4)) % 5) < 3;
            R.px(sunX + x, yy, band ? SUN : SUN2);
          }
        }
        // Its haze.
        for (let y = sunY - sunR * 2; y < horizon; y++) {
          for (let x = sunX - sunR * 3; x < sunX + sunR * 3; x++) {
            const f = 1 - Math.min(1, Math.hypot((x - sunX) / (sunR * 3), (y - sunY) / (sunR * 2)));
            if (f > 0) R.blend(x, y, SUN2, f * f * 0.35);
          }
        }

        R.vgrad(horizon, H, SEA, 0.7);

        // ---- the glitter path: a column of bright flecks from the sun to the
        // shore, widening as it comes toward you.
        // ---- wave bands, always rolling; the typed ones ride on top
        for (let i = 0; i < 9; i++) {
          const base = (i / 9) + ((t * 0.004) % (1 / 9));
          const y = horizon + Math.round((H - horizon) * Math.pow(base, 1.7));
          if (y <= horizon || y >= H) continue;
          for (let x = 0; x < W; x++) {
            const s = Math.sin(x * 0.18 + i * 1.7 + t * 0.05);
            if (s > 0.3) R.px(x, y, SEA[3]);
          }
        }
        for (const w of waves) {
          w.p += 0.022 * (0.6 + w.w);
          const y = horizon + Math.round((H - horizon) * Math.pow(Math.min(1, w.p), 1.7));
          if (y >= H) continue;
          for (let x = 0; x < W; x++) {
            const s = Math.sin(x * 0.13 + w.p * 6);
            if (s > 0.1 - w.w * 0.5) {
              R.px(x, y, FOAM);
              if (w.p > 0.55) R.px(x, y + 1, SEA[3]);
            }
          }
        }
        waves = waves.filter((w) => w.p < 1.05);

        // ---- palms, in flat silhouette. Two of them at different heights:
        // one palm is a prop, two are a shore.
        const palm = (px, th, span) => {
          for (let i = 0; i < th; i++) {
            const bend = Math.round(Math.sin(i * 0.045) * 3);
            R.px(px + bend, H - i, PALM);
            R.px(px + bend + 1, H - i, PALM);
          }
          const cy2 = H - th;
          const cx2 = px + Math.round(Math.sin(th * 0.045) * 3);
          for (let f = 0; f < 7; f++) {
            const a = -0.5 + f * 0.55;
            for (let d = 0; d < span; d++) {
              const fx = cx2 + Math.round(Math.cos(a) * d);
              const fy = cy2 + Math.round(Math.sin(a) * d + d * d * 0.045);
              R.px(fx, fy, PALM);
              R.px(fx, fy + 1, PALM);
              if (d > span * 0.4) R.px(fx, fy + 2, PALM);
            }
          }
        };
        palm(Math.round(W * 0.87), Math.round(H * 0.40), Math.round(W * 0.075));
        palm(Math.round(W * 0.955), Math.round(H * 0.27), Math.round(W * 0.055));

        R.flush();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      this._retro = R;
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._retro) this._retro.destroy();
      this._resize = null; this._onKey = null; this._retro = null;
    }
  };


  // A continuous bed of filtered noise — rain, wind, the rumble under a fire.
  // A looping buffer rather than a one-shot: an ambience has to be there the
  // whole time the theme is, and re-triggering a short sample on a timer is
  // audible as a loop within about ten seconds.
  function noiseBed(opts) {
    const ctx = audio();
    if (!ctx || !noiseBuf) return null;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type || 'lowpass';
    f.frequency.value = opts.freq || 900;
    f.Q.value = opts.q || 0.7;
    const g = ctx.createGain();
    g.gain.value = opts.gain || 0.03;
    src.connect(f); f.connect(g); g.connect(masterGain);
    src.start(0);
    return {
      gain: g,
      filter: f,
      set(v, over) {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(Math.max(0.0001, v), now + (over || 0.4));
      },
      stop() {
        try { src.stop(); } catch (e) {}
        try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) {}
      }
    };
  }

  // A plucked string.
  //
  // This was Karplus-Strong — a noise burst round a delay line with feedback.
  // It is the textbook algorithm and it was unusable here: the feedback needed
  // to sustain a low note is close enough to 1 that the loop sits on the edge
  // of oscillating, and what came out was the howl of a microphone next to a
  // speaker rather than a string. Tuning it to be safe made it a dull thud.
  //
  // Additive instead, which is what a plucked string actually is and, more to
  // the point, has no feedback path to run away: a short pick transient, then
  // a stack of harmonics on one envelope each. Upper harmonics start louder
  // and die much faster, which is the whole sound of a plucked string — bright
  // for a moment, then just the fundamental humming.
  const STRING_HARMONICS = [
    // multiple, level, how much faster than the fundamental it decays
    [1, 1.00, 1.0], [2, 0.44, 1.8], [3, 0.26, 2.6],
    [4, 0.14, 3.6], [5, 0.08, 4.6], [6, 0.05, 5.8]
  ];

  function pluck(freq, gain, decay, at) {
    const ctx = audio();
    if (!ctx || volume <= 0) return;
    const now = ctx.currentTime + (at || 0);
    const dur = decay || 1.6;

    // The pick itself: a few milliseconds of filtered noise, the sound of the
    // nail leaving the string. Without it every note starts out of nowhere.
    if (noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * 4;
      bp.Q.value = 1.2;
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(gain * 0.5, now);
      pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      src.connect(bp); bp.connect(pg); pg.connect(masterGain);
      src.start(now, Math.random() * 0.4, 0.05);
      src.stop(now + 0.05);
    }

    for (let i = 0; i < STRING_HARMONICS.length; i++) {
      const [mult, lvl, fast] = STRING_HARMONICS[i];
      const f = freq * mult;
      if (f > 11000) continue;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // A real string goes very slightly sharp at the attack and settles.
      osc.frequency.setValueAtTime(f * 1.004, now);
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.06);
      const g = ctx.createGain();
      const d = Math.max(0.08, dur / fast);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gain * lvl, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      osc.connect(g); g.connect(masterGain);
      osc.start(now);
      osc.stop(now + d + 0.02);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Downpour — rain, heard properly.
  //
  // Rain is three sounds, not one, and leaving any of them out is why most
  // synthesised rain sounds like static:
  //
  //   the bed      a wide hiss, the sum of everything too far away to pick out
  //   the drops    individual impacts near you, each with its own pitch
  //   the thunder  a long low swell, rarely
  //
  // The window shows what you are hearing: streaks down the glass, and beads
  // that gather, hang and run when they get heavy enough.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.downpour = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-downpour-canvas');
      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);

      // A recording of rain if there is one in src/sounds/, and two beds of
      // filtered noise if there is not. Rain has both a bright hiss and a low
      // roar under it; one alone is either a snake or a lorry.
      this._sampled = false;
      sampleBed('rain', 0.17).then((bed) => {
        if (!bed) return;
        // The synthesised pair is redundant once there is a real loop.
        if (this._hiss) { this._hiss.stop(); this._hiss = null; }
        if (this._roar) { this._roar.stop(); this._roar = null; }
        this._bed = bed;
        this._sampled = true;
      });
      this._hiss = noiseBed({ type: 'bandpass', freq: 3200, q: 0.5, gain: 0.016 });
      this._roar = noiseBed({ type: 'lowpass', freq: 420, q: 0.8, gain: 0.020 });

      // Beads on the glass live in Rainy Window, which models them properly
      // in a shader. Here it is only the streaks and the sound, which is the
      // half this theme is actually about.
      let intensity = 0.35;         // rises while you write
      let streaks = [];

      const plink = () => {
        // One drop landing. The pitch is where the ear gets "this is water and
        // not gravel" — a wide random range, and a resonant filter rather than
        // a plain burst.
        const f = rand(700, 2600);
        click(f, 14, 0.012 + intensity * 0.02, 0.028);
        if (Math.random() < 0.4) thock(rand(140, 320), 0.012, 0.05);
      };

      const thunder = () => {
        // A recorded roll if there is one; the synthesised swell if not.
        if (playSample('thunder', 0.7)) return;
        const ctx = audio();
        if (!ctx || volume <= 0) return;
        const now = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(160, now);
        lp.frequency.exponentialRampToValueAtTime(60, now + 3.2);
        const g = ctx.createGain();
        // A roll, not a bang: up over most of a second, down over three.
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.16, now + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 3.4);
        src.connect(lp); lp.connect(g); g.connect(masterGain);
        src.start(now);
        src.stop(now + 3.6);
      };

      let nextThunder = performance.now() + rand(22000, 60000);
      let dropAcc = 0;

      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter')) return;
        intensity = Math.min(1, intensity + 0.05);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        intensity = Math.max(0.3, intensity - dt * 0.09);

        if (this._bed) this._bed.set(0.18 + intensity * 0.26, 0.5);
        if (this._hiss) this._hiss.set(0.010 + intensity * 0.020, 0.5);
        if (this._roar) this._roar.set(0.014 + intensity * 0.022, 0.5);

        // Individual drops on top. A recording already has its own, so these
        // are only for the synthesised bed.
        if (!this._sampled) {
          dropAcc += dt * (7 + intensity * 26);
          while (dropAcc > 1) { dropAcc -= 1; plink(); }
        }

        if (now >= nextThunder) {
          thunder();
          nextThunder = now + rand(26000, 75000);
        }

        // ---- the glass
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);

        // Streaks: fast, faint, always falling.
        while (streaks.length < 40 + intensity * 70) {
          streaks.push({ x: rand(0, c.w), y: rand(-c.h, c.h), len: rand(8, 26), v: rand(420, 900) });
        }
        ctx.strokeStyle = 'rgba(180,206,232,0.20)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const s of streaks) {
          s.y += s.v * dt;
          if (s.y > c.h + s.len) { s.y = -s.len; s.x = rand(0, c.w); }
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + 1.5, s.y + s.len);
        }
        ctx.stroke();

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._hiss) this._hiss.stop();
      if (this._roar) this._roar.stop();
      if (this._bed) this._bed.stop();
      this._resize = null; this._onKey = null;
      this._hiss = null; this._roar = null; this._bed = null;
      closeAudio();
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Hearth — a fire, close by.
  //
  // A fire is a low roar you stop hearing after a minute and a crackle you
  // never stop hearing. The crackle is the whole thing: resin boiling and
  // bursting, at irregular intervals, each pop a different size. Regular pops
  // sound like a machine, so the gaps here are drawn from a distribution
  // rather than a timer.
  //
  // Typing feeds it: the fire brightens and spits.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.hearth = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-hearth-canvas');
      const resize = () => c.resize();
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const rand = (a, d) => a + Math.random() * (d - a);
      this._sampled = false;
      sampleBed('fire', 0.30).then((bed) => {
        if (!bed) return;
        if (this._roar) { this._roar.stop(); this._roar = null; }
        if (this._air) { this._air.stop(); this._air = null; }
        this._bed = bed;
        this._sampled = true;
      });
      this._roar = noiseBed({ type: 'lowpass', freq: 300, q: 0.6, gain: 0.026 });
      this._air = noiseBed({ type: 'bandpass', freq: 900, q: 0.35, gain: 0.010 });

      let heat = 0.4;
      let sparks = [];

      // One pop. Small ones are frequent and dry; big ones are rare, lower,
      // and throw a spark.
      const crackle = () => {
        const big = Math.random() < 0.14;
        const f = big ? rand(280, 700) : rand(900, 3400);
        impact(big ? 0.09 : 0.035, big ? 0.014 : 0.005);
        metalHit(f, big ? 0.05 : 0.022, big ? 0.09 : 0.035, 0.002);
        if (big) {
          thock(rand(70, 130), 0.05, 0.08, 0.003);
          for (let i = 0; i < 5; i++) {
            sparks.push({
              x: c.w * 0.5 + rand(-40, 40), y: c.h - rand(10, 40),
              vx: rand(-40, 40), vy: rand(-140, -60), life: 1
            });
          }
        }
      };

      let nextPop = 0;
      const onKey = (e) => {
        if (!e.key || e.key.length !== 1) return;
        heat = Math.min(1, heat + 0.06);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        heat = Math.max(0.32, heat - dt * 0.11);
        if (this._bed) this._bed.set(0.20 + heat * 0.28, 0.6);
        if (this._roar) this._roar.set(0.020 + heat * 0.026, 0.6);
        if (this._air) this._air.set(0.006 + heat * 0.012, 0.6);

        // A recording of a fire already crackles; the synthesised bed does not.
        if (!this._sampled && now >= nextPop) {
          crackle();
          // Gaps drawn from an exponential-ish distribution: a fire's pops are
          // a Poisson process, and evenly spaced ones sound like a metronome.
          nextPop = now + (60 + Math.pow(Math.random(), 2.2) * (1500 - heat * 900));
        }

        // The window only carries the light — the sound is the theme, so what
        // is drawn is the flicker it would throw into a room, plus the sparks
        // the big pops send up.
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);
        const flick = 0.5 + 0.5 * Math.sin(now / 90) * Math.sin(now / 37);
        const g = ctx.createLinearGradient(0, c.h, 0, c.h * 0.35);
        const a = (0.10 + heat * 0.14) * (0.75 + flick * 0.35);
        g.addColorStop(0, 'rgba(255,150,52,' + a.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, c.h * 0.35, c.w, c.h * 0.65);

        for (const s of sparks) {
          s.life -= dt * 0.7;
          s.vy += 60 * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.life <= 0) continue;
          ctx.fillStyle = 'rgba(255,' + Math.round(150 + s.life * 90) + ',80,' + s.life.toFixed(2) + ')';
          ctx.fillRect(s.x, s.y, 2, 2);
        }
        sparks = sparks.filter((s) => s.life > 0);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._roar) this._roar.stop();
      if (this._air) this._air.stop();
      if (this._bed) this._bed.stop();
      this._resize = null; this._onKey = null;
      this._roar = null; this._air = null; this._bed = null;
      closeAudio();
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Koto — the note plays you.
  //
  // Every key plucks a string. The strings are a pentatonic scale, which is
  // the trick that makes this bearable rather than maddening: there is no
  // interval in a pentatonic scale that sounds wrong against another, so a
  // paragraph typed at any speed comes out as music instead of as noise.
  //
  // The strings are physically modelled — Karplus-Strong, see pluck() — so
  // they are actually plucked rather than played back, and no two are quite
  // the same. The line walks up and down the scale rather than jumping at
  // random: random notes sound random, and a walk sounds like a melody.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.koto = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-koto-canvas');
      const resize = () => { c.resize(); build(); };

      // A minor pentatonic over two octaves, in Hz.
      const ROOT = 196;                       // G3
      const STEPS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
      const NOTES = STEPS.map((n) => ROOT * Math.pow(2, n / 12));

      let strings = [];
      const build = () => {
        strings = NOTES.map((f, i) => ({
          f,
          y: 0, amp: 0, phase: Math.random() * 6.28,
          i
        }));
        strings.forEach((s, i) => { s.y = (i + 1) / (strings.length + 1) * c.h; });
      };
      c.resize(); build();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let idx = 4;
      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        let step = 0;
        if (e.key === ' ') step = 0;
        else if (e.key === 'Enter') idx = 0;                 // back to the bottom
        else if (e.key === 'Backspace') step = -1;
        else if (e.key.length === 1) {
          // A walk, not a jump. Mostly a step, sometimes a skip, so the line
          // moves the way a melody does.
          const r = Math.random();
          step = r < 0.42 ? 1 : r < 0.78 ? -1 : (r < 0.92 ? 2 : -2);
        } else return;
        idx = Math.max(0, Math.min(NOTES.length - 1, idx + step));
        const s = strings[idx];
        if (!s) return;
        // Quieter up the scale, as a shorter string is — and quiet overall.
        // Six harmonics sum, so the per-harmonic level has to be a fraction
        // of what a single oscillator would take.
        pluck(s.f, 0.075 - idx * 0.003, 2.1 - idx * 0.11);
        s.amp = 1;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);
        ctx.lineWidth = 1;
        for (const s of strings) {
          s.amp = Math.max(0, s.amp - dt * 0.55);
          // A string vibrates fastest when it is highest, and the drawn wave
          // uses the same frequency the ear is getting.
          const k = s.amp;
          ctx.strokeStyle = 'rgba(226,214,190,' + (0.10 + k * 0.5).toFixed(3) + ')';
          ctx.beginPath();
          for (let x = 0; x <= c.w; x += 6) {
            const env = Math.sin((x / c.w) * Math.PI);       // pinned at both ends
            const y = s.y + Math.sin(x * 0.05 + now / 1000 * s.f * 0.06 + s.phase)
              * env * k * 7;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
      closeAudio();
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Constellation — you draw the sky.
  //
  // The other playable themes are things you push around. This one is a thing
  // you *make*: drag the cursor past a star and it joins to the last one you
  // touched, so a line follows your hand across the sky. Let go — stop moving
  // for a moment — and the figure you drew stays, and slowly fades over the
  // next few minutes the way anything you leave alone does.
  //
  // Typing puts new stars up. So the sky fills as the note does.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.constellation = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-constellation-canvas');

      const rand = (a, d) => a + Math.random() * (d - a);
      let stars = [];
      let lines = [];
      let lastStar = null;
      let idleFor = 0;

      const seed = () => {
        const want = Math.max(40, Math.min(150, Math.round((c.w * c.h) / 5200)));
        while (stars.length < want) {
          stars.push({
            x: rand(0, c.w), y: rand(0, c.h),
            r: rand(0.6, 1.9), ph: rand(0, 6.28), sp: rand(0.5, 1.7), lit: 0
          });
        }
        if (stars.length > want) stars.length = want;
      };
      const resize = () => { c.resize(); seed(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (!e.key || e.key.length !== 1) return;
        const p = caretRect();
        if (!p) return;
        // A new star, near what you are writing.
        stars.push({
          x: p.x + rand(-70, 70), y: p.y + rand(-50, 50),
          r: rand(0.9, 2.2), ph: rand(0, 6.28), sp: rand(0.6, 1.6), lit: 1
        });
        if (stars.length > 220) stars.shift();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let mx = -1, my = -1, moved = false;
      const onMove = (e) => { mx = e.clientX; my = e.clientY; moved = true; };
      document.addEventListener('mousemove', onMove, true);
      this._onMove = onMove;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        if (moved) { idleFor = 0; moved = false; } else idleFor += dt;
        // A pause of half a second ends the figure, so the next drag starts a
        // new one instead of joining onto whatever you drew last time.
        if (idleFor > 0.5) lastStar = null;

        // Which star the cursor is on, if any.
        if (mx >= 0 && idleFor < 0.2) {
          let best = null, bd = 26 * 26;
          for (const s of stars) {
            const d2 = (s.x - mx) * (s.x - mx) + (s.y - my) * (s.y - my);
            if (d2 < bd) { bd = d2; best = s; }
          }
          if (best) {
            best.lit = 1;
            if (lastStar && lastStar !== best) {
              const already = lines.some((l) =>
                (l.a === lastStar && l.b === best) || (l.a === best && l.b === lastStar));
              // Long jumps are not a line you meant to draw — they are the
              // cursor crossing the window on its way somewhere.
              const far = Math.hypot(best.x - lastStar.x, best.y - lastStar.y) > c.w * 0.45;
              if (!already && !far) {
                lines.push({ a: lastStar, b: best, life: 1 });
                if (lines.length > 90) lines.shift();
              }
            }
            lastStar = best;
          }
        }

        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);

        // The figures you have drawn, fading over minutes.
        ctx.lineWidth = 1;
        for (const l of lines) {
          l.life -= dt * 0.008;
          if (l.life <= 0) continue;
          ctx.strokeStyle = 'rgba(176,206,255,' + (l.life * 0.55).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(l.a.x, l.a.y);
          ctx.lineTo(l.b.x, l.b.y);
          ctx.stroke();
        }
        lines = lines.filter((l) => l.life > 0);

        for (const s of stars) {
          s.lit = Math.max(0, s.lit - dt * 0.8);
          const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 1000 * s.sp + s.ph));
          const a = Math.min(1, tw * 0.7 + s.lit);
          ctx.fillStyle = 'rgba(224,234,255,' + a.toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r + s.lit * 1.4, 0, Math.PI * 2);
          ctx.fill();
          if (s.lit > 0.05) {
            ctx.strokeStyle = 'rgba(150,190,255,' + (s.lit * 0.4).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r + 5 + (1 - s.lit) * 7, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._onMove) document.removeEventListener('mousemove', this._onMove, true);
      this._resize = null; this._onKey = null; this._onMove = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Silk — a web, and a real one.
  //
  // A grid of points joined by threads, run as a Verlet cloth: each point
  // remembers where it was last frame, gravity pulls on it, and then the
  // threads are asked repeatedly to be their proper length again. That
  // relaxation is the whole simulation, and it is why plucking one strand
  // sends a wave along it and shakes the ones it is tied to.
  //
  // The cursor is a finger. Push through the web and it stretches, drags, and
  // springs back — and if you pull hard enough, a thread parts and hangs.
  // Typing spins the broken ones again.
  // ────────────────────────────────────────────────────────────────────────
  // Silk — an orb web, built the way a spider builds one.
  //
  // The first version was a cloth grid bent into a circle, and it read as a
  // net. A real orb web is four different things and the difference between
  // them is the whole look:
  //
  //   frame threads   anchored to whatever is around, irregular, taut
  //   radii           straight lines from the hub to the frame — the spokes
  //                   do not sag, because the spider pulls them tight
  //   the hub         a dense little knot in the middle
  //   capture spiral  ONE thread, spiralling out from the middle to the edge
  //
  // That last one matters most. Concentric rings are what a diagram of a web
  // looks like; a real one is a single continuous line, and the eye picks up
  // the difference immediately even if it cannot say why.
  //
  // There is also a free zone: a gap between the hub and where the sticky
  // spiral starts, which every orb web has and no drawing of one ever does.
  //
  // And there are cobwebs in the corners of the window, because a web in the
  // middle of nowhere is a diagram too — a real one is attached to something.
  // ────────────────────────────────────────────────────────────────────────
  // Silk — cobwebs in the corners, and a thread off every letter.
  //
  // The first version put one big orb web across the middle of the window,
  // which was the wrong place for it: you write in the middle. A web belongs
  // where nothing has been disturbed for a while — the corners — and that is
  // also where a real one is, because it needs two walls to anchor to.
  //
  // So: four corner webs, each a quarter-orb with its own radials and its own
  // spiral, and all four are physical — run the cursor into one and it
  // stretches, drags and springs back.
  //
  // And typing spins. Every letter pays out a thread of gossamer from the
  // caret, which hangs, sways under its own weight and thins away over the
  // next few seconds. Write a paragraph and the space you have been working
  // in is quietly full of silk.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.silk = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-silk-canvas');

      const RAYS = 9;       // radials per corner web
      const RINGS = 7;      // points along each radial
      let webs = [];
      let threads = [];     // the gossamer typing pays out

      const idx = (r, k) => r * RINGS + k;

      const buildWeb = (ox, oy, sx, sy, seed) => {
        const size = Math.min(c.w, c.h) * (0.30 + ((Math.sin(seed * 91.7) * 43758.5) % 1) * 0.10);
        const pts = [];
        const links = [];
        for (let r = 0; r < RAYS; r++) {
          // Uneven, like a real one — a spider lays radials by feel.
          const jit = ((Math.sin((r + seed) * 12.9898) * 43758.5453) % 1) * 0.10;
          const ang = (r / (RAYS - 1)) * (Math.PI / 2) + jit;
          const reach = size * (0.72 + ((Math.sin((r + seed * 3) * 78.233) * 43758.5) % 1) * 0.42);
          for (let k = 0; k < RINGS; k++) {
            const f = k / (RINGS - 1);
            const x = ox + sx * Math.cos(ang) * reach * f;
            const y = oy + sy * Math.sin(ang) * reach * f;
            // The corner itself and the outermost ring are tied to the walls.
            pts.push({ x, y, px: x, py: y, pin: k === 0 || k === RINGS - 1 });
          }
        }
        for (let r = 0; r < RAYS; r++) {
          for (let k = 0; k < RINGS - 1; k++) {
            links.push({ a: idx(r, k), b: idx(r, k + 1), len: 0, cut: false, spoke: true });
          }
        }
        // The capture spiral, stepping up a ring at the end of each sweep so
        // it is one continuous thread rather than a stack of closed arcs.
        for (let k = 2; k < RINGS - 1; k++) {
          for (let r = 0; r < RAYS - 1; r++) {
            const to = (r === RAYS - 2 && k + 1 < RINGS) ? idx(0, k + 1) : idx(r + 1, k);
            links.push({ a: idx(r, k), b: to, len: 0, cut: false, spoke: false });
          }
        }
        for (const k of links) {
          k.len = Math.hypot(pts[k.a].x - pts[k.b].x, pts[k.a].y - pts[k.b].y);
        }
        return { pts, links };
      };

      const build = () => {
        webs = [
          buildWeb(0, 0, 1, 1, 1),
          buildWeb(c.w, 0, -1, 1, 5),
          buildWeb(0, c.h, 1, -1, 9),
          buildWeb(c.w, c.h, -1, -1, 13)
        ];
        threads = [];
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let mx = -1e6, my = -1e6, pmx = -1e6, pmy = -1e6;
      const onMove = (e) => { mx = e.clientX; my = e.clientY; };
      document.addEventListener('mousemove', onMove, true);
      this._onMove = onMove;

      const rand = (a, d) => a + Math.random() * (d - a);

      // A strand paid out from the letter just typed. Anchored at the top,
      // free at the bottom, so it hangs and swings like real gossamer.
      const spin = (x, y, long) => {
        const n = long ? 9 : 5 + Math.floor(Math.random() * 3);
        const seg = rand(4, 9);
        const pts = [];
        for (let i = 0; i < n; i++) {
          pts.push({ x: x + rand(-1, 1), y: y + i * seg, px: x, py: y + i * seg, pin: i === 0 });
        }
        threads.push({ pts, seg, life: 1, sway: rand(-1, 1) });
        if (threads.length > 26) threads.shift();
      };

      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        if (e.key === 'Enter') {
          // A line finished pays out a longer one.
          const p = caretRect();
          if (p) spin(p.x, p.bottom, true);
          return;
        }
        if (e.key.length !== 1) return;
        const p = caretRect();
        if (p) spin(p.x + rand(-3, 3), p.bottom - 2, false);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const relax = (pts, links, stiff, breakAt) => {
        for (const k of links) {
          if (k.cut) continue;
          const a = pts[k.a], b2 = pts[k.b];
          const dx = b2.x - a.x, dy = b2.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d > k.len * breakAt) { k.cut = true; continue; }
          const diff = (d - k.len) / d * 0.5 * stiff;
          const ox = dx * diff, oy = dy * diff;
          if (!a.pin) { a.x += ox; a.y += oy; }
          if (!b2.pin) { b2.x -= ox; b2.y -= oy; }
        }
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.033);
        last = now;
        const vx = mx - pmx, vy = my - pmy;
        pmx = mx; pmy = my;

        for (const w of webs) {
          for (const p of w.pts) {
            if (p.pin) continue;
            const nx = p.x + (p.x - p.px) * 0.985;
            const ny = p.y + (p.y - p.py) * 0.985 + 14 * dt;
            p.px = p.x; p.py = p.y;
            p.x = nx; p.y = ny;
            const d = Math.hypot(p.x - mx, p.y - my);
            if (d < 40) {
              const f = 1 - d / 40;
              p.x += vx * f * 0.9;
              p.y += vy * f * 0.9;
            }
          }
          // Radials taut, spiral slack — a spider spends its silk making the
          // spokes rigid and lets the capture thread give.
          for (let pass = 0; pass < 4; pass++) {
            relax(w.pts, w.links.filter((k) => k.spoke), 0.85, 1.9);
            relax(w.pts, w.links.filter((k) => !k.spoke), 0.42, 2.8);
          }
        }

        // The gossamer.
        for (const th of threads) {
          th.life -= dt * 0.13;
          const drift = Math.sin(now / 900 + th.sway * 4) * 5;
          for (let i = 0; i < th.pts.length; i++) {
            const p = th.pts[i];
            if (p.pin) continue;
            const nx = p.x + (p.x - p.px) * 0.96 + drift * dt;
            const ny = p.y + (p.y - p.py) * 0.96 + 26 * dt;
            p.px = p.x; p.py = p.y;
            p.x = nx; p.y = ny;
            const d = Math.hypot(p.x - mx, p.y - my);
            if (d < 30) { const f = 1 - d / 30; p.x += vx * f; p.y += vy * f; }
          }
          for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < th.pts.length - 1; i++) {
              const a = th.pts[i], b2 = th.pts[i + 1];
              const dx = b2.x - a.x, dy = b2.y - a.y;
              const d = Math.hypot(dx, dy) || 0.001;
              const diff = (d - th.seg) / d * 0.5;
              if (!a.pin) { a.x += dx * diff; a.y += dy * diff; }
              b2.x -= dx * diff; b2.y -= dy * diff;
            }
          }
        }
        threads = threads.filter((th) => th.life > 0);

        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);
        ctx.lineCap = 'round';

        for (const w of webs) {
          // Radials: brighter and thicker, because they carry the web.
          ctx.strokeStyle = 'rgba(228,240,252,0.30)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const k of w.links) {
            if (k.cut || !k.spoke) continue;
            ctx.moveTo(w.pts[k.a].x, w.pts[k.a].y);
            ctx.lineTo(w.pts[k.b].x, w.pts[k.b].y);
          }
          ctx.stroke();
          // The capture spiral: finer and dimmer.
          ctx.strokeStyle = 'rgba(206,224,240,0.17)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (const k of w.links) {
            if (k.cut || k.spoke) continue;
            ctx.moveTo(w.pts[k.a].x, w.pts[k.a].y);
            ctx.lineTo(w.pts[k.b].x, w.pts[k.b].y);
          }
          ctx.stroke();
        }

        // Gossamer last, over the webs, fading as it ages.
        ctx.lineWidth = 0.9;
        for (const th of threads) {
          ctx.strokeStyle = 'rgba(236,246,255,' + (th.life * 0.42).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(th.pts[0].x, th.pts[0].y);
          for (let i = 1; i < th.pts.length; i++) ctx.lineTo(th.pts[i].x, th.pts[i].y);
          ctx.stroke();
          // A bead at the tip, which is what catches the light on a real one.
          const tip = th.pts[th.pts.length - 1];
          ctx.fillStyle = 'rgba(244,250,255,' + (th.life * 0.5).toFixed(3) + ')';
          ctx.fillRect(tip.x - 0.8, tip.y - 0.8, 1.6, 1.6);
        }

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onMove) document.removeEventListener('mousemove', this._onMove, true);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onMove = null; this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Cursive — a pen that writes what you write.
  //
  // Not a decorative squiggle. The pen has a position and a heading, and each
  // character turns it by an angle taken from that character's own code. The
  // same word therefore always draws the same shape: type "hello" twice and
  // you get the same flourish twice, which is the difference between a theme
  // that responds to you and one that just reacts to the fact that something
  // happened.
  //
  // Width comes from how fast you are going — a pen pushed quickly lays down
  // a thinner line — and every stroke dries over half a minute rather than
  // being wiped, so a page you have been working on keeps its history.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.cursive = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-cursive-canvas');

      let strokes = [];      // each: { pts, born, width }
      let pen = null;        // { x, y, dir }
      let lastKey = 0;

      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // The turn a character makes. Letters near the start of the alphabet
      // curl one way and later ones the other, with vowels turning harder —
      // that is what gives written English its rhythm of tall loops and low
      // ones rather than a uniform scribble.
      const turnFor = (ch) => {
        const code = ch.charCodeAt(0);
        const low = ch.toLowerCase();
        const vowel = 'aeiou'.indexOf(low) >= 0;
        const base = ((code * 2654435761) >>> 0) / 4294967296;   // stable per char
        return (base - 0.5) * (vowel ? 2.6 : 1.5);
      };

      // The pen walks on its own — it is *handwriting*, not an underline. It
      // starts at the caret, turns a little per character, and runs on across
      // the page the way a hand does, so a paragraph leaves a page of script
      // rather than a squiggle stuck under the words. An earlier attempt tied
      // every point to the caret and the result was a wobbly underline: safe,
      // and not worth having.
      //
      // What was actually wrong was one line at the bottom. Running out of
      // page did `pen.y = 30` and carried on drawing into the *same* stroke,
      // so the line shot from the foot of the window back up to the top in one
      // straight segment. A hand that runs out of paper does not draw its way
      // back to the top: it lifts. Both wraps now start a new stroke, which is
      // what lifting is.
      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        const now = performance.now();
        const gap = now - lastKey;
        lastKey = now;

        if (e.key === 'Enter' || !pen) {
          const p = caretRect();
          if (!p) return;
          pen = { x: p.x, y: p.bottom + 4, dir: -0.35 };
          strokes.push({ pts: [{ x: pen.x, y: pen.y }], born: now, width: 2 });
          if (strokes.length > 40) strokes.shift();
          if (e.key === 'Enter') return;
        }
        if (e.key.length !== 1) return;

        // Fast typing means a thin, long stroke; deliberate typing a fat,
        // short one. 60ms is about as fast as anyone sustains.
        const speed = Math.max(0, Math.min(1, (240 - Math.min(gap, 240)) / 180));
        const step = 5 + speed * 7;
        const width = 2.6 - speed * 1.5;

        pen.dir += turnFor(e.key);
        // Kept roughly horizontal, or the pen spirals off into a corner
        // within a sentence. Writing travels along a line; only the loops
        // go up and down.
        pen.dir = Math.max(-1.5, Math.min(1.5, pen.dir * 0.55));

        const lift = () => {
          strokes.push({ pts: [{ x: pen.x, y: pen.y }], born: now, width });
          if (strokes.length > 40) strokes.shift();
        };

        const s = strokes[strokes.length - 1];
        for (let i = 0; i < 3; i++) {
          pen.x += Math.cos(pen.dir) * step * 0.34 + 1.1;
          pen.y += Math.sin(pen.dir) * step * 0.34;
          s.pts.push({ x: pen.x, y: pen.y });
        }
        s.width = width;
        if (s.pts.length > 400) lift();

        // Wrap at the edges the way a hand runs out of paper. Both of these
        // move the pen somewhere it was not, so both lift first — that is the
        // whole fix.
        if (pen.x > c.w - 24) {
          pen.x = 24;
          pen.y += 26;
          lift();
        }
        if (pen.y > c.h - 20) {
          pen.y = 30;
          pen.dir = -0.35;
          lift();
        }
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const DRY = 30000;    // how long a stroke takes to disappear entirely

      const tick = (now) => {
        const ctx = c.ctx;
        ctx.clearRect(0, 0, c.w, c.h);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const s of strokes) {
          const age = (now - s.born) / DRY;
          if (age >= 1 || s.pts.length < 2) continue;
          // Ink does not fade evenly — it holds, then goes. Squaring the
          // remaining life keeps a stroke readable for most of its life and
          // then lets it leave quickly.
          const a = (1 - age) * (1 - age) * 0.55;
          ctx.strokeStyle = 'rgba(226,206,168,' + a.toFixed(3) + ')';
          ctx.lineWidth = s.width;
          ctx.beginPath();
          ctx.moveTo(s.pts[0].x, s.pts[0].y);
          for (let i = 1; i < s.pts.length - 1; i++) {
            // Quadratic through the midpoints: the cheap way to get a curve
            // out of a polyline without a spline solve, and the only way this
            // reads as a pen rather than a chart.
            const p = s.pts[i], q = s.pts[i + 1];
            ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
          }
          ctx.stroke();
        }
        strokes = strokes.filter((s) => now - s.born < DRY);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };


  // ────────────────────────────────────────────────────────────────────────
  // Tide — the sea at the bottom of the window, on the real clock.
  //
  // The semidiurnal tide has a period of 12h 25.2m, not 12h: the moon is not
  // where it was yesterday, so high water walks about fifty minutes later
  // each day. Driving the level off that number instead of a round twelve
  // means the sea is genuinely somewhere different at nine in the evening
  // than it was at nine in the morning, and the difference drifts across the
  // week the way the real one does.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.tide = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-tide-canvas');
      const resize = () => c.resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const M2 = 12 * 3600 + 25 * 60 + 12;    // seconds, principal lunar
      const S2 = 12 * 3600;                   // seconds, principal solar
      // Two constituents, not one. Their beat is what makes spring and neap
      // tides, so over a fortnight the range here genuinely widens and
      // narrows instead of repeating every half day.
      const level = () => {
        const t = Date.now() / 1000;
        return 0.62 * Math.cos(2 * Math.PI * t / M2) + 0.28 * Math.cos(2 * Math.PI * t / S2);
      };

      // A handful of swells at unrelated periods. Sea surface is the sum of
      // a spectrum; three sines at ratios that never line up is enough to
      // stop the eye finding the loop.
      const swell = [
        { amp: 3.4, len: 260, spd: 0.42, ph: 0 },
        { amp: 2.1, len: 137, spd: -0.61, ph: 1.7 },
        { amp: 1.3, len: 71, spd: 0.93, ph: 3.1 }
      ];

      // Slosh. Drag the window and the water leans, then rocks back — this is
      // a seiche, the standing wave a bathtub or a harbour makes, and it is
      // what a body of water in a container actually does when the container
      // moves. Two springs: one on the *tilt* of the surface, driven by
      // sideways motion, and one on the level, driven by vertical motion.
      //
      // Modelled rather than faked because the giveaway of a fake is that it
      // starts and stops with the drag. A real one keeps going afterwards,
      // overshoots, and takes a couple of seconds to settle — all of which
      // comes free from a spring and none of which comes from a lerp.
      let tilt = 0, tiltV = 0, bob = 0, bobV = 0;
      this._unshove = onShove((dx, dy) => {
        // Water lags the container: push the window right and the surface
        // piles up on the left.
        tiltV -= dx * 0.006;
        bobV -= dy * 1.5;
      });

      let last = performance.now();
      const tick = (now) => {
        const ctx = c.ctx;
        const t = now / 1000;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // omega^2 * x for the restoring force, and a per-second damping factor
        // rather than a per-frame one so the settle takes the same time on any
        // machine.
        tiltV -= tilt * 26 * dt;
        tiltV *= Math.pow(0.30, dt);
        tilt += tiltV * dt;
        tilt = Math.max(-0.14, Math.min(0.14, tilt));
        bobV -= bob * 30 * dt;
        bobV *= Math.pow(0.25, dt);
        bob += bobV * dt;
        bob = Math.max(-c.h * 0.14, Math.min(c.h * 0.14, bob));

        ctx.clearRect(0, 0, c.w, c.h);

        const lv = level();
        // Sea occupies the bottom third at mean level, and moves about a
        // tenth of the window between low and high.
        const meanY = c.h * 0.72;
        const surfaceY = meanY - lv * c.h * 0.10;

        const heightAt = (x) => {
          let y = surfaceY + bob + tilt * (x - c.w / 2);
          for (const s of swell) y += Math.sin(x / s.len + t * s.spd + s.ph) * s.amp;
          return y;
        };

        // A wet band above the waterline, left behind as the tide falls and
        // not yet dry. Drawn first, and following the surface rather than as a
        // straight strip: as a `fillRect` it stayed level while the water
        // leaned under it, which put a hard horizontal edge across the window
        // the moment anything sloshed — and made every measurement of the
        // waterline read the band instead of the sea.
        const falling = level() < 0.62 * Math.cos(2 * Math.PI * (Date.now() / 1000 - 60) / M2)
          + 0.28 * Math.cos(2 * Math.PI * (Date.now() / 1000 - 60) / S2);
        if (falling) {
          ctx.fillStyle = 'rgba(34,70,84,0.20)';
          ctx.beginPath();
          for (let x = 0; x <= c.w; x += 4) {
            const y = heightAt(x);
            if (x === 0) ctx.moveTo(x, y - 26); else ctx.lineTo(x, y - 26);
          }
          for (let x = c.w; x >= 0; x -= 4) ctx.lineTo(x, heightAt(x));
          ctx.closePath();
          ctx.fill();
        }

        // The body of the water, darkening with depth. Lifted well above the
        // first version, which was so dark against a translucent panel that
        // the sea was a suggestion — the palette carries alpha and the app
        // sits on top of it, so anything subtle here disappears twice over.
        const g = ctx.createLinearGradient(0, surfaceY - 8, 0, c.h);
        g.addColorStop(0, 'rgba(74,150,172,0.72)');
        g.addColorStop(0.28, 'rgba(38,100,126,0.74)');
        g.addColorStop(1, 'rgba(8,32,46,0.86)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, c.h);
        for (let x = 0; x <= c.w; x += 4) ctx.lineTo(x, heightAt(x));
        ctx.lineTo(c.w, c.h);
        ctx.closePath();
        ctx.fill();

        // Glitter: the broken reflection of a low light on the water. A band
        // of short bright dashes, densest at the middle and thinning out to
        // either side, each one on the surface itself. This is the single
        // strongest cue that a blue shape is water — a flat gradient reads as
        // a wall painted blue.
        const glitterX = c.w * 0.62;
        for (let x = 0; x < c.w; x += 5) {
          const across = 1 - Math.abs(x - glitterX) / (c.w * 0.42);
          if (across <= 0) continue;
          const y = heightAt(x);
          // Deterministic per column and slowly changing, so it shimmers in
          // place instead of crawling sideways.
          const tw = Math.sin(x * 0.7 + t * 2.3) * Math.sin(x * 0.13 - t * 1.1);
          if (tw < 0.25) continue;
          const a = across * across * (tw - 0.25) * 1.1;
          ctx.fillStyle = 'rgba(214,242,250,' + Math.min(0.7, a).toFixed(3) + ')';
          ctx.fillRect(x, y + 1 + (x % 3), 3 + across * 4, 1.2);
        }

        // The lit edge. Only where the surface is rising toward the viewer —
        // a wave catches light on its face, not along its whole length.
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let drawing = false;
        for (let x = 0; x <= c.w; x += 3) {
          const slope = heightAt(x + 3) - heightAt(x);
          if (slope < -0.25) {
            if (!drawing) { ctx.moveTo(x, heightAt(x)); drawing = true; }
            else ctx.lineTo(x, heightAt(x));
          } else drawing = false;
        }
        ctx.strokeStyle = 'rgba(196,236,248,0.55)';
        ctx.stroke();

        // Foam, where the surface is steepest — a crest about to break. Only
        // on the steep faces, so it appears and goes as the swells pass
        // through each other rather than sitting on the water permanently.
        for (let x = 0; x <= c.w; x += 6) {
          const slope = (heightAt(x + 6) - heightAt(x)) / 6;
          if (slope > -0.55) continue;
          const y = heightAt(x + 3);
          const a = Math.min(0.5, (-slope - 0.55) * 1.2);
          ctx.fillStyle = 'rgba(232,248,252,' + a.toFixed(3) + ')';
          ctx.beginPath();
          ctx.ellipse(x + 3, y, 4, 1.3, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._unshove) this._unshove();
      this._unshove = null;
      this._resize = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Oscilloscope — a trace on a phosphor tube, and you are the signal.
  //
  // Every keystroke adds a partial to the waveform: the character's code
  // picks the harmonic, so a word has a shape and the same word always has
  // the same one. The partials decay over a few seconds, so the trace is
  // complicated while you write and settles back to a plain sine when you
  // stop. Leave it alone long enough and the timebase gives up and the beam
  // goes to X-Y, which is what an idle scope on a bench actually does.
  //
  // Persistence is the whole look, and it is not a blur: P31 phosphor decays
  // exponentially, so the frame is knocked back by a constant fraction each
  // tick rather than cleared. The graticule is a second canvas underneath,
  // painted once — putting it in the persistence buffer would make it smear
  // into the trace and it is supposed to be behind the glass, not on it.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.scope = {
    start() {
      const b = back();
      if (!b) return;
      const grid = makeCanvas(b, 'fx-scope-grid');
      const c = makeCanvas(b, 'fx-scope-canvas');
      const gx = grid.ctx, ctx = c.ctx;

      const drawGrid = () => {
        gx.clearRect(0, 0, grid.w, grid.h);
        const cx = grid.w / 2, cy = grid.h / 2;
        // Ten divisions across, eight down — the standard face, so the
        // spacing is not square and that is correct.
        const dx = grid.w / 10, dy = grid.h / 8;
        gx.lineWidth = 1;
        gx.strokeStyle = 'rgba(62,232,138,0.17)';
        gx.beginPath();
        for (let i = 1; i < 10; i++) { gx.moveTo(i * dx, 0); gx.lineTo(i * dx, grid.h); }
        for (let i = 1; i < 8; i++) { gx.moveTo(0, i * dy); gx.lineTo(grid.w, i * dy); }
        gx.stroke();
        // The centre lines carry minor ticks; the outer graticule does not.
        gx.strokeStyle = 'rgba(62,232,138,0.34)';
        gx.beginPath();
        gx.moveTo(0, cy); gx.lineTo(grid.w, cy);
        gx.moveTo(cx, 0); gx.lineTo(cx, grid.h);
        for (let i = 0; i <= 50; i++) {
          const x = (i / 50) * grid.w;
          gx.moveTo(x, cy - 4); gx.lineTo(x, cy + 4);
        }
        for (let i = 0; i <= 40; i++) {
          const y = (i / 40) * grid.h;
          gx.moveTo(cx - 4, y); gx.lineTo(cx + 4, y);
        }
        gx.stroke();
      };

      const resize = () => { grid.resize(); c.resize(); drawGrid(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // Partials the typing has stacked on. `h` is the harmonic, `a` the
      // amplitude it started at, `born` when it arrived.
      let parts = [];
      let lastKey = -1e9;

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        const now = performance.now();
        lastKey = now;
        // Harmonics 2..13. Low ones are the ones you can see moving; above a
        // dozen the trace just thickens and reads as noise.
        const h = 2 + (e.key.charCodeAt(0) % 12);
        const same = parts.find((p) => p.h === h);
        if (same) { same.born = now; same.a = Math.min(0.5, same.a + 0.12); return; }
        parts.push({ h, a: 0.22 + Math.random() * 0.1, born: now, phase: Math.random() * Math.PI * 2 });
        if (parts.length > 6) parts.shift();
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const N = 420;          // samples along the trace
      let sweep = 0;          // timebase phase
      let lis = 0;            // Lissajous parameter, only used when idle

      const tick = (now) => {
        const t = now / 1000;

        // Phosphor. A flat alpha over the whole face rather than a clear:
        // what is left after n frames is 0.88^n, which is the exponential a
        // tube actually has, and the tail behind a fast edge comes out for
        // free instead of being drawn.
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(4,10,8,0.34)';
        ctx.fillRect(0, 0, c.w, c.h);

        // How far into X-Y we have drifted. Eight seconds of nothing and the
        // timebase is fully gone; a single keystroke pulls it straight back.
        const idle = Math.max(0, Math.min(1, (now - lastKey - 8000) / 4000));

        parts = parts.filter((p) => now - p.born < 6000);

        const cy = c.h / 2, amp = c.h * 0.30;
        // Barely moving. This used to advance six thousandths of a turn a
        // frame, which with a long persistence painted the swept area solid —
        // a filled green mass, not a trace. A scope is *triggered*: the
        // waveform stands still and only its shape changes. What is left is a
        // slow drift, which is the trigger not quite holding.
        sweep += 0.0012;
        lis += 0.010;

        const pts = new Float32Array(N * 2);
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);

          // Sweep mode: y is the signal, x is time across the face.
          let v = Math.sin((u * 3 + sweep) * Math.PI * 2) * 0.42;
          for (const p of parts) {
            const age = (now - p.born) / 6000;
            const a = p.a * (1 - age) * (1 - age);
            v += Math.sin((u * 3 * p.h + sweep * p.h) * Math.PI * 2 + p.phase) * a;
          }
          const sx = u * c.w;
          const sy = cy - v * amp;

          // X-Y mode: two detuned oscillators, so the figure precesses
          // instead of sitting still — nothing on a bench is ever exactly
          // in ratio.
          const lx = c.w / 2 + Math.sin(lis * 3 + t * 0.13) * c.w * 0.34;
          const ly = cy + Math.sin(lis * 2 + t * 0.31 + u * 0.0001) * amp;
          const px = c.w / 2 + Math.sin((u * 6.283) * 3 + lis * 3) * c.w * 0.34;
          const py = cy + Math.sin((u * 6.283) * 2 + lis * 2 + t * 0.2) * amp;

          pts[i * 2] = sx + (px - sx) * idle;
          pts[i * 2 + 1] = sy + (py - sy) * idle;
          // lx/ly keep the beam parked mid-figure at the blend's midpoint;
          // without them the crossfade cuts a chord across the face.
          if (idle > 0 && idle < 1) {
            const k = 4 * idle * (1 - idle) * 0.15;
            pts[i * 2] += (lx - pts[i * 2]) * k;
            pts[i * 2 + 1] += (ly - pts[i * 2 + 1]) * k;
          }
        }

        // Two passes, added: a wide dim halo for the bloom in the glass and a
        // narrow bright core. Additive because two crossings of the beam are
        // brighter than one, which is why a Lissajous node is the brightest
        // thing on the screen.
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const pass of [[5, 'rgba(30,120,70,0.16)'], [2.4, 'rgba(62,232,138,0.30)'], [1.1, 'rgba(190,255,215,0.60)']]) {
          ctx.lineWidth = pass[0];
          ctx.strokeStyle = pass[1];
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          for (let i = 1; i < N; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Telex — the tape your writing is being punched onto.
  //
  // Five-level Baudot, the real ITA2 codes, so the holes are not decoration:
  // a hole means that bit is set, and the same letter punches the same
  // column every time. The sprocket row is between bits 2 and 3 and is
  // smaller than the data holes, because on real tape it is a feed hole and
  // not a bit — get that wrong and it reads as six-level tape to anyone who
  // has seen one.
  //
  // The tape pays out from the punch at the right and runs left, so the
  // oldest thing you wrote is about to fall off the edge.
  // ────────────────────────────────────────────────────────────────────────
  const BAUDOT = {
    A: 0x03, B: 0x19, C: 0x0e, D: 0x09, E: 0x01, F: 0x0d, G: 0x1a, H: 0x14,
    I: 0x06, J: 0x0b, K: 0x0f, L: 0x12, M: 0x1c, N: 0x0c, O: 0x18, P: 0x16,
    Q: 0x17, R: 0x0a, S: 0x05, T: 0x10, U: 0x07, V: 0x1e, W: 0x13, X: 0x1d,
    Y: 0x15, Z: 0x11, ' ': 0x04
  };
  // Figures shift: the digits live on the letter keys, so a number punches
  // the letter's holes. 0 is P, 1 is Q, and so on round the top row.
  const FIGS = ['P', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O'];

  RUNTIMES.telex = {
    start() {
      const bk = back();
      if (!bk) return;
      const c = makeCanvas(bk, 'fx-telex-canvas');
      const ctx = c.ctx;

      const PITCH = 11;       // distance between columns, px
      const TAPE_H = 46;
      let cols = [];          // {bits, x} — x is the column's left edge
      let feed = 0;           // sub-pixel tape position

      const capacity = () => Math.ceil(window.innerWidth / PITCH) + 4;

      const resize = () => {
        c.resize();
        if (cols.length > capacity()) cols = cols.slice(-capacity());
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // The tape has to exist before anything is typed or the theme is an
      // empty band for the first minute. Seed it with something plausible —
      // a call sign and a wire header, which is what was on the front of the
      // tape when the machine had been idle.
      for (const ch of 'ZCZC PROMPTPAD DE TELEX ') {
        cols.push({ bits: BAUDOT[ch] === undefined ? 0x04 : BAUDOT[ch], fresh: 0 });
      }

      const punch = (ch) => {
        const up = ch.toUpperCase();
        let bits;
        if (BAUDOT[up] !== undefined) bits = BAUDOT[up];
        else if (ch >= '0' && ch <= '9') bits = BAUDOT[FIGS[+ch]];
        else bits = 0x04;     // anything else rides through as a space
        cols.push({ bits, fresh: 1 });
        if (cols.length > capacity()) cols.shift();
      };

      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        if (e.key === 'Enter') { punch(' '); punch(' '); return; }
        if (e.key.length !== 1) return;
        punch(e.key);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // The tape creeps even when nothing is being typed — the motor is
        // running. Two pixels a second is slow enough that it reads as drift
        // rather than as the theme doing something.
        feed += dt * 2;
        while (feed >= PITCH) {
          feed -= PITCH;
          cols.push({ bits: 0x00, fresh: 0 });   // blank run-out
          if (cols.length > capacity()) cols.shift();
        }

        ctx.clearRect(0, 0, c.w, c.h);

        const top = c.h - TAPE_H - 26;
        const right = c.w - 18;

        // The tape itself. Oiled paper is not white and not flat: it is warm
        // grey with the edges catching more light than the middle.
        const g = ctx.createLinearGradient(0, top, 0, top + TAPE_H);
        g.addColorStop(0, 'rgba(198,190,172,0.92)');
        g.addColorStop(0.5, 'rgba(176,168,150,0.92)');
        g.addColorStop(1, 'rgba(190,182,164,0.92)');
        ctx.fillStyle = g;
        ctx.fillRect(0, top, c.w, TAPE_H);
        ctx.fillStyle = 'rgba(60,56,48,0.35)';
        ctx.fillRect(0, top, c.w, 1);
        ctx.fillRect(0, top + TAPE_H - 1, c.w, 1);

        // Row centres: bits 1,2, sprocket, 3,4,5.
        const rows = [];
        for (let i = 0; i < 6; i++) rows.push(top + 7 + i * ((TAPE_H - 14) / 5));
        const SPROCKET = 2;

        for (let i = cols.length - 1; i >= 0; i--) {
          const col = cols[i];
          const x = right - (cols.length - 1 - i) * PITCH - feed;
          if (x < -PITCH) break;
          if (x > c.w + PITCH) continue;

          // The feed hole is punched the whole length of the tape whether
          // there is a character on it or not.
          ctx.fillStyle = 'rgba(16,15,14,0.88)';
          ctx.beginPath();
          ctx.arc(x, rows[SPROCKET], 1.5, 0, Math.PI * 2);
          ctx.fill();

          if (!col.bits) continue;
          for (let bit = 0; bit < 5; bit++) {
            if (!(col.bits & (1 << bit))) continue;
            const r = rows[bit < 2 ? bit : bit + 1];
            ctx.fillStyle = 'rgba(16,15,14,0.88)';
            ctx.beginPath();
            ctx.arc(x, r, 2.6, 0, Math.PI * 2);
            ctx.fill();
            // A punched hole has a bright lower lip where the light gets
            // under the burr the die left.
            ctx.strokeStyle = 'rgba(230,224,206,0.35)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.arc(x, r + 0.4, 2.8, 0.35, Math.PI - 0.35);
            ctx.stroke();
          }

          // Freshly punched columns glow for a moment under the die.
          if (col.fresh > 0) {
            col.fresh = Math.max(0, col.fresh - dt * 2.2);
            ctx.fillStyle = 'rgba(194,178,128,' + (col.fresh * 0.28).toFixed(3) + ')';
            ctx.fillRect(x - PITCH / 2, top, PITCH, TAPE_H);
          }
        }

        // The punch block, sitting over the tape at the right. It is the only
        // thing in the scene that is machined rather than paper, so it gets a
        // hard edge and a cold highlight.
        const bw = 26;
        ctx.fillStyle = 'rgba(48,46,42,0.94)';
        ctx.fillRect(right - bw / 2, top - 10, bw, TAPE_H + 20);
        ctx.fillStyle = 'rgba(96,92,84,0.9)';
        ctx.fillRect(right - bw / 2, top - 10, 2, TAPE_H + 20);
        ctx.fillStyle = 'rgba(20,19,17,0.9)';
        ctx.fillRect(right + bw / 2 - 2, top - 10, 2, TAPE_H + 20);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };
  // ────────────────────────────────────────────────────────────────────────
  // Last Train — a country platform at the end of the service, in snow.
  //
  // The first version of this had six bands of scenery stacked up the frame
  // and read as stripes. What fixed it was throwing most of it away: one
  // treeline, one field, one track, one platform, and two lamps. A console
  // scene of this kind is carried by a small number of large dark shapes with
  // a very small number of warm lights in them, and every extra piece of
  // furniture takes contrast away from the lights rather than adding to the
  // place.
  //
  // The lighting rule, from Barrel Fire: cones are blended, never stippled,
  // and everything a cone does not reach is blue. The yellow platform edge is
  // the only saturated line in the picture and it is what tells you where you
  // are standing.
  //
  // The train is on your writing. Each keystroke winds the counter; when it
  // fills, the headlight appears down the line. Sit still and you are on an
  // empty platform with the snow coming down. It does not stop — that is the
  // point of the last one.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.lasttrain = {
    start() {
      const b = back();
      if (!b) return;
      const R = makeRetro(b, 4);

      const SKY = [[6, 7, 16], [10, 12, 26], [15, 18, 38], [23, 27, 52], [34, 38, 66]];
      const MOON = [238, 242, 252];
      const TREE = [7, 9, 16];
      const TREE_LIT = [16, 20, 32];
      const FIELD = [26, 32, 48];
      const FIELD_HI = [38, 46, 66];
      const FENCE = [14, 16, 22];
      const BALLAST = [16, 17, 21];
      const BALLAST_HI = [24, 26, 31];
      const RAIL = [120, 126, 138];
      const RAIL_DIM = [58, 62, 70];
      const SLEEPER = [30, 26, 23];
      const PLAT = [22, 24, 31];
      const PLAT_HI = [32, 35, 44];
      const PLAT_SNOW = [44, 52, 70];
      const EDGE = [230, 186, 58];
      const EDGE_DIM = [128, 104, 34];
      const LAMP = [255, 226, 158];
      const POST = [13, 14, 19];
      const SHELTER = [17, 18, 24];
      const SHELTER_HI = [30, 32, 40];
      const BOARD = [10, 20, 16];
      const BOARD_TXT = [120, 226, 158];
      const TRAIN = [17, 18, 25];
      const TRAIN_HI = [38, 41, 54];
      const TRAIN_LO = [9, 10, 15];
      const WINDOW = [252, 234, 180];
      const PASSENGER = [28, 22, 18];
      const SIGNAL_R = [232, 68, 56];
      const SIGNAL_G = [86, 222, 128];
      const SNOW = [206, 218, 240];
      const SNOW_WARM = [252, 228, 176];

      let treeBase = 0, fieldY = 0, trackY = 0, platY = 0;
      let trees = [], lamps = [], flakes = [], puffs = [];
      let train = null, signal = 0;
      let t = 0, nextFrame = 0;

      // What the window being dragged does to the scene. Three things, and
      // they are deliberately different from each other: the snow is loose so
      // it gets thrown sideways and keeps going, the lamps are hung so they
      // swing and settle, and the train is on springs so it rocks. Giving all
      // three the same response is what makes a shake effect look like a
      // shake effect rather than like a place.
      let gust = 0;                    // lateral push on the snow
      let swing = 0, swingV = 0;       // the lamps on their brackets
      let rock = 0, rockV = 0;         // the train on its bogies
      this._unshove = onShove((dx, dy) => {
        gust -= dx * 0.05;
        swingV -= dx * 0.010;
        rockV += dy * 0.045 + Math.abs(dx) * 0.012;
      });

      const build = (prevW, prevH) => {
        treeBase = Math.round(R.H * 0.46);
        fieldY = Math.round(R.H * 0.46);
        trackY = Math.round(R.H * 0.605);
        platY = Math.round(R.H * 0.66);

        // Conifers, not blocks. A skyline of rectangles is a town; the whole
        // difference between that and open country is that the silhouette
        // comes to points.
        trees = [];
        for (let x = -4; x < R.W + 8;) {
          const halfW = 3 + Math.round(R.hash(x, 3) * 5);
          const h = Math.round(R.H * 0.06) + Math.round(R.hash(x, 9) * R.H * 0.10);
          trees.push({ cx: x + halfW, halfW, h });
          x += halfW * 2 - 1 - Math.round(R.hash(x, 5) * 2);
        }

        // Two lamps. Three was one too many: their cones met in the middle and
        // the platform lit evenly, which is the one thing a row of sodium
        // lamps never looks like.
        lamps = [
          { x: Math.round(R.W * 0.44) },
          { x: Math.round(R.W * 0.72) }
        ];
        for (const L of lamps) L.h = Math.round(R.H * 0.28) + Math.round(R.hash(L.x, 7) * 3);

        const want = Math.round((R.W * R.H) / 230);
        if (prevW && prevH && prevW !== R.W) {
          const sx = R.W / prevW, sy = R.H / prevH;
          for (const f of flakes) { f.x *= sx; f.y *= sy; }
          if (train) train.x *= sx;
        }
        while (flakes.length < want) {
          const z = Math.random();
          flakes.push({
            x: Math.random() * R.W, y: Math.random() * R.H,
            z, v: 0.05 + z * 0.15, sway: Math.random() * 6.28, big: z > 0.76
          });
        }
        if (flakes.length > want) flakes.length = want;
      };
      const resize = () => {
        const pw = R.W, ph = R.H;
        R.resize();
        build(pw, ph);
        nextFrame = 0;
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        if (train) return;
        signal = Math.min(1, signal + 0.020);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // A window with somebody behind it: a solid 1x2 opening with a soft
      // blended falloff around it, squashed vertically. Worked out in Barrel
      // Fire — a single bright pixel is a star, this is a room.
      const litWindow = (wx, wy, col, strength) => {
        for (let dy = -2; dy <= 3; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && (dy === 0 || dy === 1)) continue;
            const d = Math.hypot(dx * 1.35, (dy - 0.5) * 0.75);
            const f = 1 - d / 2.9;
            if (f > 0) R.blend(wx + dx, wy + dy, col, f * f * 0.34 * strength);
          }
        }
        R.rect(wx, wy, 1, 2, col);
      };

      const cap = (x0, w, y, depth) => {
        for (let i = 0; i < w; i++) {
          const x = x0 + i;
          const d = Math.max(1, Math.round((depth || 1) + R.hash(x, y) * 1.3 - 0.4));
          for (let j = 0; j < d; j++) R.px(x, y - d + 1 + j, j === d - 1 ? PLAT_SNOW : SNOW);
        }
      };

      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / 15;
        t += 1;

        // Fixed step: this scene runs at a console's fifteen frames a second,
        // so there is no point integrating against a real clock.
        const dt = 1 / 15;
        swingV -= swing * 34 * dt;
        swingV *= Math.pow(0.22, dt);
        swing += swingV * dt;
        swing = Math.max(-0.9, Math.min(0.9, swing));
        rockV -= rock * 60 * dt;
        rockV *= Math.pow(0.06, dt);
        rock += rockV * dt;
        rock = Math.max(-2.2, Math.min(2.2, rock));
        gust *= Math.pow(0.25, dt);

        // ── sky, moon, one slow bank of cloud
        R.vgrad(0, fieldY, SKY, 0.85);
        // Low in the sky, just clear of the treeline: high up it sits behind
        // the note text, which is the one place in the window you cannot use.
        const mx = Math.round(R.W * 0.62), my = Math.round(R.H * 0.29);
        for (let dy = -7; dy <= 7; dy++) {
          for (let dx = -7; dx <= 7; dx++) {
            const d = Math.hypot(dx, dy);
            if (d < 3.6) R.px(mx + dx, my + dy, MOON);
            else if (d < 7.5) R.blend(mx + dx, my + dy, MOON, (1 - (d - 3.6) / 3.9) * 0.16);
          }
        }
        for (let i = 0; i < 3; i++) {
          const cxx = ((t * 0.05 + i * 53) % (R.W + 60)) - 30;
          const cyy = my - 4 + i * 4;
          for (let dx = 0; dx < 30 - i * 6; dx++) {
            for (let dy = 0; dy < 2; dy++) {
              R.blend(cxx + dx, cyy + dy, [46, 52, 78], 0.30 * Math.sin((dx / (30 - i * 6)) * Math.PI));
            }
          }
        }

        // ── the treeline
        for (const tr of trees) {
          for (let dx = -tr.halfW; dx <= tr.halfW; dx++) {
            const x = tr.cx + dx;
            if (x < 0 || x >= R.W) continue;
            const hh = Math.round(tr.h * (1 - Math.abs(dx) / (tr.halfW + 0.6)));
            for (let y = treeBase - hh; y < fieldY; y++) R.px(x, y, TREE);
            // A rim of moonlight down the side facing the moon.
            if (dx === (tr.cx < mx ? tr.halfW : -tr.halfW)) {
              for (let y = treeBase - hh; y < treeBase - hh + 3; y++) R.px(x, y, TREE_LIT);
            }
          }
        }

        // ── the field between the trees and the line
        for (let x = 0; x < R.W; x++) {
          for (let y = fieldY; y < trackY - 7; y++) {
            R.px(x, y, R.hash(x, y) > 0.88 ? FIELD_HI : FIELD);
          }
        }
        // A post-and-wire fence along it. Two wires and a post every eight
        // cells is enough to say "the field ends here" and it is the only
        // horizontal in the upper half, which is what gives the distance.
        const fy = trackY - 12;
        for (let x = 0; x < R.W; x++) {
          R.blend(x, fy + 1, FENCE, 0.75);
          R.blend(x, fy + 4, FENCE, 0.6);
          if ((x % 8) === 0) for (let y = fy; y < fy + 6; y++) R.px(x, y, FENCE);
        }

        // ── ballast and the running line
        for (let x = 0; x < R.W; x++) {
          for (let y = trackY - 7; y < platY; y++) {
            R.px(x, y, R.hash(x, y + 3) > 0.82 ? BALLAST_HI : BALLAST);
          }
        }
        for (let x = 0; x < R.W; x += 4) {
          for (let i = 0; i < 3; i++) { R.px(x + i, trackY - 3, SLEEPER); R.px(x + i, trackY + 2, SLEEPER); }
        }
        for (let x = 0; x < R.W; x++) {
          R.px(x, trackY - 5, RAIL_DIM); R.px(x, trackY - 4, RAIL);
          R.px(x, trackY, RAIL_DIM); R.px(x, trackY + 1, RAIL);
        }

        // ── the signal, trackside
        const sgX = Math.round(R.W * 0.90);
        for (let y = trackY - 26; y < trackY - 6; y++) R.px(sgX, y, POST);
        const sc = (train || signal > 0.5) ? SIGNAL_G : SIGNAL_R;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const d = Math.hypot(dx, dy);
            if (d < 1.7) R.px(sgX + dx, trackY - 27 + dy, sc);
            else if (d < 4.5) R.blend(sgX + dx, trackY - 27 + dy, sc, (1 - d / 4.5) * 0.4);
          }
        }

        // ── the train.
        //
        // Drawn here, between the track and the platform, because that is where
        // it is standing. It used to be drawn last, which put a train in front
        // of the lamp posts, the bench and the departure board — everything on
        // the near platform, all of which is between you and the line.
        if (!train) {
          // A train even when nobody is writing, about once a minute. It is
          // the last service, not an abandoned line, and the arrival is the
          // whole payoff of the scene — waiting two minutes for one while
          // sitting still meant never seeing it.
          signal = Math.min(1, signal + 0.0011);
          if (signal >= 1) {
            const cars = 4 + Math.floor(Math.random() * 3);
            const len = 44 + cars * 42;
            // Clear of the edge by its own length. `x` is the *tail*, so
            // starting at -50 put two hundred pixels of train already on
            // screen on the first frame — it did not arrive, it appeared.
            train = { x: -len - 30, cars, len, lit: [] };
            for (let i = 0; i < cars; i++) train.lit.push(R.hash(i * 31, 5) > 0.25);
            signal = 0;
          }
        }
        if (!train && signal > 0.5) {
          // Down the line to the *left*, because that is the end the train
          // comes in from. It was on the right, so the announcement and the
          // arrival came from opposite directions.
          const glow = (signal - 0.5) / 0.5;
          for (let dy = -6; dy <= 6; dy++) {
            for (let dx = -3; dx <= 12; dx++) {
              const d = Math.hypot(dx * 0.55, dy);
              R.blend(3 + dx, trackY - 10 + dy, LAMP, Math.max(0, 1 - d / 9) * glow * 0.5);
            }
          }
        }

        if (train) {
          train.x += 4.2;
          const r = Math.round(rock);
          const y0 = trackY - 30 + r, y1 = trackY - 5 + r;
          const headX = train.x + train.len;

          for (let dx = 0; dx < 40; dx++) {
            const x = headX + dx;
            if (x >= R.W) break;
            const f = 1 - dx / 40;
            for (let dy = -8; dy <= 10; dy++) {
              R.blend(x, trackY - 10 + dy, LAMP, f * f * 0.28 * (1 - Math.abs(dy) / 11));
            }
          }

          for (let x = Math.max(0, train.x | 0); x < Math.min(R.W, headX); x++) {
            const local = x - train.x;
            for (let y = y0; y < y1; y++) {
              R.px(x, y, y < y0 + 2 ? TRAIN_HI : (y > y1 - 5 ? TRAIN_LO : TRAIN));
            }
            const inBogie = (local % 42);
            if ((inBogie > 6 && inBogie < 14) || (inBogie > 28 && inBogie < 36)) {
              for (let y = y1; y < trackY - 1; y++) R.px(x, y, TRAIN_LO);
            }

            const car = Math.floor(local / 42);
            const inCar = local - car * 42;
            if (train.lit[car % train.lit.length] && inCar > 5 && inCar < 37 && (inCar % 10) < 8) {
              for (let y = y0 + 7; y < y0 + 16; y++) R.px(x, y, WINDOW);
              if (R.hash(car * 53 + ((inCar / 10) | 0), 3) > 0.55 && (inCar % 10) > 2 && (inCar % 10) < 6) {
                for (let y = y0 + 10; y < y0 + 16; y++) R.px(x, y, PASSENGER);
              }
              for (let y = trackY - 4; y < trackY + 5; y++) R.blend(x, y, WINDOW, 0.13);
              for (let y = platY; y < platY + 8; y++) R.blend(x, y, WINDOW, 0.08);
            }
          }
          if (t % 2 === 0) puffs.push({ x: train.x, y: trackY - 3, v: -0.5 - Math.random(), r: 1, life: 1 });
          if (train.x > R.W + 20) train = null;
        }
        puffs = puffs.filter((p) => {
          p.y += p.v; p.x -= 0.4; p.r += 0.3; p.life -= 0.06;
          if (p.life <= 0) return false;
          const rr = Math.max(1, Math.round(p.r));
          for (let dy = -rr; dy <= rr; dy++) {
            for (let dx = -rr; dx <= rr; dx++) {
              const d = Math.hypot(dx, dy) / rr;
              if (d <= 1) R.blend(p.x + dx, p.y + dy, SNOW, (1 - d) * p.life * 0.28);
            }
          }
          return true;
        });

        // ── the platform, and the one saturated line in the picture
        for (let x = 0; x < R.W; x++) {
          for (let y = platY; y < R.H; y++) {
            R.px(x, y, R.hash(x, y + 41) > 0.86 ? PLAT_HI : PLAT);
          }
          R.px(x, platY, EDGE_DIM);
          R.px(x, platY + 2, EDGE);
          R.px(x, platY + 3, EDGE_DIM);
          // Untrodden snow further back from the edge.
          const sy = platY + 9 + Math.round(R.hash(x, 13) * 4);
          if (R.hash(x, 61) > 0.3 && sy < R.H) { R.px(x, sy, PLAT_SNOW); R.px(x, sy + 1, PLAT_SNOW); }
        }

        // ── shelter, bench, bin: dark silhouettes standing on the platform
        const shX = Math.round(R.W * 0.23), shW = Math.round(R.W * 0.15);
        const shTop = platY - Math.round(R.H * 0.17);
        for (let x = shX; x < shX + shW; x++) {
          for (let y = shTop; y < platY + 6; y++) {
            R.px(x, y, (x === shX || x === shX + shW - 1) ? SHELTER_HI : SHELTER);
          }
        }
        for (let x = shX + 3; x < shX + shW - 3; x += 5) litWindow(x, shTop + 5, WINDOW, 0.5);
        cap(shX - 1, shW + 2, shTop, 2);

        const beX = Math.round(R.W * 0.60);
        for (let x = beX; x < beX + 13; x++) {
          for (let y = platY + 8; y < platY + 10; y++) R.px(x, y, [44, 34, 26]);
          if ((x - beX) % 6 === 0) for (let y = platY + 10; y < platY + 15; y++) R.px(x, y, [30, 24, 18]);
        }
        cap(beX, 13, platY + 8, 1);

        // ── departure board on its post
        const bX = Math.round(R.W * 0.52), bW = Math.round(R.W * 0.15);
        const bTop = platY - Math.round(R.H * 0.15);
        if (bX + bW < R.W) {
          for (let y = bTop; y < bTop + Math.round(R.H * 0.09); y++) {
            for (let x = bX; x < bX + bW; x++) R.px(x, y, BOARD);
          }
          for (let r = 0; r < 3; r++) {
            const ly = bTop + 2 + r * 3;
            for (let x = bX + 2; x < bX + bW - 2; x++) {
              if (R.hash(x + r * 17, r) > 0.42) R.blend(x, ly, BOARD_TXT, 0.8);
            }
          }
          for (let y = bTop + Math.round(R.H * 0.09); y < platY + 4; y++) {
            R.px(bX + 3, y, POST); R.px(bX + bW - 4, y, POST);
          }
          cap(bX, bW, bTop, 1);
        }

        // ── the lamps. Tall posts against the sky, warm heads, and a cone
        // that is *narrow* — a wide one lights the platform evenly and the
        // whole point of sodium on a country platform is that most of it is
        // in the dark.
        const cones = [];
        for (const L of lamps) {
          const topY = platY + 4 - L.h;
          for (let y = topY; y < platY + 4; y++) { R.px(L.x, y, POST); R.px(L.x + 1, y, POST); }
          for (let i = 0; i < 5; i++) R.px(L.x + i, topY, POST);
          R.px(L.x + 5, topY + 1, POST);
          const hx = L.x + 5 + swing * 3, hy = topY + 2;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) R.blend(hx + dx, hy + dy, LAMP, 0.95 - Math.hypot(dx, dy) * 0.3);
          }
          cones.push({ x: hx, y: hy });
          for (let y = hy; y < R.H; y++) {
            const k = (y - hy) / Math.max(1, R.H - hy);
            const spread = 1.5 + k * R.H * 0.075;
            for (let dx = -spread; dx <= spread; dx++) {
              const across = 1 - Math.abs(dx) / spread;
              if (across <= 0) continue;
              R.blend((hx + dx) | 0, y, LAMP, across * across * (1 - k * 0.7) * 0.34);
            }
          }
        }

        // ── snow, dim unless a cone has it
        for (const f of flakes) {
          f.y += f.v;
          f.x += Math.sin(f.sway + t * 0.03) * 0.12 - 0.06 + gust * (0.4 + f.z);
          if (f.y > R.H) { f.y = -1; f.x = Math.random() * R.W; }
          if (f.x < 0) f.x = R.W;
          let warm = false;
          for (const c of cones) {
            if (f.y > c.y && Math.abs(f.x - c.x) < 1.5 + ((f.y - c.y) / Math.max(1, R.H - c.y)) * R.H * 0.075) { warm = true; break; }
          }
          const a = (warm ? 0.34 : 0.13) + f.z * (warm ? 0.55 : 0.26);
          const col = warm ? SNOW_WARM : SNOW;
          R.blend(f.x, f.y, col, a);
          if (f.big) { R.blend(f.x + 1, f.y, col, a * 0.75); R.blend(f.x, f.y + 1, col, a * 0.75); }
        }

        R.flush();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._unshove) this._unshove();
      this._resize = null; this._onKey = null; this._unshove = null;
    }
  };
  // ──────────────────────────────────────────────────────────────────────
  // Snow Street '97 — a corner market on a snowy night street at PlayStation
  // resolution: sodium lamps, a backlit sign, a neon OPEN with a dying E,
  // the city skyline behind, cars and a pedestrian passing through the light.
  //
  // The idea that carries it: nothing is painted lit. Every surface goes
  // down in its unlit night colour — the snow is dark blue, the brick is
  // near black, the road is slush grey — and every light source (two lamps,
  // the shop window, the neon, each passing car's headlights) is then added
  // per cell as a distance-falloff blend. That is why the snow turns white
  // only inside the lamp pools, why a headlight beam sweeps across the
  // drifts as the car passes, and why the falling flakes brighten only
  // while they cross a beam. Real ray tracing is not possible in a software
  // framebuffer at 15fps, so this is the nearest honest thing: point lights
  // with falloff, a projected ground shadow for the pedestrian, light that
  // is computed rather than drawn. The obvious way — sprites with the glow
  // baked in — makes the snow white everywhere, and the contrast between
  // lit and unlit snow is the entire picture.
  // ──────────────────────────────────────────────────────────────────────
  RUNTIMES.snowstreet = {
    start() {
      const b = back();
      if (!b) return;
      const R = makeRetro(b, 4);
      const FPS = 15;

      // Clipped primitives. One out-of-range write inside the tick would end
      // the theme for good, and half of what is drawn here moves (cars run
      // off both edges, smoke drifts above the top), so nothing below talks
      // to the renderer without going through these.
      const P = (x, y, c) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < R.W && y < R.H) R.px(x, y, c); };
      const B = (x, y, c, a) => { if (!(a > 0.003)) return; x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < R.W && y < R.H) R.blend(x, y, c, a > 1 ? 1 : a); };
      const RECT = (x, y, w, h, c) => {
        x = Math.floor(x); y = Math.floor(y);
        const x1 = Math.min(R.W, x + Math.ceil(w)), y1 = Math.min(R.H, y + Math.ceil(h));
        for (let yy = Math.max(0, y); yy < y1; yy++) for (let xx = Math.max(0, x); xx < x1; xx++) R.px(xx, yy, c);
      };
      const STIP = (x, y, w, h, c, cover) => {
        x = Math.floor(x); y = Math.floor(y);
        const x1 = Math.min(R.W, x + Math.ceil(w)), y1 = Math.min(R.H, y + Math.ceil(h));
        for (let yy = Math.max(0, y); yy < y1; yy++) for (let xx = Math.max(0, x); xx < x1; xx++) if (R.hash(xx, yy) < cover) R.px(xx, yy, c);
      };

      // A soft radial blend. `sq` squashes it vertically so one routine does
      // both the halo in the air (round: snow in the air scatters the lamp)
      // and the pool on the ground (flat ellipse: the ground is foreshortened).
      // The clip keeps a lamp from lighting the sky through a wall.
      const glow = (cx, cy, r, col, a, sq, clip) => {
        const ry = r * sq;
        let x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
        if (clip) { x0 = Math.max(x0, clip[0]); y0 = Math.max(y0, clip[1]); x1 = Math.min(x1, clip[2]); y1 = Math.min(y1, clip[3]); }
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(R.W - 1, x1); y1 = Math.min(R.H - 1, y1);
        for (let y = y0; y <= y1; y++) {
          const dy = (y - cy) / ry;
          for (let x = x0; x <= x1; x++) {
            const dx = (x - cx) / r;
            const d = dx * dx + dy * dy;
            if (d >= 1) continue;
            const f = 1 - Math.sqrt(d);
            R.blend(x, y, col, Math.min(1, a * f * f));
          }
        }
      };

      // Unlit night colours. Everything starts this dark; the lights lift it.
      const C = {
        curb: [48, 52, 66], rut: [16, 18, 26], slush: [40, 42, 54],
        brick: [58, 34, 38], mortar: [28, 18, 22], wood: [34, 28, 32],
        warm: [255, 216, 160], lampCore: [255, 238, 200], cool: [140, 170, 215],
        neon: [255, 72, 132], interior: [214, 168, 100], glass: [30, 40, 60], red: [255, 48, 40]
      };
      const SKY = [[3, 5, 12], [7, 10, 22], [12, 16, 34], [22, 22, 44], [40, 32, 52], [66, 48, 58]];
      const CARS = [[118, 30, 30], [40, 60, 110], [148, 148, 150], [58, 58, 68], [140, 108, 40], [30, 90, 70]];
      const PROD = [[204, 62, 52], [62, 140, 204], [232, 202, 66], [88, 178, 92], [238, 236, 230], [200, 120, 40]];
      // 3x5 glyphs; only the letters the scene needs. A full font is dead weight.
      const FONT = {
        M: ['101', '111', '101', '101', '101'], A: ['010', '101', '111', '101', '101'], R: ['110', '101', '110', '101', '101'],
        K: ['101', '101', '110', '101', '101'], E: ['111', '100', '110', '100', '111'], T: ['111', '010', '010', '010', '010'],
        O: ['111', '101', '101', '101', '111'], P: ['111', '101', '111', '100', '100'], N: ['111', '101', '101', '101', '101']
      };
      const text = (str, x, y, col, a, halo) => {
        for (let k = 0; k < str.length; k++) {
          const g = FONT[str[k]];
          if (!g) continue;
          for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
            if (g[r][c] !== '1') continue;
            const px = x + k * 4 + c, py = y + r;
            if (halo) { B(px - 1, py, col, a * 0.28); B(px + 1, py, col, a * 0.28); B(px, py - 1, col, a * 0.28); B(px, py + 1, col, a * 0.28); }
            B(px, py, col, a);
          }
        }
      };

      const S = {
        t: 0, frame: 0, wind: -3, gust: 0, shove: 0, warned: false,
        flakes: [], smoke: [], clumps: [], flips: new Map(),
        car: null, nextCar: 2.5, walker: null, nextWalker: 6,
        keeper: { x: 0.65, tx: 0.65, wait: 2 },
        smokeAcc: 0, exhaustAcc: 0
      };

      // ── layout: everything size-derived lives here ──────────────────────
      const L = {};
      const layout = () => {
        const W = R.W, H = R.H;
        L.W = W; L.H = H;
        L.hz = Math.floor(H * 0.46);                       // the far city stands on this line
        L.fx0 = Math.floor(W * 0.29); L.fx1 = Math.floor(W * 0.685);   // shop sits in the clear middle, between the two panels
        L.fTop = Math.floor(H * 0.40); L.fBot = Math.floor(H * 0.64);  // one storey: the skyline shows above its roof
        L.sw1 = Math.floor(H * 0.71);                      // kerb: sidewalk above, road below
        L.wx0 = L.fx0 + 5; L.wx1 = L.fx1 - 16; L.wy0 = L.fTop + 15; L.wy1 = L.fBot - 3;
        L.winCx = (L.wx0 + L.wx1) / 2; L.winCy = (L.wy0 + L.wy1) / 2;
        L.dx0 = L.fx1 - 13; L.dx1 = L.fx1 - 6;
        L.lamps = [
          { x: Math.floor(W * 0.335), head: Math.floor(H * 0.30) },
          { x: Math.floor(W * 0.645), head: Math.floor(H * 0.30) }
        ];
        L.lanes = [L.sw1 + 6, L.sw1 + Math.floor((H - L.sw1) * 0.5)];

        // Skyline from hash per block, not from a curve: blocks read as
        // buildings, a curve reads as a hill. A downtown hump in the middle
        // gives the row a shape instead of noise.
        L.city = []; let x = 0, i = 0, tallest = null;
        while (x < W) {
          const w = 3 + Math.floor(R.hash(i, 11) * 7);
          const h2 = R.hash(i, 23);
          let h = 3 + Math.floor(h2 * h2 * H * 0.10);
          if (R.hash(i, 37) > 0.84) h += Math.floor(H * (0.06 + R.hash(i, 41) * 0.14));
          h = Math.max(2, Math.floor(h * (0.6 + 0.9 * Math.max(0, 1 - Math.abs((x + w / 2) / W - 0.5) * 2))));
          const bd = { x, w, h, i, tone: R.hash(i, 53) };
          L.city.push(bd);
          if (!tallest || h > tallest.h) tallest = bd;
          x += w; i++;
        }
        L.tower = tallest ? { x: tallest.x + Math.floor(tallest.w / 2), y: L.hz - tallest.h - 1 } : null;

        L.stars = [];
        const sy1 = Math.floor(L.hz * 0.7);
        for (let y = 0; y < sy1; y++) for (let xx = 0; xx < W; xx++) if (R.hash(xx, y) > 0.993) L.stars.push({ x: xx, y, s: R.hash(y, xx) });
      };

      // One flake per ~200 cells: weather, not static.
      const flakeCount = () => Math.floor(R.W * R.H / 200);
      const newFlake = (y) => ({ x: Math.random() * R.W, y: y === undefined ? Math.random() * R.H : y, z: 0.3 + Math.random() * 0.7, ph: Math.random() * 6.283 });

      R.resize();
      layout();
      for (let i = 0; i < flakeCount(); i++) S.flakes.push(newFlake());

      // ── lighting queries shared by flakes, walker, car ──────────────────
      // Light in the air at (x,y): lamps, the shop window, and a headlight
      // fan if a car is on the road. This is what makes a flake brighten
      // as it drifts under a lamp and go dark again below it.
      const lightAt = (x, y) => {
        let l = 0;
        for (const lp of L.lamps) { const dx = (x - lp.x) / 15, dy = (y - lp.head - 2) / 26; l += 1.3 / (1 + 1.6 * (dx * dx + dy * dy)) - 0.08; }
        { const dx = (x - L.winCx) / 24, dy = (y - L.winCy) / 12; l += 0.55 / (1 + 2 * (dx * dx + dy * dy)) - 0.05; }
        if (S.car) {
          const cy = L.lanes[S.car.lane] + 2, fx = S.car.dir > 0 ? S.car.x + 15 : S.car.x;
          const a = (x - fx) * S.car.dir;
          if (a > 0 && a < 34) { const v = 1 - Math.abs(y - cy) / (2 + a * 0.25); if (v > 0) l += 0.9 * (1 - a / 34) * v; }
        }
        return l > 0 ? l : 0;
      };
      // Lamp light reaching the ground at column x (same falloff as the pools).
      const groundLit = (x) => { let l = 0; for (const lp of L.lamps) { const d = 1 - Math.abs(x - lp.x) / 27; if (d > 0) l += d * d; } return l; };

      // ── scene ──────────────────────────────────────────────────────────
      const drawSky = () => {
        R.vgrad(0, L.hz, SKY, 1.7);   // curve > 1 keeps the warm city glow hugging the horizon instead of washing the whole sky
        for (const s of L.stars) {
          const tw = 0.5 + 0.5 * Math.sin(S.t * (0.8 + s.s * 2.5) + s.s * 40);
          B(s.x, s.y, [205, 212, 240], 0.2 + 0.5 * tw * s.s);
        }
        // The city's own light on the low cloud, strongest over downtown mid-frame.
        const W = L.W, y0 = L.hz - 16;
        for (let y = y0; y < L.hz; y++) {
          const f = (y - y0) / 16;
          for (let x = 0; x < W; x++) {
            const cx = Math.max(0, 1 - Math.abs(x / W - 0.5) * 1.6);
            B(x, y, [130, 84, 74], f * f * 0.4 * (0.35 + 0.65 * cx));
          }
        }
      };

      const drawCity = () => {
        const hz = L.hz;
        for (const bd of L.city) {
          const top = hz - bd.h;
          RECT(bd.x, top, bd.w, bd.h, [15 + bd.tone * 8, 17 + bd.tone * 7, 31 + bd.tone * 10]);
          for (let x = bd.x; x < bd.x + bd.w; x++) B(x, top, [70, 80, 110], 0.5);   // snow on every roof
          if (bd.h > 4 && bd.w > 2) {
            for (let wy = top + 2; wy < hz - 1; wy += 2) for (let wx = bd.x + 1; wx < bd.x + bd.w - 1; wx += 2) {
              const ph = R.hash(wx * 3 + 1, wy * 5 + 2);
              // Most windows are fixed; a few switch on a slow personal clock so the city breathes.
              let lit = ph < 0.30 || (ph > 0.92 && ((Math.floor(S.t / (3 + ph * 6) + ph * 20) & 1) === 0));
              const fl = S.flips.get(wx * 4096 + wy);
              if (fl !== undefined && fl > S.t) lit = !lit;
              if (!lit) continue;
              B(wx, wy, R.hash(wy, wx) > 0.72 ? C.cool : [232, 190, 122], 0.55);
            }
          }
        }
        if (L.tower && (S.t % 1.6) < 0.18) { P(L.tower.x, L.tower.y, C.red); glow(L.tower.x, L.tower.y, 3, C.red, 0.5, 1); }
        // Distance haze: the bottoms of the far buildings dissolve into the snow-lit air.
        for (let y = hz - 9; y <= hz; y++) { const f = (y - (hz - 9)) / 9; for (let x = 0; x < L.W; x++) B(x, y, [46, 44, 68], f * 0.45); }
      };

      const drawGround = () => {
        const W = L.W, H = L.H, fBot = L.fBot, sw1 = L.sw1;
        RECT(0, L.hz, W, fBot - L.hz, [13, 15, 25]);
        // Sidewalk snow: dark blue. It becomes white only where the pools land.
        R.vgrad(fBot, sw1, [[27, 37, 62], [31, 43, 72]], 1);
        STIP(0, fBot, W, sw1 - fBot, [36, 48, 80], 0.22);
        for (let x = 0; x < W; x += 3) if (R.hash(x, 71) < 0.5) B(x + (R.hash(x, 72) < 0.5 ? 0 : 1), fBot + 3 + ((x / 3) & 1) * 2, [18, 24, 44], 0.6);   // footprints
        RECT(0, sw1, W, 1, C.curb);
        R.vgrad(sw1 + 1, H, [[22, 25, 36], [27, 30, 41], [32, 34, 46]], 1);
        STIP(0, sw1 + 1, W, H - sw1 - 1, C.slush, 0.10);
        RECT(0, sw1 + 1, W, 2, [33, 43, 68]); STIP(0, sw1 + 3, W, 1, [33, 43, 68], 0.5);   // plough bank against the kerb
        for (const ly of L.lanes) { RECT(0, ly + 5, W, 1, C.rut); STIP(0, ly + 4, W, 1, C.rut, 0.4); }   // ruts exactly where the wheels run
      };

      const drawNeighbours = () => {
        const W = L.W, H = L.H, fx0 = L.fx0, fx1 = L.fx1, fBot = L.fBot;
        const lt = Math.floor(H * 0.36), rt = Math.floor(H * 0.43);
        RECT(0, lt, fx0, fBot - lt, [23, 19, 29]);
        RECT(0, lt - 1, fx0 + 1, 1, [40, 48, 72]);
        for (let wy = lt + 4; wy < fBot - 4; wy += 5) for (let wx = 3; wx < fx0 - 12; wx += 5) if (R.hash(wx, wy) < 0.14) RECT(wx, wy, 2, 2, [60, 52, 48]);
        // One lit room next door: a 2x3 rectangle with a halo, not a dot.
        glow(fx0 - 8, Math.floor(H * 0.46), 7, C.warm, 0.3, 0.8, [0, lt, fx0 - 1, fBot]);
        RECT(fx0 - 9, Math.floor(H * 0.45), 2, 3, [242, 204, 142]);
        RECT(fx1, rt, W - fx1, fBot - rt, [19, 21, 31]);
        RECT(fx1, rt - 1, W - fx1, 1, [40, 48, 72]);
        // A television upstairs: blue, and it changes when the shot cuts.
        const tv = R.hash(S.frame >> 2, 3), tvc = [70 + tv * 60, 100 + tv * 50, 190 + tv * 40];
        RECT(fx1 + 6, rt + 5, 2, 2, tvc); glow(fx1 + 7, rt + 6, 5, tvc, 0.25, 0.9, [fx1, rt, W - 1, fBot]);
      };

      const drawStoreWall = () => {
        const fx0 = L.fx0, fx1 = L.fx1, fTop = L.fTop, fBot = L.fBot, fw = fx1 - fx0;
        RECT(fx0, fTop, fw, fBot - fTop, C.brick);
        for (let y = fTop; y < fBot; y++) {
          const row = y - fTop;
          for (let x = fx0; x < fx1; x++) {
            if (row % 3 === 0) B(x, y, C.mortar, 0.45);
            else if (((x + (((row / 3) | 0) & 1) * 2) & 3) === 0) B(x, y, C.mortar, 0.3);
          }
        }
        RECT(fx0 - 1, fTop - 2, fw + 2, 2, [38, 38, 50]);
        RECT(fx0 - 1, fTop - 3, fw + 2, 1, [42, 54, 86]);     // snow on the parapet: dark until the lamp finds it
        RECT(fx0 + 9, fTop - 5, 3, 3, [30, 30, 40]);          // vent stack
      };

      const drawStoreFront = () => {
        const fx0 = L.fx0, fx1 = L.fx1, fTop = L.fTop, fBot = L.fBot, fw = fx1 - fx0;
        const wx0 = L.wx0, wx1 = L.wx1, wy0 = L.wy0, wy1 = L.wy1, dx0 = L.dx0, dx1 = L.dx1;
        // Backlit sign. Fluorescent tubes stutter; the whole panel dips at once.
        const flick = R.hash(S.frame, 9) < 0.07 ? 0.55 : 1;
        RECT(fx0 + 3, fTop + 2, fw - 6, 7, [22, 18, 24]);
        RECT(fx0 + 4, fTop + 3, fw - 8, 5, [230 * flick, 200 * flick, 124 * flick]);
        text('MARKET', Math.floor((fx0 + fx1) / 2) - 11, fTop + 3, [70, 30, 22], 1);
        for (let x = fx0 + 3; x < fx1 - 3; x++) { B(x, fTop + 1, C.warm, 0.3 * flick); B(x, fTop, C.warm, 0.12 * flick); B(x, fTop + 9, C.warm, 0.25 * flick); }
        // Awning: stripes in their night colours, snow on top, its own shadow on the brick below.
        for (let x = fx0 + 2; x < fx1 - 2; x++) { const c = ((Math.floor((x - fx0) / 3) & 1) === 0) ? [78, 26, 30] : [92, 86, 88]; for (let y = fTop + 10; y < fTop + 14; y++) P(x, y, c); }
        RECT(fx0 + 2, fTop + 9, fw - 4, 1, [46, 58, 92]);
        RECT(fx0 + 2, fTop + 13, fw - 4, 1, [40, 14, 18]);
        for (let y = fTop + 14; y < fTop + 18; y++) for (let x = fx0 + 1; x < fx1 - 1; x++) B(x, y, [0, 0, 8], 0.4 - (y - fTop - 14) * 0.1);
        for (let x = fx0 + 3; x < fx1 - 3; x++) { const h = R.hash(x, 99); if (h < 0.16) { B(x, fTop + 14, [150, 190, 230], 0.55); if (h < 0.07) B(x, fTop + 15, [150, 190, 230], 0.3); } }   // icicles
        // Shop window: the brightest thing in the picture, so the interior is drawn, not implied.
        RECT(wx0 - 1, wy0 - 1, wx1 - wx0 + 2, wy1 - wy0 + 2, C.wood);
        RECT(wx0, wy0, wx1 - wx0, wy1 - wy0, C.interior);
        RECT(wx0, wy0, wx1 - wx0, 1, [255, 242, 205]);
        for (let k = 0; k < 3; k++) {
          const sy = wy0 + 5 + k * 5;
          if (sy + 1 >= wy1 - 3) break;
          RECT(wx0 + 1, sy + 1, wx1 - wx0 - 2, 1, [96, 64, 40]);
          for (let x = wx0 + 2; x < wx1 - 2; x++) { const h = R.hash(x, sy); if (h < 0.85) P(x, sy, PROD[Math.floor(h * 7) % PROD.length]); }
        }
        RECT(wx0 + 1, wy1 - 3, wx1 - wx0 - 2, 3, [122, 82, 52]);   // counter
        const kx = Math.floor(wx0 + 4 + S.keeper.x * (wx1 - wx0 - 10));
        RECT(kx, wy1 - 9, 3, 6, [46, 34, 40]); RECT(kx + 1, wy1 - 10, 1, 1, [60, 42, 38]);   // the keeper, dark against the light
        for (let x = wx0 + 12; x < wx1 - 2; x += 12) RECT(x, wy0, 1, wy1 - wy0, [28, 24, 28]);   // mullions
        for (let i = 0; i < 12; i++) { B(wx1 - 6 - i, wy0 + 2 + i, [255, 255, 255], 0.10); B(wx1 - 7 - i, wy0 + 2 + i, [255, 255, 255], 0.06); }   // the lamp across the street in the glass
        // Neon OPEN. Per-letter flicker; the E is dying, as they always are.
        const nx = wx0 + 3, ny = wy1 - 11;
        glow(nx + 7, ny + 2, 8, C.neon, 0.22, 0.75);
        const word = 'OPEN';
        for (let k = 0; k < word.length; k++) {
          let a = 1;
          if (R.hash(S.frame, 17 + k) < 0.05) a = 0.35;
          if (k === 2 && R.hash(S.frame >> 2, 31) < 0.35) a = 0.12;
          text(word[k], nx + k * 4, ny, C.neon, a, true);
        }
        // Door with a lit glass panel.
        RECT(dx0 - 1, wy0 - 1, dx1 - dx0 + 2, fBot - wy0 + 1, C.wood);
        RECT(dx0, wy0, dx1 - dx0, fBot - wy0, [44, 36, 40]);
        RECT(dx0 + 1, wy0 + 1, dx1 - dx0 - 2, Math.floor((fBot - wy0) * 0.55), [206, 154, 92]);
        P(dx1 - 2, wy0 + Math.floor((fBot - wy0) * 0.62), [180, 180, 170]);
        RECT(wx0 - 1, wy1, wx1 - wx0 + 2, 1, [48, 48, 58]);   // sill
        for (let x = fx0; x < fx1; x++) { const h = R.hash(x, 5); B(x, fBot - 1, [40, 52, 82], 0.5 + h * 0.4); if (h > 0.6) B(x, fBot - 2, [40, 52, 82], 0.35); }   // drift against the wall
      };

      const drawGroundLight = () => {
        const clip = [0, L.fBot, L.W - 1, L.H - 1];
        for (const lp of L.lamps) glow(lp.x, L.sw1 - 1, 27, C.warm, 0.9, 0.5, clip);   // the pools: this is where the snow is allowed to be white
        glow(L.winCx, L.fBot, (L.wx1 - L.wx0) * 0.6, [255, 220, 165], 0.5, 0.3, clip);   // spill from the window
        glow(L.wx0 + 8, L.fBot, 9, C.neon, 0.22, 0.3, clip);                              // and a pink smudge under the neon
        glow((L.dx0 + L.dx1) / 2, L.fBot, 6, [255, 210, 150], 0.4, 0.5, clip);
      };

      const drawWalker = () => {
        const w = S.walker;
        if (!w) return;
        const x = Math.floor(w.x), fy = L.sw1 - 2;
        const lit = groundLit(x + 1);
        // Shadow falls away from the nearer lamp, along the ground, longer and
        // fainter with distance. A figure without a shadow floats.
        let near = L.lamps[0];
        for (const lp of L.lamps) if (Math.abs(lp.x - x) < Math.abs(near.x - x)) near = lp;
        const sd = x >= near.x ? 1 : -1, len = Math.min(11, 3 + Math.abs(x - near.x) * 0.35);
        for (let i = 1; i <= len; i++) { const f = (1 - i / len) * 0.5 * Math.min(1, lit * 1.5); B(x + 1 + sd * i, fy, [0, 0, 10], f); B(x + 1 + sd * i, fy + 1, [0, 0, 10], f * 0.6); }
        const step = Math.floor(S.t * 5) & 1, coat = [22, 20, 32];
        RECT(x, fy - 5, 3, 4, coat);
        RECT(x + 1, fy - 6, 1, 1, [58, 44, 40]);
        RECT(x, fy - 7, 3, 1, [30, 26, 40]);   // hat
        P(x + (step ? 0 : 2), fy - 1, coat); P(x + 1, fy - 1, coat); P(x + (step ? 2 : 0), fy, coat); P(x + (step ? 0 : 2), fy, coat);
        for (let y = fy - 7; y <= fy; y++) B(x + (sd > 0 ? 0 : 2), y, C.warm, 0.35 * Math.min(1, lit));   // rim light on the lamp side
      };

      // Headlight fan onto the tarmac: narrow at the lamp, wide and faint ahead,
      // biased downward because it is the road that catches it, not the air.
      const beam = (x0, y, dir, len) => {
        for (let i = 1; i <= len; i++) {
          const spread = 1 + i * 0.22, f = Math.pow(1 - i / len, 1.4) * 0.6;
          for (let j = -spread; j <= spread + 3; j++) {
            const g = 1 - Math.abs(j - 1) / (spread + 2);
            if (g > 0) B(x0 + dir * i, y + j, [255, 240, 205], f * g);
          }
        }
      };

      const drawCar = () => {
        const c = S.car;
        if (!c) return;
        // The one-cell vertical jitter is the PlayStation's vertex snapping; without it the car reads as a modern sprite.
        const x = Math.floor(c.x), y = L.lanes[c.lane] + (R.hash(S.frame, 5) < 0.18 ? 1 : 0), d = c.dir;
        const front = d > 0 ? x + 15 : x, rear = d > 0 ? x : x + 15;
        beam(front, y + 2, d, 34);
        RECT(x, y + 1, 16, 3, c.col); RECT(x + 1, y + 4, 14, 1, c.col);
        const cab = d > 0 ? x + 3 : x + 5;
        RECT(cab, y - 1, 8, 2, c.col); RECT(cab + 1, y - 1, 6, 2, C.glass); RECT(cab, y - 2, 8, 1, [70, 82, 112]);   // snow on the roof: it has been parked outside
        P(cab + (d > 0 ? 5 : 1), y - 1, [140, 160, 200]);
        RECT(x + 2, y + 4, 2, 2, [8, 8, 12]); RECT(x + 12, y + 4, 2, 2, [8, 8, 12]);
        const gl = groundLit(x + 8);
        if (gl > 0.01) for (let yy = y - 2; yy <= y + 4; yy++) for (let xx = x; xx < x + 16; xx++) B(xx, yy, C.warm, gl * 0.45);   // the pools light the bodywork as it passes through
        P(front, y + 2, [255, 252, 225]); P(front, y + 3, [255, 252, 225]); glow(front, y + 2, 3, [255, 250, 220], 0.7, 0.8);
        P(rear, y + 2, C.red); P(rear, y + 3, C.red); glow(rear, y + 3, 5, C.red, 0.4, 0.7);
        for (let i = 1; i < 7; i++) { B(front, y + 5 + i, [255, 250, 220], 0.3 * (1 - i / 7)); B(rear, y + 5 + i, C.red, 0.25 * (1 - i / 7)); }   // wet-slush reflections
      };

      // Smoke is the one place stipple belongs. hash is fixed in space, so a
      // puff sliding through it shimmers like an old dithered particle.
      const drawSmoke = () => {
        for (const p of S.smoke) { const s = 1 + p.age * 1.6; STIP(p.x - s / 2, p.y - s / 2, s, s, p.col, 0.55 * (1 - p.age / p.life)); }
      };

      const drawLamps = () => {
        for (const lp of L.lamps) {
          const x = lp.x, head = lp.head;
          for (let y = head + 3; y < L.sw1; y++) { P(x, y, [30, 32, 42]); B(x, y, C.warm, 0.5 * Math.max(0, 1 - (y - head) / 22)); }
          RECT(x - 2, head, 5, 2, [46, 48, 58]);
          RECT(x - 2, head - 1, 5, 1, [56, 68, 100]);
          RECT(x - 1, head + 2, 3, 1, C.lampCore);
          glow(x, head + 2, 13, C.warm, 0.5, 0.85);   // halo: it is the snow in the air that glows, so it is blended, never stippled
        }
      };

      const drawClumps = () => { for (const p of S.clumps) B(p.x, p.y, [190, 204, 232], 0.85 * (0.4 + 0.6 * Math.min(1, lightAt(p.x, p.y)))); };

      const drawSnow = () => {
        for (const f of S.flakes) {
          const l = Math.min(1, lightAt(f.x, f.y));
          const a = (0.16 + 0.8 * l) * (0.45 + 0.55 * f.z);
          const col = [200 + 55 * l, 210 + 30 * l, 236 - 40 * l];   // warms as it enters a sodium beam
          B(f.x, f.y, col, a);
          if (f.z > 0.88) B(f.x + 1, f.y, col, a * 0.5);
        }
      };

      const draw = () => {
        drawSky(); drawCity(); drawGround(); drawNeighbours();
        drawStoreWall();
        for (const lp of L.lamps) glow(lp.x, lp.head + 2, 36, C.warm, 0.34, 1, [0, L.fTop - 6, L.W - 1, L.fBot - 1]);   // lamps on the brick before the fittings go on
        drawStoreFront();
        for (const lp of L.lamps) glow(lp.x, lp.head + 2, 30, C.warm, 0.14, 1, [L.fx0 - 1, L.fTop - 3, L.fx1, L.fBot - 1]);   // and a lighter pass over awning, sign and sill
        drawGroundLight(); drawWalker(); drawCar(); drawSmoke(); drawLamps(); drawClumps(); drawSnow();
        R.flush();
      };

      // ── simulation ─────────────────────────────────────────────────────
      const update = (dt) => {
        S.t += dt; S.frame++;
        S.gust *= Math.exp(-dt * 1.1); S.shove *= Math.exp(-dt * 3);
        S.wind = -3 + S.gust + S.shove;
        const W = L.W, H = L.H;
        for (const f of S.flakes) {
          // Near flakes take the wind harder and wobble more: that is what sells depth at one cell per flake.
          f.x += (S.wind * (0.35 + 0.65 * f.z) + Math.sin(S.t * 1.6 + f.ph) * 1.3 * f.z) * dt;
          f.y += (6 + 11 * f.z) * dt;
          if (f.y >= H) { f.y = -1; f.x = Math.random() * W; }
          if (f.x < 0) f.x += W; else if (f.x >= W) f.x -= W;
        }
        const k = S.keeper;
        if (k.wait > 0) k.wait -= dt;
        else { const d = k.tx - k.x; if (Math.abs(d) < 0.01) { k.wait = 3 + Math.random() * 7; k.tx = Math.random(); } else k.x += Math.sign(d) * Math.min(Math.abs(d), 0.09 * dt); }
        if (S.car) {
          S.car.x += S.car.dir * S.car.speed * dt;
          if (S.car.x > W + 6 || S.car.x < -24) { S.car = null; S.nextCar = 5 + Math.random() * 12; }
          else {
            S.exhaustAcc += dt;
            if (S.exhaustAcc > 0.14) {
              S.exhaustAcc = 0;
              S.smoke.push({ x: S.car.dir > 0 ? S.car.x : S.car.x + 16, y: L.lanes[S.car.lane] + 4, vx: -S.car.dir * 4, vy: -1.5, age: 0, life: 1.1, col: [92, 94, 106] });
            }
          }
        } else {
          S.nextCar -= dt;
          if (S.nextCar <= 0) {
            const dir = Math.random() < 0.5 ? 1 : -1;
            S.car = { x: dir > 0 ? -20 : W + 4, dir, lane: dir > 0 ? 0 : 1, speed: 22 + Math.random() * 14, col: CARS[Math.floor(Math.random() * CARS.length)] };
          }
        }
        if (S.walker) {
          S.walker.x += S.walker.dir * S.walker.speed * dt;
          if (S.walker.x > W + 4 || S.walker.x < -6) { S.walker = null; S.nextWalker = 8 + Math.random() * 14; }
        } else {
          S.nextWalker -= dt;
          if (S.nextWalker <= 0) { const dir = Math.random() < 0.5 ? 1 : -1; S.walker = { x: dir > 0 ? -4 : W + 2, dir, speed: 4.5 + Math.random() * 2 }; }
        }
        S.smokeAcc += dt;
        if (S.smokeAcc > 0.3) { S.smokeAcc = 0; S.smoke.push({ x: L.fx0 + 10.5, y: L.fTop - 5, vx: (Math.random() - 0.5) * 1.5, vy: -2.5 - Math.random() * 2, age: 0, life: 3 + Math.random() * 2, col: [72, 74, 90] }); }
        for (let i = S.smoke.length - 1; i >= 0; i--) {
          const p = S.smoke[i]; p.age += dt;
          if (p.age >= p.life) { S.smoke.splice(i, 1); continue; }
          p.x += (p.vx + S.wind * 0.6) * dt; p.y += p.vy * dt; p.vy *= (1 - 0.5 * dt);
        }
        if (S.smoke.length > 80) S.smoke.splice(0, S.smoke.length - 80);
        for (let i = S.clumps.length - 1; i >= 0; i--) { const p = S.clumps[i]; p.vy += 40 * dt; p.y += p.vy * dt; p.x += p.vx * dt; if (p.y >= L.sw1 - 1) S.clumps.splice(i, 1); }
        if (S.flips.size) for (const [key, until] of S.flips) if (until < S.t) S.flips.delete(key);
      };

      // Resize carries state: flakes, car, walker and smoke are scaled into the
      // new size instead of reseeded, so dragging an edge does not restart the
      // snow forty times. Layout (city, stars) is deterministic from hash, so
      // rebuilding it is not a restart — the same buildings come back.
      const resize = () => {
        const oW = R.W || 1, oH = R.H || 1;
        R.resize();
        if (!R.W || !R.H) return;
        const sx = R.W / oW, sy = R.H / oH;
        layout();
        for (const f of S.flakes) { f.x *= sx; f.y *= sy; }
        const n = flakeCount();
        while (S.flakes.length < n) S.flakes.push(newFlake());
        if (S.flakes.length > n) S.flakes.length = n;
        if (S.car) S.car.x *= sx;
        if (S.walker) S.walker.x *= sx;
        for (const p of S.smoke) { p.x *= sx; p.y *= sy; }
        for (const p of S.clumps) { p.x *= sx; p.y *= sy; }
        S.flips.clear();   // keyed by absolute window cell; the grid moved
      };
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        S.gust = Math.min(9, S.gust + 1.8);   // every keystroke is a gust: the snow leans, the smoke bends
        if (Math.random() < 0.12) {           // now and then the awning sheds its load
          const cx = L.fx0 + 4 + Math.random() * (L.fx1 - L.fx0 - 8);
          for (let i = 0; i < 6; i++) S.clumps.push({ x: cx + Math.random() * 3, y: L.fTop + 14, vx: (Math.random() - 0.5) * 3, vy: 4 + Math.random() * 8 });
        }
        // and a window in the far city answers, on the same 2-cell grid the city draws on
        const bd = L.city[Math.floor(Math.random() * L.city.length)];
        if (bd && bd.h > 6 && bd.w > 2 && S.flips.size < 40) {
          const wx = bd.x + 1 + 2 * Math.floor(Math.random() * ((bd.w - 2) / 2));
          const wy = L.hz - bd.h + 2 + 2 * Math.floor(Math.random() * ((bd.h - 4) / 2));
          S.flips.set(wx * 4096 + wy, S.t + 6 + Math.random() * 10);
        }
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // Dragging the window is wind too: the snow lags behind the frame.
      this._unshove = (typeof onShove === 'function') ? onShove((dx) => { S.shove = Math.max(-14, Math.min(14, S.shove - dx * 0.5)); }) : null;

      let nextFrame = 0, last = performance.now();
      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / FPS;
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        try { update(dt); draw(); }
        catch (err) { if (!S.warned) { S.warned = true; console.warn('snowstreet: frame dropped', err); } }   // a bad frame is dropped, never fatal
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._unshove) this._unshove();
      this._resize = null; this._onKey = null; this._unshove = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Cicadas — a summer night, and the field goes quiet when you move.
  //
  // A cicada is not a tone. It is a band of noise around five kilohertz being
  // switched on and off about fifty times a second by the tymbal, which is
  // why it sounds like a rattle rather than a whistle and why a sine wave
  // with vibrato sounds nothing like one. So: noise → a tight bandpass →
  // a gain being driven by an audio-rate oscillator. That is the whole
  // instrument, and it is three nodes.
  //
  // A chorus is several of those at slightly different band centres and
  // trill rates, each swelling and fading on its own schedule. They never
  // line up, which is what makes it a field rather than a machine.
  //
  // And they stop when you type. Walk into a field of cicadas and a circle
  // of silence opens around you and then closes again over the next few
  // seconds — that is the thing worth having, and it costs one timer.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.cicadas = {
    start() {
      const bk = back();
      if (!bk) return;
      const c = makeCanvas(bk, 'fx-cicadas-canvas');
      const ctx = c.ctx;

      const rand = (a, b) => a + Math.random() * (b - a);

      let leaves = [];
      const build = () => {
        // Foliage down both sides and across the top, out of focus: a mass of
        // overlapping ellipses at three depths, darkest at the front.
        leaves = [];
        const n = Math.round((c.w + c.h) / 14);
        for (let i = 0; i < n; i++) {
          const edge = Math.random();
          let x, y;
          if (edge < 0.4) { x = rand(-40, c.w * 0.22); y = rand(-30, c.h + 20); }
          else if (edge < 0.8) { x = rand(c.w * 0.78, c.w + 40); y = rand(-30, c.h + 20); }
          else { x = rand(-40, c.w + 40); y = rand(-40, c.h * 0.16); }
          leaves.push({
            x, y, r: rand(14, 52), z: Math.random(),
            a: rand(0, Math.PI), sway: Math.random() * 6.28
          });
        }
        leaves.sort((p, q) => p.z - q.z);
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // ── the chorus
      const ctxA = audio();
      let voices = [];
      let bed = null;
      let hush = 0;                 // 1 = silent, decays back to 0

      if (ctxA) {
        bed = noiseBed({ type: 'lowpass', freq: 340, q: 0.6, gain: 0.014 });
        const n = 5;
        for (let i = 0; i < n; i++) {
          const src = ctxA.createBufferSource();
          src.buffer = noiseBuf;
          src.loop = true;
          const bp = ctxA.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = rand(3800, 6600);
          bp.Q.value = rand(6, 12);
          // The tymbal: an oscillator driving the gain directly, at audio
          // rate. A LFO on a gain is tremolo; at forty-odd hertz it stops
          // being tremolo and becomes the timbre.
          const trill = ctxA.createOscillator();
          trill.type = 'sawtooth';
          trill.frequency.value = rand(38, 62);
          const depth = ctxA.createGain();
          depth.gain.value = 0.5;
          const vca = ctxA.createGain();
          vca.gain.value = 0;
          const out = ctxA.createGain();
          out.gain.value = 0;
          trill.connect(depth); depth.connect(vca.gain);
          src.connect(bp); bp.connect(vca); vca.connect(out); out.connect(masterGain);
          src.start(0); trill.start(0);
          voices.push({
            src, bp, trill, vca, out,
            level: 0, target: 0,
            next: performance.now() + rand(0, 4000),
            pan: Math.random()
          });
        }
      }
      this._voices = voices;
      this._bed = bed;

      let lastKey = -1e9;
      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        lastKey = performance.now();
        hush = 1;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // The silence closes back over about four seconds.
        hush = Math.max(0, hush - dt * 0.25);

        let chorus = 0;
        for (const v of voices) {
          if (now > v.next) {
            // Each one calls for a few seconds then rests for a few more.
            v.target = v.target > 0.01 ? 0 : rand(0.05, 0.11);
            v.next = now + (v.target > 0 ? rand(2200, 6000) : rand(1400, 5200));
          }
          const want = v.target * (1 - hush);
          v.level += (want - v.level) * dt * 1.6;
          try { v.out.gain.setTargetAtTime(v.level, ctxA.currentTime, 0.12); } catch (e) {}
          chorus += v.level;
        }
        if (bed) bed.set(0.014 * (1 - hush * 0.6), 0.5);

        // ── the visual is only the night and how loud it is
        ctx.clearRect(0, 0, c.w, c.h);
        const heat = Math.min(1, chorus / 0.28);

        for (const L of leaves) {
          const sw = Math.sin(now / 1000 * 0.4 + L.sway) * 2;
          const dark = 6 + L.z * 16;
          ctx.fillStyle = 'rgba(' + Math.round(dark * 1.0) + ',' + Math.round(dark * 1.35) +
            ',' + Math.round(dark * 0.95) + ',' + (0.55 + L.z * 0.45).toFixed(3) + ')';
          ctx.beginPath();
          ctx.ellipse(L.x + sw, L.y, L.r, L.r * 0.55, L.a + sw * 0.02, 0, Math.PI * 2);
          ctx.fill();
        }

        // A wash of warm green that rises and falls with the chorus, so you
        // can see how loud the field is without looking at anything.
        if (heat > 0.01) {
          const g = ctx.createRadialGradient(c.w / 2, c.h * 0.55, 0, c.w / 2, c.h * 0.55, Math.max(c.w, c.h) * 0.7);
          g.addColorStop(0, 'rgba(150,180,90,' + (heat * 0.05).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(150,180,90,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, c.w, c.h);
        }

        // The insects themselves: a handful of dim points in the foliage that
        // pulse in step with their own voice.
        voices.forEach((v, i) => {
          if (v.level < 0.005) return;
          const x = (0.08 + v.pan * 0.84) * c.w;
          const y = (0.12 + ((i * 0.37) % 1) * 0.7) * c.h;
          const a = (v.level / 0.11) * (0.5 + 0.5 * Math.sin(now / 1000 * v.trill.frequency.value * 0.06));
          ctx.fillStyle = 'rgba(196,220,120,' + (a * 0.5).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        });

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      for (const v of (this._voices || [])) {
        try { v.src.stop(); v.trill.stop(); } catch (e) {}
        try { v.src.disconnect(); v.bp.disconnect(); v.vca.disconnect(); v.out.disconnect(); v.trill.disconnect(); } catch (e) {}
      }
      if (this._bed) this._bed.stop();
      this._voices = null; this._bed = null;
      this._resize = null; this._onKey = null;
      closeAudio();
    }
  };
  // ────────────────────────────────────────────────────────────────────────
  // Wind — weather against the outside of the building.
  //
  // The sound was right first time and is unchanged: three layers, because
  // that is what wind is. A broad low rush that never stops, a mid band that
  // rises and falls with the gusts, and — only at the top of a gust — a thin
  // resonant whistle, which is air going past an edge fast enough to sing.
  // The whistle is what makes it read as wind rather than as a fan, and it
  // has to be rare or it becomes a kettle.
  //
  // The picture was wrong, and wrong in an instructive way: it drew the air
  // itself, as faint streaks, and faint streaks on a dark ground are nothing
  // at all. **You cannot see wind.** You see what it is carrying and what it
  // is bending. So now it carries leaves and grit, and there is a branch in
  // the corner with one end fixed — and the branch is what tells you how hard
  // it is blowing, because it is the only thing on screen that cannot simply
  // move out of the way.
  //
  // Gusts are envelopes, not per-frame randomness: a rise, a hold and a long
  // fall, scheduled seconds apart. The drawing and the sound ride the same
  // envelope, so what you see and what you hear are one gust.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.wind = {
    start() {
      const bk = back();
      if (!bk) return;
      const c = makeCanvas(bk, 'fx-wind-canvas');
      const ctx = c.ctx;
      const rand = (a, b) => a + Math.random() * (b - a);

      const LEAF = [
        [148, 106, 52], [122, 88, 44], [164, 128, 66], [96, 74, 40], [138, 116, 72]
      ];

      let streaks = [], leaves = [], grit = [], branch = [];

      const build = () => {
        streaks = Array.from({ length: Math.round((c.w * c.h) / 9000) }, () => ({
          x: Math.random() * c.w, y: Math.random() * c.h,
          len: rand(40, 190), z: Math.random(), wob: Math.random() * 6.28
        }));
        leaves = Array.from({ length: Math.round((c.w * c.h) / 7000) + 8 }, () => ({
          x: rand(-200, c.w), y: rand(-40, c.h), z: rand(0.35, 1),
          r: rand(3.5, 8), spin: rand(-9, 9), ang: rand(0, 6.28),
          col: LEAF[Math.floor(Math.random() * LEAF.length)],
          bob: Math.random() * 6.28
        }));
        grit = Array.from({ length: Math.round((c.w * c.h) / 3400) }, () => ({
          x: Math.random() * c.w, y: Math.random() * c.h,
          z: Math.random(), bob: Math.random() * 6.28
        }));

        // A bare branch, hinged at the left edge. Each joint bends a little
        // further than the one before it, so the tip whips and the base
        // barely moves — which is what a branch does and what makes the force
        // legible.
        branch = [];
        // Each joint carries the *turn* it makes relative to the one before
        // it, not an absolute heading. Storing absolutes and summing them in
        // the draw loop compounds every angle and curls the limb back on
        // itself within four segments.
        // Hung from the top edge rather than run in from the left. Along the
        // left it lay under the note list, and every panel in this theme is
        // translucent over the effect rather than transparent — 78% of the
        // sidebar's own colour on top of it turned a half-opaque line into
        // nothing. Down the middle it has clear editor behind it.
        // Reaching in from the top-left, not plunging from the top edge. The
        // first joint used to leave at 1.02 radians — very nearly sixty
        // degrees below horizontal — which does not read as a branch coming in
        // from a tree outside the window. It reads as something falling past
        // it. A limb enters shallow and droops along its length, so that is
        // what the numbers say now: a gentle start and a small, consistent
        // downward turn per joint.
        const x = -6, y = c.h * 0.16;
        for (let i = 0; i < 7; i++) {
          branch.push({
            len: 54 - i * 4,
            turn: i === 0 ? 0.30 : rand(0.02, 0.16),
            give: 0.05 + i * 0.055, x, y, tw: []
          });
        }
        for (const seg of branch) {
          const n = 1 + Math.floor(Math.random() * 2);
          for (let i = 0; i < n; i++) {
            seg.tw.push({ at: rand(0.3, 0.95), a: rand(-1.1, 1.1), len: rand(10, 22) });
          }
        }
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const ctxA = audio();
      let rush = null, mid = null, whistle = null, whistleGain = null;
      if (ctxA) {
        rush = noiseBed({ type: 'lowpass', freq: 260, q: 0.5, gain: 0.05 });
        mid = noiseBed({ type: 'bandpass', freq: 620, q: 1.1, gain: 0.01 });
        whistle = ctxA.createBufferSource();
        whistle.buffer = noiseBuf;
        whistle.loop = true;
        const bp = ctxA.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1150;
        bp.Q.value = 24;
        whistleGain = ctxA.createGain();
        whistleGain.gain.value = 0;
        whistle.connect(bp); bp.connect(whistleGain); whistleGain.connect(masterGain);
        whistle.start(0);
        this._whistleNodes = [whistle, bp, whistleGain];
      }
      this._rush = rush; this._mid = mid;

      let gusts = [];
      let nextGust = performance.now() + 900;
      const addGust = (now, strength) => {
        gusts.push({
          t0: now, rise: rand(500, 1400), hold: rand(300, 1200),
          fall: rand(1400, 3400), peak: strength
        });
        if (gusts.length > 5) gusts.shift();
      };

      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        if (Math.random() < 0.10) addGust(performance.now(), rand(0.4, 0.85));
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const envelope = (g, now) => {
        const dt = now - g.t0;
        if (dt < 0) return 0;
        if (dt < g.rise) return (dt / g.rise) * g.peak;
        if (dt < g.rise + g.hold) return g.peak;
        const k = (dt - g.rise - g.hold) / g.fall;
        return k >= 1 ? -1 : (1 - k) * (1 - k) * g.peak;
      };

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        if (now > nextGust) {
          addGust(now, rand(0.35, 1));
          nextGust = now + rand(3500, 11000);
        }
        let force = 0.22;
        gusts = gusts.filter((g) => {
          const e = envelope(g, now);
          if (e < 0) return false;
          force += e;
          return true;
        });
        force = Math.min(1.5, force);

        if (rush) {
          rush.set(0.035 + force * 0.075, 0.35);
          rush.filter.frequency.setTargetAtTime(220 + force * 420, ctxA.currentTime, 0.3);
        }
        if (mid) {
          mid.set(0.004 + force * 0.030, 0.3);
          mid.filter.frequency.setTargetAtTime(500 + force * 900, ctxA.currentTime, 0.25);
        }
        if (whistleGain) {
          const w = Math.max(0, (force - 0.75) / 0.65);
          whistleGain.gain.setTargetAtTime(w * w * 0.035, ctxA.currentTime, 0.25);
        }

        ctx.clearRect(0, 0, c.w, c.h);

        // ── streaks. Still here, but as the *bed* of the effect rather than
        // the whole of it, and at an opacity you can actually see.
        ctx.lineCap = 'round';
        for (const s of streaks) {
          s.x += (70 + s.z * 260) * force * dt;
          s.y += Math.sin(now / 1000 * 0.6 + s.wob) * 10 * dt;
          if (s.x - s.len > c.w) { s.x = -s.len; s.y = Math.random() * c.h; }
          const len = s.len * (0.35 + force * 0.65);
          const a = (0.09 + s.z * 0.20) * Math.min(1, force);
          ctx.strokeStyle = 'rgba(198,214,232,' + a.toFixed(3) + ')';
          ctx.lineWidth = 0.7 + s.z * 1.4;
          ctx.beginPath();
          ctx.moveTo(s.x - len, s.y + Math.sin(now / 900 + s.wob) * 4);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }

        // ── grit. Small, fast, and the thing that sells speed: individual
        // specks moving far enough per frame to streak on their own.
        for (const g of grit) {
          const v = (150 + g.z * 420) * force;
          g.x += v * dt;
          g.y += Math.sin(now / 700 + g.bob) * 14 * dt;
          if (g.x > c.w + 4) { g.x = -4; g.y = Math.random() * c.h; }
          ctx.strokeStyle = 'rgba(214,224,236,' + (0.16 + g.z * 0.30).toFixed(3) + ')';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(g.x - v * dt * 1.6, g.y);
          ctx.lineTo(g.x, g.y);
          ctx.stroke();
        }

        // ── leaves. Each one tumbles about its own centre, and the tumble
        // rate goes up with the gust — a leaf that translates without
        // rotating reads as a sprite being dragged across the screen.
        for (const L of leaves) {
          L.x += (90 + L.z * 300) * force * dt;
          L.y += Math.sin(now / 800 + L.bob) * 40 * dt + 14 * dt;
          L.ang += L.spin * force * dt;
          if (L.x > c.w + 30) { L.x = -30; L.y = rand(-20, c.h * 0.9); }
          if (L.y > c.h + 20) L.y = -20;
          ctx.save();
          ctx.translate(L.x, L.y);
          ctx.rotate(L.ang);
          // Foreshortened as it turns: the ellipse narrows through the edge-on
          // part of the tumble, which is most of what makes it look like a
          // flat thing spinning in three dimensions.
          const k = Math.abs(Math.cos(L.ang * 1.7));
          const col = L.col;
          ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' +
            (0.42 + L.z * 0.48).toFixed(3) + ')';
          ctx.beginPath();
          ctx.ellipse(0, 0, L.r, Math.max(0.6, L.r * 0.55 * k), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // ── the branch. Fixed at the left edge, bending down the chain, with
        // a fast tremble on top of the bend so it never looks posed.
        let px = branch[0] ? branch[0].x : 0;
        let py = branch[0] ? branch[0].y : 0;
        let ang = 0;
        ctx.strokeStyle = 'rgba(176,186,198,0.80)';
        ctx.lineCap = 'round';
        for (let i = 0; i < branch.length; i++) {
          const seg = branch[i];
          const tremble = Math.sin(now / 90 + i * 1.3) * 0.02 * force * (i + 1);
          // Minus, not plus. The wind runs left to right, the limb hangs
          // down-and-right, and adding to the angle swung the tip back into
          // the wind — a branch leaning the wrong way is the one thing in a
          // scene like this that everybody notices at once.
          ang += seg.turn - seg.give * force * 1.25 + tremble;
          const nx2 = px + Math.cos(ang) * seg.len;
          const ny2 = py + Math.sin(ang) * seg.len;
          ctx.lineWidth = 5 - i * 0.6;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(nx2, ny2);
          ctx.stroke();
          // Twigs, thinner and bending harder than the limb they are on.
          ctx.lineWidth = 1.1;
          for (const tw of seg.tw) {
            const bx = px + (nx2 - px) * tw.at, by = py + (ny2 - py) * tw.at;
            const ta = ang + tw.a - seg.give * force * 2.2;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(ta) * tw.len, by + Math.sin(ta) * tw.len);
            ctx.stroke();
          }
          px = nx2; py = ny2;
        }

        // ── the gust itself, as a sheet crossing the window. Only at the top
        // of a strong one, so it is an event rather than a texture.
        if (force > 0.85) {
          const k = Math.min(1, (force - 0.85) / 0.6);
          const u = ((now / 900) % 1) * (c.w + 400) - 200;
          const g = ctx.createLinearGradient(u - 200, 0, u + 200, 0);
          g.addColorStop(0, 'rgba(210,224,240,0)');
          g.addColorStop(0.5, 'rgba(210,224,240,' + (k * 0.045).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(210,224,240,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, c.w, c.h);
        }

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._rush) this._rush.stop();
      if (this._mid) this._mid.stop();
      for (const n of (this._whistleNodes || [])) {
        try { n.stop && n.stop(); } catch (e) {}
        try { n.disconnect(); } catch (e) {}
      }
      this._rush = null; this._mid = null; this._whistleNodes = null;
      this._resize = null; this._onKey = null;
      closeAudio();
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Chimes — tubes in a doorway, and you are the draught.
  //
  // The tubes hang from a disc with a clapper in the middle and a sail below
  // it. Wind moves the sail, the sail drags the clapper, the clapper hits
  // whichever tube it reaches — so nothing here is scheduled: the notes are
  // whatever the physics produces, which is why a real set never plays a
  // phrase twice.
  //
  // Each tube is a pendulum, and the clapper is a pendulum with a longer
  // period. A strike happens when their positions cross within the tube's
  // radius, and the velocity at the crossing is the volume. Tuned to a major
  // pentatonic, because that is what commercial chimes are tuned to and the
  // reason they never sound wrong against anything.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.chimes = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-chimes-canvas');
      const ctx = c.ctx;

      // A major pentatonic from A4, low to high — the long tube is the low
      // note, so the drawing and the tuning agree.
      const NOTES = [440, 494, 587, 659, 784, 880];

      let tubes = [];
      let clapper = null;
      let hubX = 0, hubY = 0;
      const build = () => {
        hubX = c.w * 0.5;
        hubY = 0;
        const spread = Math.min(c.w * 0.34, 190);
        tubes = NOTES.map((f, i) => {
          const u = (i - (NOTES.length - 1) / 2) / ((NOTES.length - 1) / 2);
          return {
            f,
            rest: hubX + u * spread,
            // Longer tube, lower note: length from the frequency, not from i,
            // so if the tuning changes the picture follows.
            len: Math.min(c.h * 0.42, 12000 / f * 9),
            a: 0, v: 0, ring: 0
          };
        });
        clapper = { a: 0, v: 0 };
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // Draught: a slow random walk with occasional pushes, plus whatever the
      // typing adds.
      let draught = 0;
      let nextPuff = performance.now() + 2000;

      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        draught += (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 1.4);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.04);
        last = now;

        if (now > nextPuff) {
          draught += (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 1.8);
          nextPuff = now + 1400 + Math.random() * 5200;
        }
        draught *= Math.pow(0.35, dt);

        // The clapper is heavier and slower than the tubes, which is what
        // makes it able to catch them.
        clapper.v += (draught * 0.9 - clapper.a * 7.0) * dt;
        clapper.v *= Math.pow(0.55, dt);
        clapper.a += clapper.v * dt;

        for (const tb of tubes) {
          tb.v += (draught * 0.5 - tb.a * 13.0) * dt;
          tb.v *= Math.pow(0.5, dt);
          tb.a += tb.v * dt;
          tb.ring = Math.max(0, tb.ring - dt * 1.7);
        }

        // Strikes. The clapper's screen position against each tube's.
        const cx = hubX + clapper.a * 60;
        for (const tb of tubes) {
          const tx = tb.rest + tb.a * 46;
          const gap = Math.abs(cx - tx);
          if (gap < 7 && tb.ring < 0.35) {
            const speed = Math.abs(clapper.v - tb.v);
            if (speed > 0.25) {
              const g = Math.min(0.5, 0.09 + speed * 0.22);
              metalHit(tb.f, g, 2.6);
              tb.ring = 1;
              tb.v -= (cx > tx ? -1 : 1) * speed * 0.5;
            }
          }
        }

        ctx.clearRect(0, 0, c.w, c.h);

        // The hanging disc.
        ctx.strokeStyle = 'rgba(190,200,210,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hubX, 0);
        ctx.lineTo(hubX, 8);
        ctx.stroke();
        ctx.fillStyle = 'rgba(150,160,172,0.55)';
        ctx.beginPath();
        ctx.ellipse(hubX, 10, Math.min(c.w * 0.36, 200), 4, 0, 0, Math.PI * 2);
        ctx.fill();

        for (const tb of tubes) {
          const x = tb.rest + tb.a * 46;
          const topY = 12;
          // The string down to the tube.
          ctx.strokeStyle = 'rgba(170,180,190,0.30)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(tb.rest, topY);
          ctx.lineTo(x, topY + 16);
          ctx.stroke();

          // The tube. Anodised aluminium: a bright edge on one side, a dark
          // one on the other, and nothing in between — a gradient across six
          // pixels is what makes a rectangle read as a cylinder.
          const w = 6;
          const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
          const lit = 0.42 + tb.ring * 0.45;
          g.addColorStop(0, 'rgba(90,100,112,' + lit.toFixed(3) + ')');
          g.addColorStop(0.35, 'rgba(206,216,228,' + Math.min(1, lit + 0.3).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(70,78,90,' + lit.toFixed(3) + ')');
          ctx.fillStyle = g;
          ctx.fillRect(x - w / 2, topY + 16, w, tb.len);

          if (tb.ring > 0.01) {
            ctx.strokeStyle = 'rgba(226,238,250,' + (tb.ring * 0.35).toFixed(3) + ')';
            ctx.lineWidth = 1 + tb.ring * 2.5;
            ctx.strokeRect(x - w / 2 - 1, topY + 15, w + 2, tb.len + 2);
          }
        }

        // Clapper and sail.
        const sailY = 12 + Math.min(c.h * 0.42, 12000 / NOTES[0] * 9) * 0.62;
        ctx.strokeStyle = 'rgba(170,180,190,0.35)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(hubX, 12);
        ctx.lineTo(cx, sailY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(184,164,120,0.75)';
        ctx.beginPath();
        ctx.arc(cx, sailY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(150,132,96,0.6)';
        ctx.fillRect(cx - 9, sailY + 22, 18, 26);
        ctx.strokeStyle = 'rgba(170,180,190,0.3)';
        ctx.beginPath();
        ctx.moveTo(cx, sailY + 7);
        ctx.lineTo(cx, sailY + 22);
        ctx.stroke();

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
      closeAudio();
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Marbles — you write, they collect at the bottom of the window.
  //
  // A marble drops at the caret on every so many keystrokes, falls, and joins
  // the others. Collisions are elastic and solved pairwise, which is fine at
  // this count and gives the one thing that matters: hit a marble and the one
  // it hits moves, and the one after that. A pile that responds all the way
  // through is a pile you want to poke, and the cursor pushes them.
  //
  // The glass is three passes. A cool rim (the light coming through the far
  // side), a coloured ribbon across the middle (the cat's eye, which is what
  // makes a marble a marble and not a ball bearing), and one small hard
  // specular dot up and left. Take the dot away and it goes flat instantly.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.marbles = {
    start() {
      const l = layer();
      if (!l) return;
      const c = makeCanvas(l, 'fx-marbles-canvas');
      const ctx = c.ctx;
      const rand = (a, b) => a + Math.random() * (b - a);

      const RIBBONS = [
        [96, 164, 220], [220, 128, 96], [140, 200, 150],
        [214, 190, 96], [176, 140, 214], [226, 226, 226]
      ];

      let balls = [];
      const resize = () => {
        const pw = c.w, ph = c.h;
        c.resize();
        if (pw && ph) {
          const sx = c.w / pw, sy = c.h / ph;
          for (const b of balls) { b.x *= sx; b.y *= sy; }
        }
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const drop = (x, y) => {
        const r = rand(7, 13);
        balls.push({
          x, y, vx: rand(-40, 40), vy: rand(0, 30), r,
          m: r * r,
          col: RIBBONS[Math.floor(Math.random() * RIBBONS.length)],
          spin: rand(-2, 2), ang: rand(0, 6.28)
        });
        // A ceiling on the count, and it is the *oldest* that goes: the pile
        // stays as deep as you left it and the newest thing you did is always
        // still there.
        if (balls.length > 34) balls.shift();
      };

      let keys = 0;
      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        if (++keys % 4) return;
        const p = caretRect();
        drop(p ? p.x : c.w * 0.5, p ? p.bottom : c.h * 0.3);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let mx = -1e5, my = -1e5, pmx = 0, pmy = 0;
      const onMove = (e) => { pmx = mx; pmy = my; mx = e.clientX; my = e.clientY; };
      document.addEventListener('mousemove', onMove, true);
      this._onMove = onMove;

      let last = performance.now();
      const tick = (now) => {
        let dt = Math.min((now - last) / 1000, 0.033);
        last = now;

        const floor = c.h - 6;
        for (const b of balls) {
          b.vy += 1500 * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.ang += b.spin * dt;

          if (b.y + b.r > floor) {
            b.y = floor - b.r;
            // Glass on wood: most of the energy comes back, and the ball
            // starts rolling as it stops bouncing.
            b.vy = -b.vy * 0.42;
            b.vx *= 0.93;
            b.spin = -b.vx / b.r;
            if (Math.abs(b.vy) < 30) b.vy = 0;
          }
          if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.7; }
          if (b.x + b.r > c.w) { b.x = c.w - b.r; b.vx = -Math.abs(b.vx) * 0.7; }

          // The cursor is a finger: it shoves, it does not attract.
          const dx = b.x - mx, dy = b.y - my;
          const d = Math.hypot(dx, dy);
          if (d < b.r + 26 && d > 0.01) {
            const push = (b.r + 26 - d) * 8;
            b.vx += (dx / d) * push + (mx - pmx) * 6;
            b.vy += (dy / d) * push * 0.5;
          }
        }

        // Pairwise, once per frame. Thirty-four balls is 561 pairs, which is
        // nothing; a broadphase here would be more code than it saves.
        for (let i = 0; i < balls.length; i++) {
          for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i], b = balls[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            const min = a.r + b.r;
            if (d >= min || d < 0.001) continue;
            const nx = dx / d, ny = dy / d;
            const overlap = min - d;
            const tot = a.m + b.m;
            a.x -= nx * overlap * (b.m / tot);
            a.y -= ny * overlap * (b.m / tot);
            b.x += nx * overlap * (a.m / tot);
            b.y += ny * overlap * (a.m / tot);
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv > 0) continue;
            const imp = -(1 + 0.82) * rv / (1 / a.m + 1 / b.m);
            a.vx -= (imp / a.m) * nx; a.vy -= (imp / a.m) * ny;
            b.vx += (imp / b.m) * nx; b.vy += (imp / b.m) * ny;
            a.spin += rv * 0.002; b.spin -= rv * 0.002;
          }
        }

        ctx.clearRect(0, 0, c.w, c.h);

        // Shadows first, all of them, so a ball never casts onto another ball.
        for (const b of balls) {
          const k = Math.max(0, 1 - (floor - (b.y + b.r)) / 60);
          if (k <= 0) continue;
          ctx.fillStyle = 'rgba(0,0,0,' + (k * 0.28).toFixed(3) + ')';
          ctx.beginPath();
          ctx.ellipse(b.x, floor + 2, b.r * (0.7 + k * 0.4), b.r * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        for (const b of balls) {
          const g = ctx.createRadialGradient(
            b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
          g.addColorStop(0, 'rgba(226,238,248,0.55)');
          g.addColorStop(0.55, 'rgba(150,172,196,0.30)');
          g.addColorStop(0.88, 'rgba(196,214,232,0.42)');
          g.addColorStop(1, 'rgba(232,244,255,0.62)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.fill();

          // The ribbon. Clipped to the sphere and rotated with the spin, so
          // the marble is visibly turning as it rolls.
          ctx.save();
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r * 0.97, 0, Math.PI * 2);
          ctx.clip();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.ang);
          const col = b.col;
          ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.72)';
          ctx.beginPath();
          ctx.ellipse(0, 0, b.r * 0.92, b.r * 0.34, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.beginPath();
          ctx.ellipse(0, -b.r * 0.1, b.r * 0.8, b.r * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.arc(b.x - b.r * 0.34, b.y - b.r * 0.38, Math.max(1, b.r * 0.17), 0, Math.PI * 2);
          ctx.fill();
        }

        rafId = requestAnimationFrame(tick);
      };
      // Something in the tray before the first keystroke, or the theme is a
      // blank window until you notice it is a theme.
      for (let i = 0; i < 6; i++) drop(rand(60, 400), rand(-200, 0));
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._onMove) document.removeEventListener('mousemove', this._onMove, true);
      this._resize = null; this._onKey = null; this._onMove = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Ripple Ink — suminagashi, and the cursor is the stick you stir it with.
  //
  // A drop of ink on still water spreads into a ring, and a second drop
  // inside the first pushes it outwards without mixing. So a drop here is a
  // set of concentric rings, each stored as a ring of points rather than as
  // a circle — the moment they are points, everything else is free.
  //
  // The water is a divergence-free flow field: two sine terms crossed so the
  // velocity curls instead of pumping, which is what stops the whole pattern
  // drifting off one side. The cursor adds a vortex on top of it, and because
  // the points only ever move with the flow, the ink stretches and folds and
  // never smears — the lines stay thin however far they travel, which is
  // exactly the thing that makes marbled paper look like marbled paper.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.rippleink = {
    start() {
      const bk = back();
      if (!bk) return;
      const c = makeCanvas(bk, 'fx-rippleink-canvas');
      const ctx = c.ctx;
      const rand = (a, b) => a + Math.random() * (b - a);

      const INKS = [
        [157, 127, 217], [96, 150, 210], [212, 138, 170],
        [120, 200, 190], [226, 200, 130]
      ];

      const N = 84;                 // points per ring
      let rings = [];

      const resize = () => {
        const pw = c.w, ph = c.h;
        c.resize();
        if (pw && ph) {
          const sx = c.w / pw, sy = c.h / ph;
          for (const r of rings) {
            for (let i = 0; i < N; i++) { r.px[i] *= sx; r.py[i] *= sy; }
          }
        }
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const drop = (x, y) => {
        const col = INKS[Math.floor(Math.random() * INKS.length)];
        const bands = 2 + Math.floor(Math.random() * 3);
        for (let b = 0; b < bands; b++) {
          const r0 = 6 + b * rand(7, 13);
          const px = new Float32Array(N), py = new Float32Array(N);
          for (let i = 0; i < N; i++) {
            const th = (i / N) * Math.PI * 2;
            px[i] = x + Math.cos(th) * r0;
            py[i] = y + Math.sin(th) * r0;
          }
          rings.push({ px, py, col, life: 1, w: 1.5 - b * 0.18 });
        }
        // Twelve rings on screen is about where the lines stop being readable
        // as separate lines.
        while (rings.length > 26) rings.shift();
      };

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        const p = caretRect();
        if (p) drop(p.x, (p.top + p.bottom) / 2);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let mx = -1e5, my = -1e5, mvx = 0, mvy = 0;
      const onMove = (e) => {
        mvx = e.clientX - mx; mvy = e.clientY - my;
        mx = e.clientX; my = e.clientY;
      };
      document.addEventListener('mousemove', onMove, true);
      this._onMove = onMove;

      let t = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.04);
        last = now;
        t += dt;

        const K = 0.0055;                 // spatial frequency of the flow
        for (const r of rings) {
          r.life -= dt * 0.018;
          for (let i = 0; i < N; i++) {
            const x = r.px[i], y = r.py[i];
            // Curl of a sine potential: u = dψ/dy, v = −dψ/dx. Divergence
            // free by construction, so the ink neither piles up nor thins.
            const u = Math.cos(x * K + t * 0.21) * Math.sin(y * K * 1.3 - t * 0.17) * 26;
            const v = -Math.sin(x * K * 1.1 - t * 0.13) * Math.cos(y * K + t * 0.19) * 26;
            let ax = u, ay = v;

            const dx = x - mx, dy = y - my;
            const d2 = dx * dx + dy * dy;
            if (d2 < 40000) {
              const d = Math.sqrt(d2) + 4;
              // Perpendicular to the radius: a vortex, not a shove. A radial
              // force would just blow a hole in the pattern.
              const s = (1 - d / 200) * 240 / d;
              ax += -dy * s + mvx * 6 * (1 - d / 200);
              ay += dx * s + mvy * 6 * (1 - d / 200);
            }
            r.px[i] = x + ax * dt;
            r.py[i] = y + ay * dt;
          }
        }
        rings = rings.filter((r) => r.life > 0);
        mvx *= 0.86; mvy *= 0.86;

        ctx.clearRect(0, 0, c.w, c.h);
        ctx.lineJoin = 'round';
        for (const r of rings) {
          ctx.strokeStyle = 'rgba(' + r.col[0] + ',' + r.col[1] + ',' + r.col[2] + ',' +
            (r.life * 0.55).toFixed(3) + ')';
          ctx.lineWidth = r.w;
          ctx.beginPath();
          ctx.moveTo(r.px[0], r.py[0]);
          for (let i = 1; i < N; i++) ctx.lineTo(r.px[i], r.py[i]);
          ctx.closePath();
          ctx.stroke();
        }

        rafId = requestAnimationFrame(tick);
      };
      drop(0.42, 0.5);
      rafId = requestAnimationFrame(tick);
      // Seeded after the first layout so the drops land inside the window.
      setTimeout(() => { rings = []; drop(c.w * 0.4, c.h * 0.5); drop(c.w * 0.62, c.h * 0.38); }, 60);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      if (this._onMove) document.removeEventListener('mousemove', this._onMove, true);
      this._resize = null; this._onKey = null; this._onMove = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Pendulums — a wave that is not a wave.
  //
  // Fifteen bobs on a rack, each string cut so that in one cycle of the
  // whole rack the longest swings some whole number of times and each of the
  // others swings one more than the one before it. Nothing couples them and
  // nothing is choreographed: they start together, drift apart into what
  // looks like a travelling wave, pass through a stretch that looks like
  // pure noise, and then — because the periods are commensurate — arrive
  // back in step and do it again.
  //
  // T(i) = T0 · N / (N + i) is the tuning. It is worth getting exactly right;
  // rounding the lengths for tidiness is what turns the recurrence into a
  // slow smear that never quite comes back.
  //
  // Typing swings them. Each keystroke lifts one and lets it go.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.pendulums = {
    start() {
      const bk = back();
      if (!bk) return;
      const c = makeCanvas(bk, 'fx-pendulums-canvas');
      const ctx = c.ctx;

      const N = 15;
      const CYCLE = 30;                 // seconds for the whole rack to realign
      const BASE = 24;                  // swings the longest makes in a cycle

      let bobs = [];
      let railY = 0, x0 = 0, dx = 0;
      const build = () => {
        railY = Math.round(c.h * 0.16);
        const usable = Math.min(c.w * 0.74, 520);
        x0 = (c.w - usable) / 2;
        dx = usable / (N - 1);
        const maxLen = c.h * 0.62;
        bobs = [];
        for (let i = 0; i < N; i++) {
          // T = CYCLE / (BASE + i), and L = g(T/2π)² — in screen units, with
          // g chosen so the longest string fills the space available.
          const T = CYCLE / (BASE + i);
          const L = maxLen * Math.pow(T / (CYCLE / BASE), 2);
          bobs.push({ i, L, T, a: 0.55, phase: 0, amp: 0.55 });
        }
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let start = performance.now();
      const onKey = (e) => {
        if (e.repeat || !e.key) return;
        if (e.key === 'Enter') { start = performance.now(); return; }   // all back in line
        const b = bobs[Math.floor(Math.random() * bobs.length)];
        b.amp = Math.min(0.95, b.amp + 0.18);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const tick = (now) => {
        const t = (now - start) / 1000;

        ctx.clearRect(0, 0, c.w, c.h);

        // The rack.
        ctx.fillStyle = 'rgba(58,50,40,0.85)';
        ctx.fillRect(x0 - 14, railY - 5, dx * (N - 1) + 28, 6);
        ctx.fillStyle = 'rgba(96,84,66,0.85)';
        ctx.fillRect(x0 - 14, railY - 5, dx * (N - 1) + 28, 2);

        for (const b of bobs) {
          b.amp += (0.55 - b.amp) * 0.0016;
          // Free swing, undamped in the model: the amplitude is only nudged
          // by typing, so the rack keeps its recurrence for as long as you
          // leave it running.
          const ang = Math.sin((t / b.T) * Math.PI * 2) * b.amp;
          const px = x0 + b.i * dx;
          const bx = px + Math.sin(ang) * b.L;
          const by = railY + Math.cos(ang) * b.L;

          ctx.strokeStyle = 'rgba(180,170,150,0.28)';
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(px, railY);
          ctx.lineTo(bx, by);
          ctx.stroke();

          // Brass: a warm body with a cool rim light and one specular dot.
          const r = 7;
          const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.4, r * 0.15, bx, by, r);
          g.addColorStop(0, 'rgba(248,226,168,0.95)');
          g.addColorStop(0.6, 'rgba(196,158,84,0.92)');
          g.addColorStop(1, 'rgba(96,74,40,0.92)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,248,224,0.8)';
          ctx.beginPath();
          ctx.arc(bx - r * 0.35, by - r * 0.42, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Obsidian — black glass, and you are what breaks it.
  //
  // Obsidian has no crystal structure, so it does not cleave along planes: it
  // fractures *conchoidally*, in nested shell-shaped ripples spreading from
  // wherever it was struck. That is the only thing worth drawing here, and
  // getting it right is the difference between this and a black rectangle
  // with cracks on it — a straight crack reads as ice or as a broken screen,
  // never as glass.
  //
  // So a fracture is a point of impact and a stack of arcs around it, each
  // one a little further out and a little more ragged, drawn as ripples
  // rather than as lines. A raking light sweeps across the surface and a
  // ripple is only visible while the light is on it, which is exactly how you
  // find a conchoidal surface with a torch: the ripples appear, travel, and
  // go out again as you move.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.obsidian = {
    start() {
      const bk = back();
      if (!bk) return;
      const c = makeCanvas(bk, 'fx-obsidian-canvas');
      const ctx = c.ctx;
      const rand = (a, b) => a + Math.random() * (b - a);

      let fractures = [];

      const resize = () => {
        const pw = c.w, ph = c.h;
        c.resize();
        if (pw && ph) {
          const sx = c.w / pw, sy = c.h / ph;
          for (const f of fractures) { f.x *= sx; f.y *= sy; }
        }
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // One impact: a stack of ripples, each stored as its own set of radii
      // around the circle so the shell is irregular the way a real one is.
      const strike = (x, y) => {
        const rings = 5 + Math.floor(Math.random() * 5);
        const spread = rand(0.9, 1.5);         // how elongated the shell is
        const rot = rand(0, Math.PI * 2);
        const arcs = [];
        for (let r = 0; r < rings; r++) {
          const base = 14 + r * rand(11, 20);
          const n = 26;
          const rad = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            // Two harmonics of wobble: the low one gives the shell its
            // overall lopsidedness, the high one the chatter along the edge.
            const th = (i / n) * Math.PI * 2;
            rad[i] = base * (1 + Math.sin(th * 2 + rot) * 0.16 + Math.sin(th * 7 + r) * 0.05);
          }
          arcs.push({ rad, n, w: 1.4 - r * 0.12 });
        }
        fractures.push({ x, y, arcs, spread, rot, born: performance.now(), life: 1 });
        if (fractures.length > 7) fractures.shift();
      };

      let keys = 0;
      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        if (++keys % 9) return;
        const p = caretRect();
        strike(p ? p.x : rand(0, c.w), p ? (p.top + p.bottom) / 2 : rand(0, c.h));
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        ctx.clearRect(0, 0, c.w, c.h);

        // The raking light: a soft band crossing the surface at an angle,
        // once every twenty seconds or so.
        const sweepU = ((now / 21000) % 1) * 2 - 0.5;
        const ang = -0.5;
        const nx = Math.cos(ang), ny = Math.sin(ang);
        const reach = Math.abs(c.w * nx) + Math.abs(c.h * ny);
        const sweep = sweepU * reach;
        const lightAt = (x, y) => {
          const u = x * nx + y * ny;
          const d = Math.abs(u - sweep);
          return Math.max(0, 1 - d / (reach * 0.24));
        };

        // The body of the stone: near-black with a broad sheen where the
        // light is. Obsidian is glossy, so this is a wide soft highlight and
        // not a texture.
        const gx0 = sweep * nx, gy0 = sweep * ny;
        const g = ctx.createLinearGradient(
          gx0 - nx * reach * 0.3, gy0 - ny * reach * 0.3,
          gx0 + nx * reach * 0.3, gy0 + ny * reach * 0.3);
        g.addColorStop(0, 'rgba(143,163,184,0)');
        g.addColorStop(0.5, 'rgba(143,163,184,0.055)');
        g.addColorStop(1, 'rgba(143,163,184,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.w, c.h);

        fractures = fractures.filter((f) => {
          f.life -= dt * 0.006;
          if (f.life <= 0) return false;
          const age = Math.min(1, (now - f.born) / 700);
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(f.rot);
          ctx.scale(f.spread, 1 / f.spread);
          for (let a = 0; a < f.arcs.length; a++) {
            const arc = f.arcs[a];
            // Ripples appear one after another as the fracture propagates.
            const on = Math.max(0, Math.min(1, age * f.arcs.length - a));
            if (on <= 0) continue;
            ctx.beginPath();
            for (let i = 0; i <= arc.n; i++) {
              const th = (i % arc.n) / arc.n * Math.PI * 2;
              const r = arc.rad[i % arc.n];
              const px = Math.cos(th) * r, py = Math.sin(th) * r;
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            // Brightness comes from the sweep, sampled at the ripple's own
            // position rather than the fracture's — a big shell should light
            // up along one side first.
            const wx = f.x + Math.cos(f.rot) * arc.rad[0] * f.spread * 0.4;
            const wy = f.y + Math.sin(f.rot) * arc.rad[0] * 0.4;
            const lum = 0.08 + lightAt(wx, wy) * 0.7;
            ctx.strokeStyle = 'rgba(196,214,234,' + (lum * on * f.life * 0.5).toFixed(3) + ')';
            ctx.lineWidth = arc.w;
            ctx.stroke();
          }
          ctx.restore();

          // The point of impact keeps a cold glint.
          const lum = 0.1 + lightAt(f.x, f.y) * 0.9;
          ctx.fillStyle = 'rgba(226,238,250,' + (lum * f.life * 0.5).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(f.x, f.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
          return true;
        });

        rafId = requestAnimationFrame(tick);
      };
      // A stone that has been handled before you got here.
      setTimeout(() => {
        strike(c.w * 0.32, c.h * 0.42);
        strike(c.w * 0.68, c.h * 0.66);
      }, 60);
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Nacre — the inside of a shell.
  //
  // The colour in mother of pearl is not pigment. It is interference: the
  // shell is built from stacks of aragonite platelets a few hundred
  // nanometres thick, and light reflecting off the top of a stack arrives
  // out of step with light reflecting off the bottom, so some wavelengths
  // cancel and what is left is a colour that depends on the thickness and on
  // the angle you are looking from. Tilt the shell and every colour moves.
  //
  // That is modelled here rather than faked with a rainbow gradient: each
  // band carries a *thickness*, the hue is a function of that thickness and
  // of a viewing angle that drifts, and the whole sheet shifts together when
  // the angle changes. Faking it with a fixed spectrum gives you an oil
  // slick, which is the same physics but the wrong material — oil is a
  // single film and the colours are broad; nacre is a stack and the bands
  // are narrow and repeat.
  //
  // The bands are growth lines, so they nest around where the shell started.
  // Writing lays down another one.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.nacre = {
    start() {
      const bk = back();
      if (!bk) return;
      const c = makeCanvas(bk, 'fx-nacre-canvas');
      const ctx = c.ctx;
      const rand = (a, b) => a + Math.random() * (b - a);

      let bands = [];
      let originX = 0, originY = 0;

      const build = () => {
        originX = c.w * 0.18;
        originY = c.h * 1.02;
        bands = [];
        // Growth lines out from the umbo. Spacing widens as the shell gets
        // bigger, which is why the bands are close together at the hinge.
        let r = Math.min(c.w, c.h) * 0.18;
        while (r < Math.hypot(c.w, c.h) * 1.15) {
          bands.push({
            r,
            thick: rand(0.25, 0.95),          // relative platelet thickness
            wob: rand(0, 6.28),
            w: rand(6, 22)
          });
          r += rand(9, 26) * (1 + r / Math.max(c.w, c.h));
        }
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        // A keystroke nudges the thickness of whichever band is nearest the
        // caret, so the colours move where you are working.
        const p = caretRect();
        if (!p) return;
        const d = Math.hypot(p.x - originX, (p.top + p.bottom) / 2 - originY);
        let best = null, bd = 1e9;
        for (const b of bands) {
          const dd = Math.abs(b.r - d);
          if (dd < bd) { bd = dd; best = b; }
        }
        if (best) best.thick = Math.min(1, Math.max(0.12, best.thick + rand(-0.06, 0.06)));
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // Thin-film interference, cheaply: the path difference is proportional
      // to thickness times the cosine of the refracted angle, and the hue is
      // that difference taken modulo one order. Two orders are visible in
      // nacre, which is why the sequence repeats.
      const filmColour = (thick, angle, order) => {
        const path = thick * Math.cos(angle * 0.9) * 2.2 + order * 0.33;
        const hue = ((path * 360) % 360 + 360) % 360;
        return hue;
      };

      const tick = (now) => {
        // The viewing angle drifts, slowly. This is the whole animation:
        // nothing moves, the light does.
        const view = Math.sin(now / 9000) * 0.55 + Math.sin(now / 21000) * 0.35;

        ctx.clearRect(0, 0, c.w, c.h);
        ctx.globalCompositeOperation = 'source-over';

        for (const b of bands) {
          const hue = filmColour(b.thick, view + b.wob * 0.06, 0);
          // Pale and desaturated. This is a light theme and the note has to
          // stay readable through it; nacre is a *sheen* on white, not a
          // stained-glass window.
          ctx.strokeStyle = 'hsla(' + hue.toFixed(0) + ',52%,72%,0.20)';
          ctx.lineWidth = b.w;
          ctx.beginPath();
          // Not a circle: a growth line is flatter along the hinge, so the
          // radius is modulated with the angle.
          for (let i = 0; i <= 48; i++) {
            const th = -Math.PI + (i / 48) * Math.PI;
            const rr = b.r * (1 + Math.sin(th * 2 + b.wob) * 0.10 + Math.sin(th * 5 + b.wob * 2) * 0.03);
            const px = originX + Math.cos(th) * rr * 1.35;
            const py = originY + Math.sin(th) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();

          // The second order, offset and thinner: this is what makes it read
          // as nacre rather than as a soap bubble.
          const hue2 = filmColour(b.thick, view + b.wob * 0.06, 1);
          ctx.strokeStyle = 'hsla(' + hue2.toFixed(0) + ',44%,80%,0.13)';
          ctx.lineWidth = b.w * 0.4;
          ctx.stroke();
        }

        // A broad pearl highlight that moves against the bands, so the sheet
        // reads as curved.
        const hx = c.w * (0.5 + Math.sin(now / 13000) * 0.3);
        const hy = c.h * (0.35 + Math.cos(now / 17000) * 0.2);
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(c.w, c.h) * 0.55);
        g.addColorStop(0, 'rgba(255,255,255,0.30)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.w, c.h);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };

  // A shared piece for the retro scenes: a window with somebody behind it.
  // A solid opening with a soft blended falloff around it, squashed
  // vertically because a window is taller than it is wide and so is its glow.
  // Worked out in Barrel Fire — a single bright pixel is a star, this is a
  // room — and repeated in enough scenes now to be worth having once.
  function retroLitWindow(R, wx, wy, col, strength) {
    for (let dy = -2; dy <= 3; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && (dy === 0 || dy === 1)) continue;
        const d = Math.hypot(dx * 1.35, (dy - 0.5) * 0.75);
        const f = 1 - d / 2.9;
        if (f > 0) R.blend(wx + dx, wy + dy, col, f * f * 0.34 * strength);
      }
    }
    R.rect(wx, wy, 1, 2, col);
  }

  // A cone of light. Blended, never stippled: stippling puts a third of the
  // pixels at full lamp colour and the cone comes out as a solid triangle with
  // a ragged edge. A lit cone is dim light over a whole area.
  function retroCone(R, hx, hy, spread, strength, col) {
    for (let y = hy; y < R.H; y++) {
      const k = (y - hy) / Math.max(1, R.H - hy);
      const w = 1.5 + k * R.H * spread;
      for (let dx = -w; dx <= w; dx++) {
        const across = 1 - Math.abs(dx) / w;
        if (across <= 0) continue;
        R.blend((hx + dx) | 0, y, col, across * across * (1 - k * 0.7) * strength);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Ferris Wheel — a small fair on the edge of town, at the hour when the
  // sky has gone and the lights have not yet won.
  //
  // The other Nostalgia scenes are all a cold street at night. This one is
  // dusk: the sky is still warm at the horizon and everything in front of it
  // is a silhouette, which is a completely different picture out of the same
  // renderer and the reason it earns its place next to them.
  //
  // The wheel is built the way a wheel is: a hub, spokes at equal angles, and
  // gondolas hung from the rim that stay upright as it turns — that last part
  // is the whole difference between a wheel and a rotating decal. The rim
  // bulbs chase, offset by angle, so the light appears to run around the rim
  // rather than blinking in place.
  //
  // Typing turns it. Write and the wheel picks up; stop and it coasts down to
  // a slow idle.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.fair = {
    start() {
      const b = back();
      if (!b) return;
      const R = makeRetro(b, 4);

      const SKY = [[18, 14, 34], [38, 24, 54], [74, 40, 62], [126, 66, 62], [186, 108, 66]];
      const CLOUD = [[52, 34, 56], [86, 52, 62], [140, 82, 66]];
      const FAR = [22, 16, 30];
      // Lifted well out of black. A fairground is not a dark field: it is a
      // dark field with a great deal of light thrown across it, and the ground
      // is where you see that light.
      const GROUND = [[30, 22, 30], [42, 31, 40], [56, 42, 52]];
      const STEEL = [40, 36, 48];
      const STEEL_HI = [78, 72, 88];
      const BULB = [255, 232, 176];
      const BULB_RED = [252, 118, 96];
      const BULB_GRN = [130, 234, 156];
      const CANOPY_A = [206, 74, 66];
      const CANOPY_B = [232, 216, 190];
      const PERSON = [14, 11, 16];
      const TENT = [40, 30, 34];

      let horizon = 0, groundY = 0, hubX = 0, hubY = 0, rad = 0;
      let carX = 0, carY = 0, carR = 0;
      let people = [], bunting = [];
      let spin = 0, speed = 0.20;
      let t = 0, nextFrame = 0;

      const build = () => {
        // The clear part of the window is roughly the middle 55% — the note
        // list covers the left and the placeholder panel the right — so the
        // wheel goes there rather than centred on a window it does not have.
        horizon = Math.round(R.H * 0.62);
        groundY = Math.round(R.H * 0.72);
        rad = Math.round(Math.min(R.W * 0.16, R.H * 0.26));
        hubX = Math.round(R.W * 0.56);
        hubY = groundY - rad - Math.round(R.H * 0.05);
        carR = Math.round(rad * 0.42);
        carX = Math.round(R.W * 0.28);
        carY = groundY - Math.round(carR * 0.5);

        people = [];
        const n = Math.max(4, Math.round(R.W / 26));
        for (let i = 0; i < n; i++) {
          people.push({
            x: R.hash(i, 3) * R.W,
            h: 5 + Math.round(R.hash(i, 9) * 3),
            v: (R.hash(i, 5) - 0.5) * 0.09,
            ph: R.hash(i, 7) * 6.28
          });
        }
        bunting = [];
        for (let x = 0; x < R.W; x += 7) bunting.push(x);
      };
      const resize = () => { R.resize(); build(); nextFrame = 0; };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        speed = Math.min(1.5, speed + 0.05);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / 15;
        t += 1;
        speed += (0.20 - speed) * 0.012;
        spin += speed * 0.026;

        // ── dusk. The warm band is at the bottom, which is the whole reason
        // this reads as evening rather than as morning: the light is leaving
        // from underneath.
        R.vgrad(0, horizon + 2, SKY, 1.5);
        for (let i = 0; i < 4; i++) {
          const cy = Math.round(R.H * (0.12 + i * 0.09));
          const cw = Math.round(R.W * (0.5 - i * 0.06));
          const cx = ((t * 0.04 + i * 41) % (R.W + cw)) - cw / 2;
          for (let dx = 0; dx < cw; dx++) {
            const f = Math.sin((dx / cw) * Math.PI);
            for (let dy = 0; dy < 2 + (i & 1); dy++) {
              R.blend(cx + dx, cy + dy, CLOUD[i % 3], f * 0.5);
            }
          }
        }

        // ── the far edge of the field, and a couple of tents
        for (let x = 0; x < R.W; x++) {
          const h = 3 + Math.round(R.hash(x >> 3, 5) * 4);
          for (let y = horizon - h; y < groundY; y++) R.px(x, y, FAR);
        }
        const tentAt = (tx, tw, th) => {
          for (let dx = -tw; dx <= tw; dx++) {
            const hh = Math.round(th * (1 - Math.abs(dx) / (tw + 0.5)));
            for (let y = groundY - hh; y < groundY; y++) R.px(tx + dx, y, TENT);
          }
          // A lit doorway, because a dark tent is a hill.
          retroLitWindow(R, tx, groundY - 4, BULB, 0.7);
        };
        tentAt(Math.round(R.W * 0.06), 9, 13);
        tentAt(Math.round(R.W * 0.88), 7, 10);

        // ── the carousel: a striped canopy that turns, and a pole
        for (let dx = -carR; dx <= carR; dx++) {
          const hh = Math.round(carR * 0.42 * (1 - Math.abs(dx) / (carR + 0.5)));
          // The stripe index is shifted by the spin, which is what makes a
          // static cone read as a turning one.
          const stripe = Math.floor((Math.asin(Math.max(-1, Math.min(1, dx / carR))) * 3
            + spin * 1.6) / 0.7) & 1;
          for (let y = carY - hh; y < carY; y++) R.px(carX + dx, y, stripe ? CANOPY_A : CANOPY_B);
          if (Math.abs(dx) === carR || (dx + carR) % 6 === 0) {
            for (let y = carY; y < groundY; y++) R.px(carX + dx, y, STEEL);
          }
        }
        for (let dx = -carR; dx <= carR; dx += 3) {
          R.blend(carX + dx, carY, BULB, 0.5 + 0.5 * Math.sin(spin * 3 + dx));
        }

        // ── the wheel
        const legs = [[hubX - rad * 0.7, groundY], [hubX + rad * 0.7, groundY]];
        for (const [lx, ly] of legs) {
          const steps = Math.max(2, Math.round(rad));
          for (let i = 0; i <= steps; i++) {
            const k = i / steps;
            R.px(Math.round(hubX + (lx - hubX) * k), Math.round(hubY + (ly - hubY) * k), STEEL);
            R.px(Math.round(hubX + (lx - hubX) * k) + 1,
              Math.round(hubY + (ly - hubY) * k), STEEL);
          }
        }
        const SPOKES = 12;
        for (let i = 0; i < SPOKES; i++) {
          const a = spin + (i / SPOKES) * Math.PI * 2;
          const ex = hubX + Math.cos(a) * rad, ey = hubY + Math.sin(a) * rad;
          const steps = Math.round(rad);
          for (let k2 = 0; k2 <= steps; k2++) {
            const k = k2 / steps;
            R.px(hubX + (ex - hubX) * k, hubY + (ey - hubY) * k, STEEL_HI);
          }
          // Gondolas hang from the rim and stay level. A box that rotates with
          // the wheel is the single most common way to draw this wrong.
          const gx = Math.round(ex), gy = Math.round(ey) + 3;
          for (let dx = -2; dx <= 2; dx++) {
            for (let dy = 0; dy < 3; dy++) R.px(gx + dx, gy + dy, dy === 0 ? STEEL_HI : STEEL);
          }
          R.px(gx, gy - 1, STEEL);
          if (R.hash(i, 11) > 0.45) R.blend(gx, gy + 1, BULB, 0.55);
        }
        // The rim, and the bulbs chasing round it.
        for (let i = 0; i < 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          const x = hubX + Math.cos(a) * rad, y = hubY + Math.sin(a) * rad;
          R.px(x, y, STEEL_HI);
          if (i % 4) continue;
          const phase = Math.sin(a * 3 - spin * 6);
          if (phase < 0.2) continue;
          const col = (i % 12 === 0) ? BULB_RED : (i % 8 === 0 ? BULB_GRN : BULB);
          R.blend(x, y, col, 0.95);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              R.blend(x + dx, y + dy, col, 0.22);
            }
          }
        }
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.hypot(dx, dy) <= 2) R.px(hubX + dx, hubY + dy, STEEL_HI);
          }
        }

        // ── bunting across the top, sagging between its posts
        for (const x of bunting) {
          const k = (x % 56) / 56;
          const sag = Math.sin(k * Math.PI) * 5 + Math.sin(t * 0.03 + x * 0.1) * 0.6;
          const y = Math.round(R.H * 0.07 + sag);
          const col = [BULB, BULB_RED, BULB_GRN][(x / 7 | 0) % 3];
          R.blend(x, y, col, 0.85);
          R.blend(x, y + 1, col, 0.2);
        }

        // ── ground, and people on it. The wheel and the carousel throw light
        // down onto it — without this the bottom third is a black band and the
        // fair looks like it is floating.
        R.vgrad(groundY, R.H, GROUND, 0.7);
        for (const [gx, gs] of [[hubX, 0.55], [carX, 0.40]]) {
          for (let y = groundY; y < R.H; y++) {
            const k = (y - groundY) / Math.max(1, R.H - groundY);
            for (let x = 0; x < R.W; x++) {
              const d = Math.abs(x - gx) / (R.W * 0.34);
              if (d > 1) continue;
              R.blend(x, y, BULB, (1 - d) * (1 - d) * (1 - k) * gs * 0.16);
            }
          }
        }
        for (const p of people) {
          p.x += p.v;
          if (p.x < -2) p.x = R.W + 2;
          if (p.x > R.W + 2) p.x = -2;
          const bob = Math.sin(t * 0.12 + p.ph) > 0 ? 0 : 1;
          const bx = Math.round(p.x), by = groundY + 4 + bob;
          for (let y = by - p.h; y < by; y++) R.px(bx, y, PERSON);
          R.px(bx, by - p.h - 1, PERSON);
          R.px(bx - 1, by - p.h + 1, PERSON);
          R.px(bx + 1, by - p.h + 1, PERSON);
        }

        R.flush();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };
  // ────────────────────────────────────────────────────────────────────────
  // Bedroom — somebody's room, late, with the television left on.
  //
  // The one interior in Nostalgia, and it needed to be: three exteriors in a
  // row all solve the same lighting problem the same way. Indoors the rules
  // invert.
  //
  // ── The light
  //
  // Traced rather than faked. The screen is an **area light** — a segment,
  // sampled across its face — and the furniture is a list of opaque
  // rectangles. For every cell, a ray to each sample; the fraction that
  // arrive is the visibility. Sampling an area rather than a point is what
  // produces a *penumbra*: near a shadow's edge some samples are blocked and
  // some are not, so the edge is soft, and softens with distance from the
  // caster on its own. That one property is most of what makes traced light
  // look traced. Rays are tested against rectangles analytically (the slab
  // method) rather than marched — exact, faster, and without the stair
  // stepping along shadow edges that gives these things away.
  //
  // Then one bounce: a blur of the direct buffer added back at a fraction.
  // Light landing on the carpet does not stop there. Without it the shadows
  // are pure black, which is the other way a lit room gives itself away.
  //
  // **Two lights, both cold.** The first pass had one warm one and the room
  // came out a single flat wash of amber — a tint, not lighting. What fixes
  // it is a second source with a different colour *and a different direction*:
  // the balcony door, carrying the dead blue of a city at four in the
  // morning. Two cold sources crossing is what gives a surface a lit side and
  // an unlit side, and the only warm thing left in the room is the lava lamp,
  // which is small, local, and the better for being the only one.
  //
  // The whole solve runs on a half-resolution grid, is filtered back up, and
  // runs once per size rather than once per frame — the geometry does not
  // move. What changes every frame is colour and strength.
  //
  // The set is between channels. Typing retunes it.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.bedroom = {
    start() {
      const b = back();
      if (!b) return;
      const R = makeRetro(b, 4);

      const WALL = [27, 26, 34];
      const WALL_DK = [17, 16, 22];
      const SKIRT = [38, 33, 30];
      const CARPET = [31, 26, 29];
      const RUG = [58, 40, 44];
      const RUG_HI = [78, 56, 58];
      const TV_BODY = [30, 28, 33];
      const TV_HI = [58, 55, 63];
      const SNOW_A = [216, 222, 234];
      const SNOW_B = [88, 92, 104];
      const FILM_A = [222, 226, 232];
      const FILM_B = [120, 124, 134];
      const FILM_C = [26, 27, 32];
      const BARS = [[196, 196, 196], [190, 186, 70], [70, 186, 190], [70, 186, 70],
        [186, 70, 186], [186, 70, 70], [70, 70, 186]];
      const POSTER = [44, 34, 58];
      const POSTER_INK = [132, 112, 158];
      const WOOD = [62, 46, 34];
      const WOOD_HI = [86, 66, 48];
      const WOOD_DK = [38, 28, 21];
      const LAVA = [238, 104, 72];
      const FLAME_LIT = [255, 186, 108];
      const LAVA_DIM = [86, 34, 30];
      const STAR = [150, 214, 160];
      const NIGHT = [8, 11, 22];
      const CITY = [70, 96, 138];
      const CITY_WIN = [186, 196, 224];
      const RAIL = [46, 48, 58];
      const GLASS = [22, 30, 48];
      const FRAME = [48, 40, 33];
      const BED = [38, 32, 38];
      const BED_HI = [60, 52, 60];
      const QUILT = [62, 44, 50];
      const PILLOW = [104, 100, 108];

      let ceil = 0, floorY = 0;
      let tvX = 0, tvY = 0, tvW = 0, tvH = 0;
      let balX = 0, balY = 0, balW = 0;
      let wdX = 0, wdY = 0, wdW = 0;
      let lampX = 0, lampY = 0;
      let bedX = 0, bedW = 0, bedY = 0;
      let canX = 0, canY = 0;          // the candle, on a side table
      let flakes = [], stars = [], cityWin = [], occ = [];
      let LW = 0, LH = 0, dTv = null, bTv = null, dBal = null, bBal = null;
      let dCan = null, bCan = null, tmp = null;
      let solved = false;
      let tune = 0, channel = 0, flicker = 1;
      let t = 0, nextFrame = 0;

      const build = () => {
        ceil = Math.round(R.H * 0.09);
        floorY = Math.round(R.H * 0.72);

        // Everything lives between 20% and 80% of the width — the note list
        // covers the left of the window and the placeholder panel the right,
        // and furniture outside that band is furniture nobody sees.
        balX = Math.round(R.W * 0.19); balW = Math.round(R.W * 0.13);
        balY = Math.round(R.H * 0.15);
        wdX = Math.round(R.W * 0.335); wdW = Math.round(R.W * 0.095);
        wdY = Math.round(R.H * 0.26);
        tvW = Math.round(R.W * 0.135); tvH = Math.round(tvW * 0.74);
        tvX = Math.round(R.W * 0.455);
        tvY = floorY - Math.round(R.H * 0.07) - tvH;
        lampX = wdX + Math.round(wdW * 0.5);
        lampY = wdY;
        bedX = Math.round(R.W * 0.605); bedW = Math.round(R.W * 0.17);
        // A side table by the balcony, in the one corner of the room neither
        // the set nor the doorway reaches.
        canX = Math.round(R.W * 0.255);
        canY = floorY - Math.round(R.H * 0.07);
        bedY = floorY - Math.round(R.H * 0.05);

        occ = [
          { x0: wdX, y0: wdY, x1: wdX + wdW, y1: floorY },                       // wardrobe
          { x0: lampX - 3, y0: lampY - 11, x1: lampX + 3, y1: lampY },           // lava lamp
          { x0: tvX - 3, y0: tvY - 3, x1: tvX + tvW + 3, y1: tvY + tvH + 4 },    // the set
          { x0: tvX - 1, y0: floorY - Math.round(R.H * 0.07), x1: tvX + tvW + 1, y1: floorY },
          { x0: bedX, y0: bedY - 7, x1: bedX + bedW, y1: floorY + 5 },           // bed
          { x0: bedX + bedW - 4, y0: bedY - 19, x1: bedX + bedW, y1: bedY },     // headboard
          { x0: canX - 6, y0: canY, x1: canX + 6, y1: floorY }                   // side table
        ];

        LW = Math.max(4, R.W >> 1);
        LH = Math.max(4, R.H >> 1);
        dTv = new Float32Array(LW * LH); bTv = new Float32Array(LW * LH);
        dBal = new Float32Array(LW * LH); bBal = new Float32Array(LW * LH);
        dCan = new Float32Array(LW * LH); bCan = new Float32Array(LW * LH);
        tmp = new Float32Array(LW * LH);
        solved = false;

        flakes = [];
        const n = Math.round(balW * (floorY - balY) / 22);
        for (let i = 0; i < n; i++) {
          flakes.push({
            x: Math.random() * balW, y: Math.random() * (floorY - balY),
            v: 0.25 + Math.random() * 0.5, sway: Math.random() * 6.28
          });
        }
        stars = [];
        for (let i = 0; i < 20; i++) {
          stars.push({
            x: R.hash(i, 3) * R.W,
            y: 1 + R.hash(i, 7) * Math.max(1, ceil - 2),
            ph: R.hash(i, 5) * 6.28
          });
        }
        // The city across the way, seen through the doorway. Fixed so the
        // windows do not crawl about between frames.
        cityWin = [];
        for (let i = 0; i < 46; i++) {
          cityWin.push({
            x: R.hash(i, 11) * balW,
            y: R.hash(i, 17) * (floorY - balY) * 0.55,
            on: R.hash(i, 23),
            ph: R.hash(i, 29) * 6.28
          });
        }
      };
      const resize = () => { R.resize(); build(); nextFrame = 0; };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let lastKey = -1e9;
      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        lastKey = performance.now();
        tune = Math.max(0, tune - 0.35);
        if (Math.random() < 0.14) channel = (channel + 1) % 4;
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // Segment against axis-aligned rectangle, slab method: clip the ray's
      // parameter range on each axis and see whether anything survives.
      const blocked = (x0, y0, x1, y1, r) => {
        const dx = x1 - x0, dy = y1 - y0;
        let tmin = 0, tmax = 1;
        if (dx === 0) {
          if (x0 < r.x0 || x0 > r.x1) return false;
        } else {
          const inv = 1 / dx;
          let a = (r.x0 - x0) * inv, bb = (r.x1 - x0) * inv;
          if (a > bb) { const s = a; a = bb; bb = s; }
          if (a > tmin) tmin = a;
          if (bb < tmax) tmax = bb;
          if (tmin > tmax) return false;
        }
        if (dy === 0) {
          if (y0 < r.y0 || y0 > r.y1) return false;
        } else {
          const inv = 1 / dy;
          let a = (r.y0 - y0) * inv, bb = (r.y1 - y0) * inv;
          if (a > bb) { const s = a; a = bb; bb = s; }
          if (a > tmin) tmin = a;
          if (bb < tmax) tmax = bb;
          if (tmin > tmax) return false;
        }
        return true;
      };

      const SAMPLES = 7;
      // Trace one area light — a segment from (ax,ay) to (bx,by) — into `out`.
      const trace = (ax, ay, bx, by, reach, out) => {
        for (let cy = 0; cy < LH; cy++) {
          const py = cy * 2 + 1;
          for (let cx = 0; cx < LW; cx++) {
            const px = cx * 2 + 1;
            let sum = 0;
            for (let s = 0; s < SAMPLES; s++) {
              const k = s / (SAMPLES - 1);
              const lx = ax + (bx - ax) * k, ly = ay + (by - ay) * k;
              const dx = px - lx, dy = py - ly;
              const d2 = dx * dx + dy * dy;
              // Inverse square, softened near the source so cells right in
              // front of the glass do not blow out.
              const fall = 1 / (1 + d2 / (R.W * R.W * reach));
              if (fall < 0.004) continue;
              let hit = false;
              for (let i = 0; i < occ.length; i++) {
                if (blocked(lx, ly, px, py, occ[i])) { hit = true; break; }
              }
              if (!hit) sum += fall;
            }
            out[cy * LW + cx] = sum / SAMPLES;
          }
        }
      };

      // Separable box blur — the one bounce.
      const blur = (src, out) => {
        const rad = 3;
        for (let cy = 0; cy < LH; cy++) {
          let acc = 0;
          for (let cx = -rad; cx <= rad; cx++) acc += src[cy * LW + Math.min(LW - 1, Math.max(0, cx))];
          for (let cx = 0; cx < LW; cx++) {
            tmp[cy * LW + cx] = acc / (rad * 2 + 1);
            acc += src[cy * LW + Math.min(LW - 1, cx + rad + 1)] - src[cy * LW + Math.max(0, cx - rad)];
          }
        }
        for (let cx = 0; cx < LW; cx++) {
          let acc = 0;
          for (let cy = -rad; cy <= rad; cy++) acc += tmp[Math.min(LH - 1, Math.max(0, cy)) * LW + cx];
          for (let cy = 0; cy < LH; cy++) {
            out[cy * LW + cx] = acc / (rad * 2 + 1);
            acc += tmp[Math.min(LH - 1, cy + rad + 1) * LW + cx] - tmp[Math.max(0, cy - rad) * LW + cx];
          }
        }
      };

      const solve = () => {
        trace(tvX + 1, tvY + tvH * 0.5, tvX + tvW - 1, tvY + tvH * 0.5, 0.10, dTv);
        blur(dTv, bTv);
        // The doorway is a tall source, so its segment is vertical — which is
        // why it rakes across the floor instead of pooling like the set does.
        trace(balX + balW * 0.5, balY + 4, balX + balW * 0.5, floorY - 4, 0.055, dBal);
        blur(dBal, bBal);
        // A candle is very nearly a point, so its segment is one cell long and
        // its reach is short — which is the whole character of it. A candle
        // that lights a room is a lamp.
        trace(canX, canY - 9, canX, canY - 8, 0.012, dCan);
        blur(dCan, bCan);
      };

      const sample = (buf, blr, x, y) => {
        const fx = Math.max(0, Math.min(LW - 1.001, (x - 1) / 2));
        const fy = Math.max(0, Math.min(LH - 1.001, (y - 1) / 2));
        const ix = fx | 0, iy = fy | 0;
        const tx = fx - ix, ty = fy - iy;
        const i = iy * LW + ix;
        const d = buf[i] * (1 - tx) * (1 - ty) + buf[i + 1] * tx * (1 - ty) +
          buf[i + LW] * (1 - tx) * ty + buf[i + LW + 1] * tx * ty;
        const g = blr[i] * (1 - tx) * (1 - ty) + blr[i + 1] * tx * (1 - ty) +
          blr[i + LW] * (1 - tx) * ty + blr[i + LW + 1] * tx * ty;
        return d + g * 0.6;
      };

      // What the screen is showing, and therefore what colour the room is.
      // Deliberately close to neutral: a television at this distance lights a
      // room grey-blue, and a saturated tint here washes the whole scene into
      // one colour, which was the first version's problem.
      const screenColour = () => {
        if (tune < 0.5) return [150, 158, 176];
        return [[164, 168, 178], [150, 162, 186], [172, 160, 158], [148, 168, 168]][channel];
      };

      // One cell of the picture. Four channels and the snow, drawn from
      // scratch rather than as abstract bands — a shape you can name is worth
      // more at this size than a pattern.
      const picture = (x, y, u, v) => {
        const n = R.hash(x + t * 131, y + t * 57);
        if (tune < 0.55) return n > 0.5 ? SNOW_A : SNOW_B;
        if (channel === 0) {
          // An old film: letterboxed, a figure walking, a subtitle bar.
          if (v < 0.16 || v > 0.84) return FILM_C;
          const walk = 0.30 + ((t * 0.006) % 1) * 0.45;
          const dxw = Math.abs(u - walk);
          const body = dxw < 0.035 && v > 0.42 && v < 0.72;
          const head = Math.hypot((u - walk) * 2.2, v - 0.38) < 0.06;
          const legs = dxw < 0.05 + Math.abs(Math.sin(t * 0.3)) * 0.03 && v >= 0.72 && v < 0.80;
          if (body || head || legs) return FILM_C;
          if (v > 0.74) return FILM_B;
          return n > 0.97 ? FILM_B : FILM_A;
        }
        if (channel === 1) {
          // Test card: seven bars and a grey stripe under them.
          if (v > 0.78) return FILM_B;
          return BARS[Math.min(BARS.length - 1, Math.floor(u * BARS.length))];
        }
        if (channel === 2) {
          // A horizon with a low sun and a band of water.
          if (v > 0.62) return n > 0.85 ? [96, 128, 150] : [64, 96, 122];
          if (Math.hypot((u - 0.62) * 1.6, v - 0.55) < 0.13) return [236, 208, 150];
          return v < 0.3 ? [96, 110, 140] : [150, 152, 160];
        }
        // A head and shoulders, lit from one side.
        if (v > 0.72) return [56, 60, 74];
        if (Math.hypot((u - 0.5) * 1.5, v - 0.42) < 0.2) {
          return u < 0.5 ? [206, 198, 190] : [128, 122, 118];
        }
        return [40, 46, 62];
      };

      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / 15;
        t += 1;

        tune = Math.min(1, tune + ((now - lastKey) > 1200 ? 0.012 : 0));
        flicker = 0.86 + R.hash(t, 17) * 0.28;
        // A candle wanders rather than strobing: two slow waves plus a little
        // noise, and a lean that the flame is drawn with.
        const candle = 0.78 + Math.sin(t * 0.21) * 0.10 + Math.sin(t * 0.07) * 0.08
          + R.hash(t, 71) * 0.10;
        const lean = Math.sin(t * 0.13) > 0.6 ? 1 : (Math.sin(t * 0.19) < -0.7 ? -1 : 0);
        const glow = screenColour();
        const power = (0.62 + tune * 0.34) * flicker;
        if (!solved) { solve(); solved = true; }

        // ── the shell of the room
        for (let x = 0; x < R.W; x++) {
          for (let y = 0; y < ceil; y++) R.px(x, y, WALL_DK);
          for (let y = ceil; y < floorY; y++) R.px(x, y, WALL);
          for (let y = floorY - 3; y < floorY; y++) R.px(x, y, SKIRT);
          for (let y = floorY; y < R.H; y++) R.px(x, y, CARPET);
        }
        // A rug in front of the set, with a border.
        const rugX0 = tvX - Math.round(R.W * 0.10), rugX1 = tvX + tvW + Math.round(R.W * 0.06);
        for (let x = rugX0; x < rugX1; x++) {
          for (let y = floorY + 4; y < R.H - 2; y++) {
            const edge = (x - rugX0 < 3 || rugX1 - x < 4 || y < floorY + 7 || y > R.H - 6);
            R.px(x, y, edge ? RUG_HI : RUG);
          }
        }

        // ── the balcony: a doorway, a railing, and the city behind it
        for (let x = balX; x < balX + balW; x++) {
          for (let y = balY; y < floorY; y++) R.px(x, y, NIGHT);
        }
        for (const w of cityWin) {
          if (w.on < 0.55) continue;
          const bx = balX + w.x, by = balY + 6 + w.y;
          if (by > floorY - 14) continue;
          R.px(bx, by, CITY_WIN);
          R.blend(bx, by + 1, CITY_WIN, 0.3);
          R.blend(bx - 1, by, CITY_WIN, 0.22);
        }
        for (let x = balX; x < balX + balW; x++) {
          for (let y = floorY - 14; y < floorY - 12; y++) R.px(x, y, CITY);
        }
        // Snow going past outside.
        for (const f of flakes) {
          f.y += f.v;
          f.x += Math.sin(f.sway + t * 0.02) * 0.16;
          if (f.y > floorY - balY) { f.y = 0; f.x = Math.random() * balW; }
          if (f.x < 0) f.x = balW; if (f.x > balW) f.x = 0;
          R.blend(balX + f.x, balY + f.y, [200, 214, 236], 0.5);
        }
        // Railing, and the glass door in front of it.
        for (let x = balX; x < balX + balW; x++) R.px(x, floorY - 20, RAIL);
        for (let x = balX; x < balX + balW; x += 3) {
          for (let y = floorY - 20; y < floorY - 8; y++) R.px(x, y, RAIL);
        }
        for (let x = balX; x < balX + balW; x++) {
          for (let y = balY; y < floorY; y++) R.blend(x, y, GLASS, 0.22);
        }
        for (let y = balY - 1; y <= floorY; y++) {
          R.px(balX - 1, y, FRAME); R.px(balX + balW, y, FRAME);
          R.px(balX + (balW >> 1), y, FRAME);
        }
        for (let x = balX - 1; x <= balX + balW; x++) R.px(x, balY - 1, FRAME);

        // ── the wardrobe
        for (let x = wdX; x < wdX + wdW; x++) {
          for (let y = wdY; y < floorY; y++) {
            const door = ((x - wdX) < (wdW >> 1)) ? 0 : 1;
            const seam = (x - wdX === (wdW >> 1)) || x === wdX || x === wdX + wdW - 1;
            R.px(x, y, seam ? WOOD_DK : (door ? WOOD : WOOD_HI));
          }
          R.px(x, wdY, WOOD_HI);
        }
        R.px(wdX + (wdW >> 1) - 2, wdY + Math.round((floorY - wdY) * 0.45), [172, 152, 110]);
        R.px(wdX + (wdW >> 1) + 2, wdY + Math.round((floorY - wdY) * 0.45), [172, 152, 110]);

        // ── the lava lamp on top of it
        for (let y = lampY - 10; y < lampY; y++) {
          const w = 1 + Math.round(Math.sin((y - (lampY - 10)) / 10 * Math.PI) * 1.4);
          for (let dx = -w; dx <= w; dx++) R.px(lampX + dx, y, LAVA_DIM);
        }
        R.rect(lampX - 2, lampY - 1, 5, 2, [58, 48, 40]);

        // ── the poster, over the bed
        const pX = Math.round(R.W * 0.625), pY = Math.round(R.H * 0.13);
        const pW = Math.round(R.W * 0.11), pH = Math.round(R.H * 0.18);
        for (let x = 0; x < pW; x++) {
          for (let y = 0; y < pH; y++) R.px(pX + x, pY + y, POSTER);
        }
        for (let i = 0; i < 5; i++) {
          const ly = pY + 4 + i * Math.round(pH / 6);
          for (let x = pX + 2; x < pX + pW - 2; x++) {
            if (R.hash(x + i * 13, i) > 0.4) R.px(x, ly, POSTER_INK);
          }
        }

        // ── the bed
        for (let x = bedX; x < bedX + bedW; x++) {
          for (let y = bedY; y < floorY + 5; y++) R.px(x, y, QUILT);
          R.px(x, bedY, BED_HI);
          for (let y = floorY + 5; y < R.H; y++) R.px(x, y, BED);
        }
        for (let y = bedY - 19; y < bedY; y++) {
          for (let x = bedX + bedW - 4; x < bedX + bedW; x++) R.px(x, y, WOOD);
        }
        R.rect(bedX + 2, bedY - 4, 9, 4, PILLOW);
        for (let x = bedX; x < bedX + bedW; x++) {
          R.px(x, bedY + 6 + Math.round(Math.sin(x * 0.4) * 1.2), BED_HI);
        }

        // ── the side table, and the candle on it
        for (let x = canX - 6; x < canX + 6; x++) {
          R.px(x, canY, WOOD_HI);
          for (let y = canY + 1; y < canY + 3; y++) R.px(x, y, WOOD);
        }
        for (const lx of [canX - 4, canX + 3]) {
          for (let y = canY + 3; y < floorY; y++) R.px(lx, y, WOOD_DK);
        }
        // The candle itself: wax, a wick, and a flame that is three colours
        // and never the same shape twice.
        for (let y = canY - 8; y < canY; y++) {
          for (let dx = -1; dx <= 1; dx++) R.px(canX + dx, y, dx === 1 ? [186, 176, 156] : [226, 218, 198]);
        }
        R.px(canX, canY - 9, [70, 60, 50]);

        // ── the television and its stand
        R.rect(tvX - 1, floorY - Math.round(R.H * 0.07), tvW + 2, Math.round(R.H * 0.07), WOOD);
        R.rect(tvX - 1, floorY - Math.round(R.H * 0.07), tvW + 2, 1, WOOD_HI);
        R.rect(tvX - 3, tvY - 3, tvW + 6, tvH + 7, TV_BODY);
        for (let x = tvX - 3; x < tvX + tvW + 3; x++) R.px(x, tvY - 3, TV_HI);
        for (let x = 0; x < tvW; x++) {
          for (let y = 0; y < tvH; y++) {
            R.px(tvX + x, tvY + y, picture(x, y, x / tvW, y / tvH));
          }
        }
        const roll = (t * 3) % (tvH + 20) - 10;
        for (let x = 0; x < tvW; x++) {
          for (let dy = 0; dy < 3; dy++) R.blend(tvX + x, tvY + roll + dy, [255, 255, 255], 0.09);
        }

        // ── the light, over everything but the sources themselves
        const cold = [78, 100, 140];
        for (let y = 0; y < R.H; y++) {
          for (let x = 0; x < R.W; x++) {
            if (x >= tvX && x < tvX + tvW && y >= tvY && y < tvY + tvH) continue;
            if (x >= balX && x < balX + balW && y >= balY && y < floorY) continue;
            const a = sample(dTv, bTv, x, y) * power;
            if (a > 0.004) R.blend(x, y, glow, a > 0.9 ? 0.9 : a);
            const c = sample(dBal, bBal, x, y) * 0.5;
            if (c > 0.004) R.blend(x, y, cold, c > 0.4 ? 0.4 : c);
            const k = sample(dCan, bCan, x, y) * candle;
            if (k > 0.004) R.blend(x, y, FLAME_LIT, k > 0.75 ? 0.75 : k);
          }
        }

        // ── the lava lamp is the only warm thing in the room, and it stays
        // small. A wide warm halo was what turned the whole scene yellow.
        for (let i = 0; i < 3; i++) {
          const p = ((t * 0.008 + i * 0.37) % 1);
          const by = lampY - 9 + p * 8;
          const r = 0.8 + Math.sin(p * Math.PI) * 1.2;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.hypot(dx, dy) <= r) R.blend(lampX + dx, by + dy, LAVA, 0.9);
            }
          }
        }
        for (let dy = -7; dy <= 7; dy++) {
          for (let dx = -7; dx <= 7; dx++) {
            const d = Math.hypot(dx, dy);
            if (d > 7) continue;
            R.blend(lampX + dx, lampY - 5 + dy, LAVA, (1 - d / 7) * (1 - d / 7) * 0.16);
          }
        }

        // ── the flame. Drawn after the lighting pass because it *is* light:
        // put it before, and the room's own light map would dim the one thing
        // in the picture that emits.
        const fh = 3 + Math.round(R.hash(t, 41) * 2);
        for (let i = 0; i < fh; i++) {
          const y = canY - 9 - i;
          const w = i === 0 ? 1 : (i < fh - 1 ? 1 : 0);
          const col = i < 1 ? [255, 246, 214] : (i < fh - 1 ? [255, 196, 96] : [232, 128, 48]);
          for (let dx = -w; dx <= w; dx++) R.blend(canX + dx + lean, y, col, 0.95);
        }
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const d = Math.hypot(dx, dy * 0.8);
            if (d > 5) continue;
            R.blend(canX + dx, canY - 10 + dy, FLAME_LIT, (1 - d / 5) * (1 - d / 5) * 0.5 * candle);
          }
        }

        // ── glow-in-the-dark stars: charged by daylight, fading all night,
        // and the one thing in here neither light reaches.
        for (const st of stars) {
          R.blend(st.x, st.y, STAR, 0.20 + 0.16 * Math.sin(t * 0.02 + st.ph));
        }

        R.flush();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Harbour — the far end of a working dock, on the turn of the tide.
  //
  // The other three scenes are dry. This one is half water, and water at this
  // resolution is not a shader: it is a *reflection*, which means sampling the
  // thing above it, stretching it downwards, and jittering each row sideways.
  // The stretch is what makes it read as water rather than as a mirror, and
  // the jitter is what makes it move. Two lines of code carry the whole
  // bottom half of the picture.
  //
  // The lighthouse sweeps on its own period, and when the beam comes round it
  // lights the harbour rather than only itself — which is the difference
  // between a rotating sprite and a light.
  //
  // Typing brings the ferry in.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.harbour = {
    start() {
      const b = back();
      if (!b) return;
      const R = makeRetro(b, 4);

      const SKY = [[6, 8, 18], [11, 14, 30], [18, 23, 44], [28, 34, 58], [44, 48, 72]];
      const HILL = [10, 13, 22];
      const QUAY = [[20, 20, 26], [28, 28, 35], [36, 36, 44]];
      const WATER = [[16, 32, 50], [22, 44, 66], [30, 58, 84]];
      const WARE = [18, 19, 26];
      const WARE_HI = [30, 32, 42];
      const CRANE = [46, 44, 40];
      const LAMP = [255, 224, 158];
      const WIN = [250, 226, 150];
      const HULL = [24, 26, 34];
      const HULL_HI = [52, 56, 68];
      const BEAM = [246, 240, 214];
      const TOWER = [206, 206, 200];
      const TOWER_RED = [176, 62, 54];

      let horizon = 0, quayY = 0, waterY = 0;
      let lampsAt = [], ferry = null, call = 0;
      let sweep = 0;
      let lhX = 0, lhY = 0, lhH = 0;
      let t = 0, nextFrame = 0;

      const build = () => {
        horizon = Math.round(R.H * 0.34);
        quayY = Math.round(R.H * 0.46);
        waterY = Math.round(R.H * 0.52);
        // Inside the clear part of the window: at 0.86 the tower and most of
        // its beam were behind the placeholder panel.
        lhX = Math.round(R.W * 0.68);
        lhH = Math.round(R.H * 0.24);
        lhY = quayY - lhH;
        lampsAt = [];
        const gap = Math.max(16, Math.round(R.W / 5));
        for (let x = Math.round(gap * 0.4); x < R.W * 0.8; x += gap) lampsAt.push(x);
      };
      const resize = () => { R.resize(); build(); nextFrame = 0; };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      const onKey = (e) => {
        if (e.repeat || !e.key || e.key.length !== 1) return;
        if (!ferry) call = Math.min(1, call + 0.03);
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      // What is above the waterline at a given cell, so the reflection can ask
      // the same question the drawing does rather than keeping a copy of it.
      const above = (x, y) => {
        if (y < 0 || y >= quayY) return null;
        // the quay wall
        if (y >= quayY - 5) return QUAY[1];
        // warehouses along the back
        const blk = x >> 4;
        const wh = 6 + Math.round(R.hash(blk, 5) * 9);
        if (y > quayY - 5 - wh) {
          if (R.hash(x, y) > 0.955) return WIN;
          return (blk & 1) ? WARE_HI : WARE;
        }
        if (y > horizon) return null;
        return null;
      };

      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / 15;
        t += 1;
        sweep += 0.021;

        // ── sky and the hills across the water
        R.vgrad(0, horizon + 2, SKY, 1.1);
        for (let x = 0; x < R.W; x++) {
          const h = 4 + Math.round(Math.sin(x * 0.021) * 3 + R.hash(x >> 4, 7) * 5);
          for (let y = horizon - h; y < quayY - 5; y++) R.px(x, y, HILL);
        }

        // ── warehouses and the quay
        for (let x = 0; x < R.W; x++) {
          for (let y = 0; y < quayY; y++) {
            const c = above(x, y);
            if (c) R.px(x, y, c);
          }
        }
        R.vgrad(quayY - 5, quayY, QUAY, 0.6);
        for (let x = 0; x < R.W; x++) R.px(x, quayY - 5, QUAY[2]);

        // ── a crane over the wharf
        const cx = Math.round(R.W * 0.26), ch = Math.round(R.H * 0.22);
        for (let y = quayY - ch; y < quayY - 5; y++) { R.px(cx, y, CRANE); R.px(cx + 1, y, CRANE); }
        for (let i = 0; i < Math.round(R.W * 0.16); i++) {
          R.px(cx + i, quayY - ch, CRANE);
          if (i % 4 === 0) R.px(cx + i, quayY - ch + 1, CRANE);
        }
        const hook = quayY - ch + 6 + Math.round(Math.sin(t * 0.02) * 3);
        for (let y = quayY - ch; y < hook; y++) R.px(cx + Math.round(R.W * 0.13), y, CRANE);

        // ── quay lamps
        for (const lx of lampsAt) {
          for (let y = quayY - 14; y < quayY - 5; y++) R.px(lx, y, [26, 26, 32]);
          R.blend(lx, quayY - 15, LAMP, 0.95);
          retroCone(R, lx, quayY - 14, 0.05, 0.22, LAMP);
        }

        // ── the lighthouse, and its beam
        for (let y = lhY; y < quayY - 5; y++) {
          const w = 2 + Math.round((y - lhY) / lhH * 2);
          for (let dx = -w; dx <= w; dx++) {
            const band = (Math.floor((y - lhY) / 4) & 1);
            R.px(lhX + dx, y, band ? TOWER_RED : TOWER);
          }
        }
        const lampY = lhY - 2;
        R.rect(lhX - 3, lampY, 7, 3, [40, 42, 50]);
        const phase = Math.sin(sweep);
        // Facing us: the lamp itself is only bright as the beam comes round.
        R.blend(lhX, lampY + 1, BEAM, 0.4 + Math.max(0, phase) * 0.6);
        if (phase > 0.1) {
          const a = (phase - 0.1) / 0.9;
          const dir = Math.cos(sweep) > 0 ? -1 : 1;
          for (let i = 0; i < 220; i++) {
            const k = R.hash(i, t >> 2);
            const len = k * R.W * 0.9;
            const spread = 1 + k * R.H * 0.10;
            const x = lhX + dir * len;
            const y = lampY + 1 + (R.hash(i + 400, 3) - 0.5) * spread * 2;
            R.blend(x, y, BEAM, (1 - k) * a * 0.34);
          }
          // and what the beam lands on
          for (let x = 0; x < R.W; x++) {
            const d = Math.abs(x - (lhX + dir * R.W * 0.45)) / (R.W * 0.3);
            if (d > 1) continue;
            for (let y = quayY - 8; y < quayY; y++) R.blend(x, y, BEAM, (1 - d) * a * 0.12);
          }
        }

        // ── the ferry
        if (!ferry) {
          call = Math.min(1, call + 0.0009);
          if (call >= 1) {
            ferry = { x: -Math.round(R.W * 0.4), w: Math.round(R.W * 0.26) };
            call = 0;
          }
        }
        if (ferry) {
          ferry.x += 0.5;
          const fy = waterY - 3 + Math.round(Math.sin(t * 0.05) * 1.2);
          const fw = ferry.w, fh = Math.round(fw * 0.16);
          for (let dx = 0; dx < fw; dx++) {
            const x = ferry.x + dx;
            if (x < 0 || x >= R.W) continue;
            // A hull is not a box: it rises at both ends.
            const u = dx / fw;
            const rise = Math.round(Math.pow(Math.abs(u - 0.5) * 2, 3) * fh * 0.9);
            for (let y = fy - fh - rise; y < fy; y++) R.px(x, y, y < fy - fh - rise + 1 ? HULL_HI : HULL);
            if (dx % 5 === 2 && dx > 3 && dx < fw - 4) {
              retroLitWindow(R, x, fy - fh - 1, WIN, 0.8);
            }
          }
          // superstructure
          const sx = ferry.x + Math.round(fw * 0.55), sw = Math.round(fw * 0.22);
          for (let dx = 0; dx < sw; dx++) {
            for (let y = fy - fh - 6; y < fy - fh; y++) R.px(sx + dx, y, HULL_HI);
          }
          R.blend(sx + 1, fy - fh - 7, [232, 88, 72], 0.9);
          if (ferry.x > R.W + 10) ferry = null;
        }

        // ── the water. Reflection first, then the surface over it.
        R.vgrad(waterY, R.H, WATER, 0.8);
        const depth = R.H - waterY;
        for (let x = 0; x < R.W; x++) {
          for (let dy = 1; dy < depth; dy++) {
            const srcY = waterY - 1 - Math.round(dy * 1.7);
            if (srcY < 0) break;
            const j = Math.round(Math.sin(dy * 0.6 + t * 0.09 + x * 0.06) * 1.5);
            const c = above(x + j, srcY);
            if (!c) continue;
            const lum = (c[0] + c[1] + c[2]) / 765;
            if (lum < 0.30) continue;
            R.blend(x, waterY + dy, c, Math.max(0, 1 - dy / depth) * 0.72 * lum);
          }
        }
        // Swell: a few bright lines on the surface, moving.
        for (let i = 0; i < 26; i++) {
          const y = waterY + 2 + Math.round(R.hash(i, 3) * (depth - 3));
          const len = 3 + Math.round(R.hash(i, 9) * 6);
          const x = Math.round((R.hash(i, 5) * R.W + t * (0.3 + R.hash(i, 7) * 0.4)) % R.W);
          for (let dx = 0; dx < len; dx++) R.blend(x + dx, y, [176, 212, 234], 0.42);
        }

        R.flush();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
      this._resize = null; this._onKey = null;
    }
  };
  // ────────────────────────────────────────────────────────────────────────
  // Alley — chapter one of the author's own detective game, running behind
  // the notepad.
  //
  // This is a **port, not a rebuild**. Two earlier attempts redrew the scene
  // from a screenshot and both were worse than the thing they copied, in ways
  // that were not about taste: the first ran at 220×150 where the game runs at
  // 480×270, and the second reproduced the layout but invented its own
  // character sprite and its own shadow maths. The answer was to stop
  // designing and start copying. The materials, the layout, the sprites, the
  // occluder list, the light placement, the visibility-polygon shadow caster
  // and the compositing order below are the game's own code, transcribed.
  //
  // What is *not* the game:
  //  · the camera does not pan and the detective does not walk — he stands in
  //    the middle of the frame, because a background that moves is a
  //    background you cannot write in front of;
  //  · the torch aims at the caret. That is the whole reason this is a theme
  //    rather than a wallpaper. Somebody down there is reading your line.
  //
  // The lighting is worth understanding because nothing else in this file
  // works this way. The scene is drawn in flat, unlit colour. A second buffer
  // is filled with a cold ambient (#3a4266) and each light is drawn into it
  // *additively*, clipped to the polygon of what that light can actually see —
  // so a crate throws a real shadow with real edges. That buffer is then
  // composited over the scene with `multiply` and a 1.4px blur, which is what
  // makes everything the lamp misses read as genuinely unlit rather than
  // merely dim. Emissive things — the lamp glass, the lit windows, the torch —
  // are added *after* the multiply, because they are light rather than lit.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.alley = {
    start() {
      const parent = back();
      if (!parent) return;

      const VW = 480, GROUND = 228, TAU = Math.PI * 2;
      const AMBIENT = '#3a4266';
      let VH = 270;

      const canvas = document.createElement('canvas');
      canvas.className = 'fx-alley-canvas';
      parent.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      const mulberry = (seed) => function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
        x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
        return ((x ^ x >>> 14) >>> 0) / 4294967296;
      };
      const sprite = (rows, pal) => {
        const h = rows.length, w = rows[0].length;
        const c = mk(w, h), g = c.getContext('2d');
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const k = rows[j][i];
            if (pal[k]) { g.fillStyle = pal[k]; g.fillRect(i, j, 1, 1); }
          }
        }
        return c;
      };

      const PAL = {
        H: '#1c1824', h: '#0f0d14', F: '#e2b78f', e: '#2a1e1e', f: '#b58c6a',
        C: '#7a6549', c: '#5a4835', W: '#ded6c8', T: '#7a1f2b', B: '#2e2620',
        P: '#2a2a36', S: '#15151c'
      };
      const BODY = sprite([
        '....HHHH....', '...HHHHHH...', '..HHHHHHHH..', '.hhhhhhhhhh.',
        '....FFFF....', '....FFFe....', '....FFFF....', '.....ff.....',
        '...CCCCCC...', '..CCWWTCCC..', '..CCWWTCCC..', '..CCcWTCCC..',
        '.CCCCCCCCCC.', '.CcCCCCCCCC.', '.CcCCCCCCCC.', '.CcCCBBCCCC.',
        '..cCCCCCCC..', '..cCCCCCCC..', '..cCCCCCCC..', '..cCCCCCCC..'], PAL);
      const LEG_STAND = sprite([
        '...PP.PP....', '...PP.PP....', '...PP.PP....',
        '...PP.PP....', '...PP.PP....', '..SSS.SSS...'], PAL);
      const CPAL = { A: '#33333f', a: '#45455a', n: '#c47a8a' };
      const CAT_SLEEP = sprite([
        '................', '................', '........a..a....', '.......aaaaaa...',
        '.aa.AAAAaaaaaa..', 'aAAAAAAAAAaaaa..', 'aAAAAAAAAAAAAa..', '.AAAAAAAAAAAA...'], CPAL);

      // ---- materials ------------------------------------------------------
      const brick = (g, x, y, w, h, base, mortar, rand) => {
        g.fillStyle = base; g.fillRect(x, y, w, h);
        g.fillStyle = mortar;
        for (let yy = y; yy < y + h; yy += 5) {
          g.fillRect(x, yy, w, 1);
          const off = (((yy - y) / 5) | 0) % 2 ? 5 : 0;
          for (let xx = x + off; xx < x + w; xx += 10) g.fillRect(xx, yy, 1, 5);
        }
        for (let i = 0; i < w * h / 70; i++) {
          g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.05)';
          const bx = x + (rand() * w | 0), by = y + (rand() * h | 0);
          g.fillRect(bx - (bx - x) % 10 + 1, by - (by - y) % 5 + 1, 9, 4);
        }
      };
      const concrete = (g, x, y, w, h, base, rand) => {
        g.fillStyle = base; g.fillRect(x, y, w, h);
        for (let i = 0; i < w * h / 25; i++) {
          g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.04)';
          g.fillRect(x + (rand() * w | 0), y + (rand() * h | 0), 1 + (rand() * 3 | 0), 1);
        }
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let yy = y + 18; yy < y + h; yy += 40) g.fillRect(x, yy, w, 2);
      };
      const win = (g, x, y, w, h, pane) => {
        g.fillStyle = '#231f2b'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
        g.fillStyle = pane; g.fillRect(x, y, w, h);
        g.fillStyle = '#231f2b';
        g.fillRect(x + (w / 2 | 0), y, 1, h); g.fillRect(x, y + (h / 2 | 0), w, 1);
        g.fillStyle = '#d8dfef'; g.fillRect(x - 2, y + h + 1, w + 4, 2);
      };
      const ledge = (g, x, y, w) => {
        g.fillStyle = '#2a2530'; g.fillRect(x, y, w, 3);
        g.fillStyle = '#dfe6f3'; g.fillRect(x, y - 2, w, 2);
      };
      const pipeD = (g, x, y1, y2) => {
        g.fillStyle = '#26242e'; g.fillRect(x, y1, 3, y2 - y1);
        g.fillStyle = '#35323d';
        for (let y = y1 + 12; y < y2; y += 30) g.fillRect(x - 1, y, 5, 3);
      };
      const snowPiles = (g, x0, x1, rand) => {
        for (let x = x0; x < x1; x += 6 + (rand() * 8 | 0)) {
          const h = 2 + (rand() * 4 | 0), w = 8 + (rand() * 10 | 0);
          g.fillStyle = '#dfe6f3'; g.fillRect(x, GROUND - h, w, h + 1);
          g.fillStyle = '#eef2fa'; g.fillRect(x + 2, GROUND - h - 1, w - 4, 1);
        }
      };
      const groundD = (g, x0, x1, base, spec, rand) => {
        g.fillStyle = base; g.fillRect(x0, GROUND, x1 - x0, VH - GROUND);
        for (let i = 0; i < (x1 - x0) * 0.7; i++) {
          g.fillStyle = rand() < 0.5 ? spec : 'rgba(255,255,255,0.3)';
          g.fillRect(x0 + (rand() * (x1 - x0) | 0), GROUND + (rand() * (VH - GROUND) | 0), 1, 1);
        }
        g.fillStyle = 'rgba(30,40,80,0.22)';
        for (let i = 0; i < (x1 - x0) / 30; i++) {
          g.fillRect(x0 + (rand() * (x1 - x0) | 0), GROUND + 4 + (rand() * 32 | 0), 8 + (rand() * 30 | 0), 1);
        }
        g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x0, GROUND, x1 - x0, 1);
      };

      // ---- props ----------------------------------------------------------
      const drawCrate = (g, x, y, w, h) => {
        g.fillStyle = '#6a4b2e'; g.fillRect(x, y, w, h);
        g.fillStyle = '#4e3620';
        for (let i = 0; i < w; i += 6) g.fillRect(x + i, y, 1, h);
        g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1);
        g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
        g.fillStyle = '#e4eaf6'; g.fillRect(x - 1, y - 2, w + 2, 2);
      };
      const drawLamp = (g, x) => {
        g.fillStyle = '#23232c'; g.fillRect(x - 1, 108, 3, GROUND - 108);
        g.fillStyle = '#2f2f3a'; g.fillRect(x - 3, GROUND - 6, 7, 6); g.fillRect(x - 2, GROUND - 10, 5, 4);
        g.fillStyle = '#3a3a46'; g.fillRect(x - 6, 100, 13, 3);
        g.fillStyle = '#2a2a34'; g.fillRect(x - 5, 103, 11, 2);
        g.fillStyle = '#ffe9b0'; g.fillRect(x - 4, 105, 9, 7);
        g.fillStyle = '#3a3a46'; g.fillRect(x - 5, 112, 11, 2);
        g.fillStyle = '#e4eaf6'; g.fillRect(x - 6, 98, 13, 2);
      };
      const drawDumpster = (g, x) => {
        const y = GROUND - 30;
        g.fillStyle = '#2f4a3a'; g.fillRect(x, y + 4, 52, 26);
        g.fillStyle = '#264031'; g.fillRect(x, y, 52, 5); g.fillRect(x + 6, y + 12, 40, 1);
        g.fillStyle = '#1f3529'; g.fillRect(x + 2, y + 8, 48, 2); g.fillRect(x + 20, y + 18, 12, 6);
        g.fillStyle = '#e4eaf6'; g.fillRect(x - 1, y - 2, 54, 2);
      };
      const drawBoxes = (g, x) => {
        g.fillStyle = '#4a3a2a'; g.fillRect(x, GROUND - 14, 26, 14);
        g.fillStyle = '#3a2c1e'; g.fillRect(x, GROUND - 14, 26, 1); g.fillRect(x + 12, GROUND - 14, 1, 14);
        g.fillStyle = '#55432f'; g.fillRect(x + 4, GROUND - 28, 18, 14);
        g.fillStyle = '#3a2c1e'; g.fillRect(x + 4, GROUND - 28, 18, 1);
        g.fillStyle = '#e4eaf6'; g.fillRect(x + 3, GROUND - 30, 20, 2);
      };
      const drawTape = (g, x1, x2) => {
        g.fillStyle = '#2a2a34'; g.fillRect(x1, GROUND - 22, 2, 22); g.fillRect(x2, GROUND - 22, 2, 22);
        g.fillStyle = '#3a3a46'; g.fillRect(x1 - 2, GROUND - 2, 6, 2); g.fillRect(x2 - 2, GROUND - 2, 6, 2);
        g.fillStyle = '#d8b23c'; g.fillRect(x1 + 2, GROUND - 20, x2 - x1 - 2, 9);
        g.fillStyle = '#26221a';
        for (let x = x1 + 2; x < x2; x += 8) {
          g.beginPath();
          g.moveTo(x, GROUND - 20); g.lineTo(x + 4, GROUND - 20);
          g.lineTo(x, GROUND - 11); g.lineTo(x - 4, GROUND - 11);
          g.closePath(); g.fill();
        }
        g.fillStyle = '#e4eaf6'; g.fillRect(x1 + 2, GROUND - 22, x2 - x1 - 2, 2);
      };
      const drawCrimeMarks = (g) => {
        g.fillStyle = 'rgba(90,105,150,0.35)';
        g.fillRect(212, GROUND + 6, 60, 14); g.fillRect(222, GROUND + 3, 44, 20);
        g.fillStyle = 'rgba(70,80,120,0.3)'; g.fillRect(230, GROUND + 12, 30, 4);
      };
      const drawPrints = (g) => {
        g.fillStyle = 'rgba(60,75,125,0.45)';
        for (let i = 0; i < 12; i++) {
          const x = 330 + i * 5, y = GROUND + 8 + (i & 1) * 7;
          g.fillRect(x, y, 3, 2); g.fillRect(x + 1, y + 2, 2, 1);
        }
      };
      const drawPillar = (g, x) => {
        g.fillStyle = '#4b4b58'; g.fillRect(x, GROUND - 92, 12, 92);
        g.fillStyle = '#5a5a68'; g.fillRect(x + 2, GROUND - 92, 3, 92);
        g.fillStyle = '#3a3a46'; g.fillRect(x + 9, GROUND - 92, 3, 92); g.fillRect(x - 2, GROUND - 4, 16, 4);
        g.fillStyle = '#e4eaf6'; g.fillRect(x - 1, GROUND - 95, 14, 3);
      };
      const drawBarrel = (g, x) => {
        g.fillStyle = '#5a3a2c'; g.fillRect(x, GROUND - 24, 18, 24);
        g.fillStyle = '#3e2820'; g.fillRect(x, GROUND - 20, 18, 2); g.fillRect(x, GROUND - 8, 18, 2);
        g.fillStyle = '#7a4a34'; g.fillRect(x + 3, GROUND - 24, 2, 24);
        g.fillStyle = '#e4eaf6'; g.fillRect(x - 1, GROUND - 26, 20, 3);
      };
      const drawCat = (g, x, y, t) => {
        g.save(); g.translate(x + 16, y); g.scale(-1, 1);
        g.drawImage(CAT_SLEEP, 0, -8);
        if (Math.sin(t * 0.9) > 0.8) { g.fillStyle = CPAL.a; g.fillRect(-1, -5, 1, 1); }
        g.restore();
      };

      // ---- shadow casting, verbatim from the original ---------------------
      const rectSegs = (o, out) => {
        const x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
        out.push([x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]);
      };
      // The visibility polygon: a ray to either side of every corner, sorted
      // by angle. This is what gives the crates and the lamp post shadows with
      // straight, correct edges — an approximation here is visible at once.
      const castLight = (L, occ) => {
        const R = L.r, segs = [];
        for (const o of occ) {
          if (L.x >= o.x && L.x <= o.x + o.w && L.y >= o.y && L.y <= o.y + o.h) continue;
          if (o.x > L.x + R || o.x + o.w < L.x - R || o.y > L.y + R || o.y + o.h < L.y - R) continue;
          rectSegs(o, segs);
        }
        rectSegs({ x: L.x - R, y: L.y - R, w: R * 2, h: R * 2 }, segs);
        const full = L.cone === undefined, half = full ? 0 : L.coneW / 2;
        const angles = [];
        if (!full) angles.push(L.cone - half, L.cone + half);
        for (const s of segs) {
          for (let k = 0; k < 2; k++) {
            const px = s[k * 2], py = s[k * 2 + 1];
            const a = Math.atan2(py - L.y, px - L.x);
            if (!full) {
              let d = a - L.cone;
              d = Math.atan2(Math.sin(d), Math.cos(d));
              if (Math.abs(d) > half) continue;
            }
            angles.push(a - 0.0004, a, a + 0.0004);
          }
        }
        const pts = [];
        for (const a of angles) {
          const dx = Math.cos(a), dy = Math.sin(a);
          let best = R * 2;
          for (const s of segs) {
            const ex = s[2] - s[0], ey = s[3] - s[1];
            const den = dx * ey - dy * ex;
            if (den > -1e-9 && den < 1e-9) continue;
            const ox = s[0] - L.x, oy = s[1] - L.y;
            const t2 = (ox * ey - oy * ex) / den;
            if (t2 < 0 || t2 >= best) continue;
            const u = (ox * dy - oy * dx) / den;
            if (u < 0 || u > 1) continue;
            best = t2;
          }
          let key = a;
          if (!full) { const d = a - L.cone; key = Math.atan2(Math.sin(d), Math.cos(d)); }
          pts.push({ k: key, x: L.x + dx * best, y: L.y + dy * best });
        }
        pts.sort((p, q) => p.k - q.k);
        return pts;
      };
      const drawLight = (L, occ, g) => {
        const n = L.samples || 1, sp = L.spread || 0;
        const I = (L.i || 0) * (L.f !== undefined ? L.f : 1) / n;
        if (I <= 0.003) return;
        const full = L.cone === undefined;
        for (let k = 0; k < n; k++) {
          const jx = n > 1 ? Math.cos(k / n * TAU) * sp : 0;
          const jy = n > 1 ? Math.sin(k / n * TAU) * sp : 0;
          const P = { x: L.x + jx, y: L.y + jy, r: L.r, cone: L.cone, coneW: L.coneW };
          const pts = castLight(P, occ);
          if (pts.length < 2) continue;
          g.save();
          g.beginPath();
          if (!full) g.moveTo(P.x, P.y);
          for (let i = 0; i < pts.length; i++) {
            if (i === 0 && full) g.moveTo(pts[i].x, pts[i].y); else g.lineTo(pts[i].x, pts[i].y);
          }
          g.closePath(); g.clip();
          const gr = g.createRadialGradient(P.x, P.y, 0, P.x, P.y, P.r);
          const c = L.c;
          gr.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.min(1, I) + ')');
          gr.addColorStop(0.35, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.min(1, I * 0.55) + ')');
          gr.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
          g.fillStyle = gr;
          g.fillRect(P.x - P.r, P.y - P.r, P.r * 2, P.r * 2);
          g.restore();
        }
      };
      const halo = (g, x, y, r, rgb, a) => {
        if (a <= 0) return;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
        gr.addColorStop(1, 'rgba(' + rgb + ',0)');
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      };

      // ---- the scene, built once ------------------------------------------
      let sky = null, far = null, bg = null, vig = null, lc = null, lctx = null;
      let snow = [];
      let aim = -1, tgtAim = -1;
      let t = 0, nextFrame = 0;

      const PLAYER_X = 240;          // the middle of the frame, not the game's start
      const OCC = [
        { x: 18, y: GROUND - 30, w: 26, h: 30 }, { x: 110, y: GROUND - 32, w: 52, h: 32 },
        { x: 206, y: GROUND - 22, w: 2, h: 22 }, { x: 286, y: GROUND - 22, w: 2, h: 22 },
        { x: 359, y: 108, w: 3, h: GROUND - 108 }, { x: 470, y: GROUND - 26, w: 34, h: 26 },
        { x: 504, y: GROUND - 16, w: 20, h: 16 }, { x: 600, y: GROUND - 92, w: 12, h: 92 },
        { x: 680, y: GROUND - 24, w: 18, h: 24 }
      ];
      const LIGHTS = [
        { x: 360, y: 103, r: 185, c: [255, 190, 110], i: 1, samples: 3, spread: 2.2, f: 1 },
        { x: 100, y: 139, r: 95, c: [255, 170, 90], i: 0.5, samples: 1 },
        { x: 568, y: 132, r: 85, c: [110, 160, 255], i: 0.4, samples: 1, tv: true, f: 1 }
      ];
      const EM_WINS = [
        { x: 92, y: 128, w: 16, h: 22, c: '255,170,90', a: 0.5 },
        { x: 560, y: 122, w: 16, h: 20, c: '110,160,255', a: 0.45, tv: true },
        { x: 440, y: 72, w: 16, h: 20, c: '255,200,140', a: 0.15 },
        { x: 250, y: 100, w: 16, h: 22, c: '255,200,140', a: 0.15 }
      ];

      const buildSky = () => {
        const c = mk(VW, VH), g = c.getContext('2d');
        const gr = g.createLinearGradient(0, 0, 0, GROUND);
        gr.addColorStop(0, '#171d3a'); gr.addColorStop(0.55, '#2b3768'); gr.addColorStop(1, '#4d5b90');
        g.fillStyle = gr; g.fillRect(0, 0, VW, VH);
        const r = mulberry(3), stars = [];
        for (let i = 0; i < 50; i++) stars.push({ x: r() * VW | 0, y: r() * 150 | 0, p: r() * TAU });
        return { c, stars };
      };
      const buildFar = () => {
        const w = 1000, c = mk(w, VH), g = c.getContext('2d'), r = mulberry(7), wins = [];
        let x = 0;
        while (x < w) {
          const bw = 14 + (r() * 30 | 0), bh = 50 + (r() * 115 | 0), top = GROUND - bh;
          g.fillStyle = r() < 0.5 ? '#212848' : '#1c2240';
          g.fillRect(x, top, bw, bh);
          if (r() < 0.3) g.fillRect(x + (bw / 2 | 0) - 1, top - 9, 2, 9);
          for (let wy = top + 4; wy < GROUND - 30; wy += 6) {
            for (let wx = x + 3; wx < x + bw - 3; wx += 5) {
              if (r() < 0.22) wins.push({ x: wx, y: wy, c: r() < 0.8 ? '255,210,140' : '160,200,255', p: r() * TAU });
            }
          }
          x += bw + (r() * 6 | 0);
        }
        return { c, wins };
      };
      const buildVignette = () => {
        const c = mk(VW, VH), g = c.getContext('2d');
        const gr = g.createRadialGradient(VW / 2, VH / 2, VH * 0.45, VW / 2, VH / 2, VH * 0.95);
        gr.addColorStop(0, 'rgba(0,0,10,0)'); gr.addColorStop(1, 'rgba(0,0,10,0.6)');
        g.fillStyle = gr; g.fillRect(0, 0, VW, VH);
        return c;
      };
      const buildAlleyBG = () => {
        const c = mk(800, VH), g = c.getContext('2d'), r = mulberry(11);
        brick(g, 0, 10, 330, GROUND - 10, '#4a3a3c', '#3b2e30', r); ledge(g, 0, 10, 330);
        concrete(g, 330, 55, 290, GROUND - 55, '#454858', r); ledge(g, 330, 55, 290);
        brick(g, 620, 30, 180, GROUND - 30, '#3f3944', '#322d37', r); ledge(g, 620, 30, 180);
        win(g, 60, 40, 16, 22, '#151a2c'); win(g, 60, 90, 16, 22, '#151a2c');
        win(g, 92, 128, 16, 22, '#d8a65a');
        win(g, 150, 40, 16, 22, '#151a2c'); win(g, 150, 90, 16, 22, '#1a2036');
        win(g, 150, 140, 16, 22, '#151a2c');
        win(g, 250, 50, 16, 22, '#151a2c'); win(g, 250, 100, 16, 22, '#5f5140');
        g.fillStyle = 'rgba(60,30,20,0.55)'; g.fillRect(92, 128, 3, 22); g.fillRect(105, 128, 3, 22);
        g.fillStyle = '#2b2933'; g.fillRect(190, GROUND - 42, 26, 42);
        g.fillStyle = '#1c1b22'; g.fillRect(192, GROUND - 40, 22, 38);
        g.fillStyle = '#4a4853'; g.fillRect(208, GROUND - 22, 3, 2);
        [350, 395, 440, 485, 530].forEach((x, i) => {
          win(g, x, 72, 16, 20, i === 2 ? '#4b4335' : '#151a2c');
          win(g, x, 122, 16, 20, '#151a2c');
        });
        win(g, 575, 72, 16, 20, '#151a2c'); win(g, 560, 122, 16, 20, '#5a7ab0');
        g.fillStyle = '#33363f'; g.fillRect(400, 100, 18, 10);
        g.fillStyle = '#22252c'; g.fillRect(402, 102, 14, 6);
        win(g, 700, 60, 16, 22, '#151a2c'); win(g, 700, 110, 16, 22, '#151a2c');
        g.fillStyle = '#1f1d26';
        for (let y = 70; y < 200; y += 45) {
          g.fillRect(636, y, 52, 2); g.fillRect(636, y - 10, 1, 10); g.fillRect(687, y - 10, 1, 10);
          for (let x = 640; x < 686; x += 6) g.fillRect(x, y - 8, 1, 8);
          g.fillRect(636, y - 8, 52, 1);
        }
        g.fillRect(660, 60, 2, 140);
        for (let y = 64; y < 200; y += 6) g.fillRect(655, y, 12, 1);
        g.fillStyle = '#0b0b14'; g.fillRect(738, 140, 40, GROUND - 140);
        g.fillStyle = '#161520'; g.fillRect(738, 136, 40, 4);
        pipeD(g, 324, 10, GROUND); pipeD(g, 617, 55, GROUND); pipeD(g, 795, 30, GROUND);
        g.fillStyle = 'rgba(180,60,120,0.35)';
        g.fillRect(430, 170, 3, 14); g.fillRect(436, 176, 10, 3); g.fillRect(450, 168, 3, 18);
        g.fillStyle = 'rgba(80,180,200,0.3)'; g.fillRect(460, 175, 14, 3);
        groundD(g, 0, 800, '#b9c4da', '#dfe6f3', r);
        snowPiles(g, 0, 800, r);
        return c;
      };

      const resize = () => {
        const w = Math.max(320, window.innerWidth), h = Math.max(200, window.innerHeight);
        VH = Math.max(260, Math.round(VW * h / w));
        canvas.width = VW; canvas.height = VH;
        sky = buildSky(); far = buildFar(); bg = buildAlleyBG(); vig = buildVignette();
        lc = mk(VW, VH); lctx = lc.getContext('2d');
        snow = [];
        for (let i = 0; i < 260; i++) {
          snow.push({ x: Math.random() * VW, y: Math.random() * VH, z: Math.random(), ph: Math.random() * TAU });
        }
      };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      // ---- the frame ------------------------------------------------------
      const tick = (now) => {
        if (now < nextFrame) { rafId = requestAnimationFrame(tick); return; }
        nextFrame = now + 1000 / 30;
        t += 1 / 30;

        // The torch aims at the caret, on a spring so it sweeps.
        const p = caretRect();
        const px = PLAYER_X, py = GROUND - 26 + 9;
        if (p) {
          const cx2 = (p.x / window.innerWidth) * VW;
          const cy2 = ((p.top + p.bottom) / 2 / window.innerHeight) * VH;
          tgtAim = Math.atan2(cy2 - py, cx2 - px);
        }
        let d = tgtAim - aim;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        aim += d * 0.10;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(sky.c, 0, 0);
        ctx.drawImage(far.c, 0, 0);
        ctx.drawImage(bg, 0, 0);

        drawPrints(ctx); drawCrimeMarks(ctx); drawTape(ctx, 206, 286);
        drawDumpster(ctx, 110); drawBoxes(ctx, 18); drawLamp(ctx, 360);
        drawCrate(ctx, 470, GROUND - 26, 34, 26); drawCrate(ctx, 504, GROUND - 16, 20, 16);
        drawCat(ctx, 472, GROUND - 26, t); drawPillar(ctx, 600); drawBarrel(ctx, 680);

        // The detective, and the torch in his hand.
        const bodyY = -26;
        ctx.fillStyle = 'rgba(10,12,30,0.25)'; ctx.fillRect(px - 6, GROUND - 1, 12, 2);
        ctx.save(); ctx.translate(px, GROUND);
        ctx.drawImage(LEG_STAND, -6, -6); ctx.drawImage(BODY, -6, bodyY);
        ctx.restore();
        const sx = px + 1, sy = GROUND + bodyY + 9;
        const hx = sx + Math.cos(aim) * 7, hy = sy + Math.sin(aim) * 7;
        ctx.strokeStyle = PAL.C; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = PAL.F; ctx.fillRect(Math.round(hx) - 1, Math.round(hy) - 1, 2, 2);
        ctx.save(); ctx.translate(hx, hy); ctx.rotate(aim);
        ctx.fillStyle = '#8e8e98'; ctx.fillRect(-1, -1.5, 6, 3);
        ctx.fillStyle = '#d8d8e0'; ctx.fillRect(4, -2, 2, 4);
        ctx.restore();
        const lightX = hx + Math.cos(aim) * 6, lightY = hy + Math.sin(aim) * 6;

        // Snow, before the light so the light falls on it.
        for (const s of snow) {
          s.x += (Math.sin(t * 0.7 + s.ph) * 6 - 9) * (1 / 30) * (0.4 + s.z);
          s.y += (14 + 26 * s.z) * (1 / 30);
          if (s.y > VH) { s.y = -2; s.x = Math.random() * VW; }
          if (s.x < -2) s.x = VW; else if (s.x > VW) s.x = -2;
        }
        ctx.fillStyle = 'rgba(235,240,255,0.55)';
        for (const s of snow) if (s.z <= 0.6) ctx.fillRect(s.x | 0, s.y | 0, 1, 1);
        ctx.fillStyle = 'rgba(240,244,255,0.9)';
        for (const s of snow) if (s.z > 0.6) ctx.fillRect(s.x | 0, s.y | 0, 2, 2);

        // ---- the light map
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalCompositeOperation = 'source-over';
        lctx.fillStyle = AMBIENT; lctx.fillRect(0, 0, VW, VH);
        lctx.globalCompositeOperation = 'lighter';
        const pocc = OCC.concat([{ x: px - 4, y: GROUND - 26, w: 8, h: 26 }]);
        LIGHTS[0].f = 0.92 + Math.sin(t * 5.1) * 0.05 + Math.sin(t * 17) * 0.03;
        LIGHTS[2].f = Math.sin(t * 9) > 0.3 ? 1 : 0.55;
        for (const L of LIGHTS) drawLight(L, pocc, lctx);
        drawLight({ x: lightX, y: lightY, r: 215, c: [255, 235, 200], i: 0.38, cone: aim, coneW: 0.95, samples: 2, spread: 1.6 }, OCC, lctx);
        drawLight({ x: lightX, y: lightY, r: 230, c: [255, 240, 210], i: 0.75, cone: aim, coneW: 0.42, samples: 2, spread: 1.2 }, OCC, lctx);
        drawLight({ x: lightX, y: lightY, r: 34, c: [255, 235, 200], i: 0.35, samples: 1 }, OCC, lctx);
        lctx.globalCompositeOperation = 'source-over';

        ctx.globalCompositeOperation = 'multiply';
        try { ctx.filter = 'blur(1.4px)'; } catch (e) { /* older engines */ }
        ctx.drawImage(lc, 0, 0);
        try { ctx.filter = 'none'; } catch (e) {}

        // ---- emissive
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(220,230,255,0.5)';
        for (const st of sky.stars) {
          ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + st.p));
          ctx.fillRect(st.x, st.y, 1, 1);
        }
        ctx.globalAlpha = 1;
        halo(ctx, 392, 42, 34, '200,210,255', 0.18);
        ctx.fillStyle = 'rgba(225,230,245,0.95)';
        ctx.beginPath(); ctx.arc(392, 42, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(120,130,170,0.4)';
        ctx.fillRect(389, 39, 2, 2); ctx.fillRect(393, 43, 3, 2);
        for (const w of far.wins) {
          const fl = Math.sin(t * 0.5 + w.p) > -0.85 ? 1 : 0.2;
          ctx.fillStyle = 'rgba(' + w.c + ',' + (0.4 * fl) + ')';
          ctx.fillRect(w.x, w.y, 1, 1);
        }
        for (const w of EM_WINS) {
          const fl = w.tv ? (0.6 + 0.4 * (Math.sin(t * 9) > 0.3 ? 1 : 0.5)) : 1;
          ctx.fillStyle = 'rgba(' + w.c + ',' + (w.a * fl) + ')';
          ctx.fillRect(w.x, w.y, w.w, w.h);
          halo(ctx, w.x + w.w / 2, w.y + w.h / 2, w.w * 1.6, w.c, w.a * 0.35 * fl);
        }
        const lf = LIGHTS[0].f;
        halo(ctx, 360, 103, 70, '255,190,110', 0.09 * lf);
        halo(ctx, 360, 103, 26, '255,200,130', 0.4 * lf);
        halo(ctx, 360, 103, 7, '255,240,200', 0.95 * lf);
        const gp = ctx.createLinearGradient(0, GROUND, 0, GROUND + 34);
        gp.addColorStop(0, 'rgba(255,190,110,' + (0.16 * lf) + ')');
        gp.addColorStop(1, 'rgba(255,190,110,0)');
        ctx.fillStyle = gp; ctx.fillRect(352, GROUND + 1, 16, 34);
        ctx.fillStyle = 'rgba(255,220,80,0.6)'; ctx.fillRect(252, GROUND + 16, 5, 1);
        halo(ctx, lightX, lightY, 6, '255,245,220', 0.9);
        halo(ctx, lightX, lightY, 16, '255,240,210', 0.25);

        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(vig, 0, 0);

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      stopRaf();
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  function apply(name) {
    if (current === name) return;
    generation++;
    if (current && RUNTIMES[current] && RUNTIMES[current].stop) {
      try { RUNTIMES[current].stop(); } catch (e) { console.error('fx stop failed', e); }
    }
    stopRaf();
    clearLayers();
    current = null;
    if (!name || !RUNTIMES[name]) return;
    current = name;
    // One frame late, on purpose. start() allocates the runtime's buffers —
    // Fountain's two float fields and Sandbox's grid are both sized to the
    // window — and doing that in the same frame as the palette swap costs a
    // visible hitch on every theme change. Deferring lets the new colours
    // paint first and the effect arrive on the next frame.
    const mine = generation;
    requestAnimationFrame(() => {
      if (mine !== generation) return;   // switched again before we got here
      try {
        RUNTIMES[name].start();
      } catch (e) {
        console.error('fx start failed', name, e);
        if (current === name) current = null;
      }
    });
  }

  window.PP_FX = { apply, active: () => current, setVolume, shove };
})();

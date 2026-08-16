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
      const resize = () => {
        w = window.innerWidth;
        h = window.innerHeight;
        cloudCanvas.width = w; cloudCanvas.height = h;
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
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        cctx.fillStyle = '#020306';
        cctx.fillRect(0, 0, w, h);
        for (const c of BLOBS) {
          c.x += c.vx; c.y += c.vy;
          if (c.x < -0.2) c.x = 1.2; else if (c.x > 1.2) c.x = -0.2;
          if (c.y < -0.1) c.y = 0.7; else if (c.y > 0.7) c.y = -0.1;
          const cx = c.x * w, cy = c.y * h, r = c.r * Math.max(w, h);
          const g = cctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(55,64,82,' + c.a + ')');
          g.addColorStop(1, 'rgba(55,64,82,0)');
          cctx.fillStyle = g;
          cctx.fillRect(0, 0, w, h);
        }

        if (now >= nextAmbientAt) { strike(); scheduleAmbient(now); }

        bctx.clearRect(0, 0, w, h);
        bctx.save();
        bctx.globalCompositeOperation = 'lighter';
        for (const s of strikes) {
          if (s.flash > 0.001) {
            bctx.fillStyle = 'rgba(220,225,235,' + (s.flash * 0.14) + ')';
            bctx.fillRect(0, 0, w, h);
          }
        }
        bctx.lineCap = 'round';
        bctx.lineJoin = 'round';
        for (const s of strikes) {
          if (s.alpha <= 0.001) continue;
          bctx.shadowColor = 'rgba(225,230,245,0.85)';
          bctx.shadowBlur = 16;
          for (const seg of s.bolt) {
            bctx.strokeStyle = 'rgba(225,230,245,' + s.alpha + ')';
            bctx.lineWidth = seg.w;
            bctx.beginPath();
            bctx.moveTo(seg.x1, seg.y1);
            bctx.lineTo(seg.x2, seg.y2);
            bctx.stroke();
          }
          bctx.shadowBlur = 0;
        }
        bctx.restore();

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
      const root = document.documentElement.style;
      root.removeProperty('--fx-key-level');
      root.removeProperty('--accent');
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
    try {
      RUNTIMES[name].start();
    } catch (e) {
      console.error('fx start failed', name, e);
      current = null;
    }
  }

  window.PP_FX = { apply, active: () => current };
})();

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
        document.querySelectorAll('.editor-area .ln, .md-preview [data-line]').forEach((el) => {
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
      this._resize = null;
      this._onInput = null;
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

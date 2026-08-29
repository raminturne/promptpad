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
  // Orrery — a watch movement behind the glass. A train of brass gears,
  // meshed and geared correctly against each other, driven by how fast you
  // are typing: the escapement idles when you stop and races when you write.
  // Heartbeat measures the same thing and draws it as a trace; this one
  // draws it as machinery, which is a different feeling entirely.
  // ────────────────────────────────────────────────────────────────────────
  RUNTIMES.orrery = {
    start() {
      const b = back();
      if (!b) return;
      const c = makeCanvas(b, 'fx-orrery-canvas');
      const ctx = c.ctx;

      // Radii as fractions of the short side, and the turns between one
      // centre and the next. Centre distance is always r1 + r2, so the pitch
      // circles touch — which is the whole reason it reads as meshed.
      // Tuned against a real window rather than by eye on paper: the first
      // pass used larger wheels and gentler turns, and the train ran off the
      // top-right corner with the bottom half of the glass empty.
      const PLAN = [0.20, 0.13, 0.17, 0.10, 0.15, 0.09];
      const TURNS = [0.70, -0.20, 1.10, 2.30, 3.00];
      let gears = [];

      const build = () => {
        const S = Math.min(c.w, c.h);
        gears = [];
        let x = c.w * 0.10;
        let y = c.h * 0.16;
        for (let i = 0; i < PLAN.length; i++) {
          const r = PLAN[i] * S;
          // Teeth in proportion to the radius, so the tooth pitch is the same
          // on every wheel — gears of one module. Anything else looks wrong
          // even to someone who has never opened a watch.
          const teeth = Math.max(9, Math.round(r / S * 74));
          if (i === 0) { gears.push({ x, y, r, teeth, phi: 0 }); continue; }
          const prev = gears[i - 1];
          const phi = TURNS[i - 1];
          x = prev.x + Math.cos(phi) * (prev.r + r);
          y = prev.y + Math.sin(phi) * (prev.r + r);
          gears.push({ x, y, r, teeth, phi });
        }
      };
      const resize = () => { c.resize(); build(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let taps = [];
      const onKey = (e) => {
        if (!e.key || (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace')) return;
        taps.push(performance.now());
      };
      document.addEventListener('keydown', onKey, true);
      this._onKey = onKey;

      const gearPath = (g, ang) => {
        const N = g.teeth;
        const step = (Math.PI * 2) / N;
        const ra = g.r * 1.08;      // tip
        const rd = g.r * 0.90;      // root
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const a0 = ang + i * step;
          const p = [
            [a0, rd], [a0 + step * 0.17, ra],
            [a0 + step * 0.43, ra], [a0 + step * 0.60, rd]
          ];
          for (let k = 0; k < 4; k++) {
            const px = g.x + Math.cos(p[k][0]) * p[k][1];
            const py = g.y + Math.sin(p[k][0]) * p[k][1];
            if (i === 0 && k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
        }
        ctx.closePath();
      };

      let theta0 = 0;
      let speed = 0.25;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        while (taps.length && now - taps[0] > 3000) taps.shift();
        const target = 0.25 + Math.min(1, taps.length / 14) * 2.6;
        // Brass has inertia. It winds up over about a second and coasts back
        // down over several, because a gear train that snapped to a new speed
        // would read as a video being scrubbed.
        speed += (target - speed) * (target > speed ? dt * 2.0 : dt * 0.5);
        theta0 += speed * dt;

        ctx.clearRect(0, 0, c.w, c.h);
        let theta = theta0;
        for (let i = 0; i < gears.length; i++) {
          const g = gears[i];
          if (i > 0) {
            const prev = gears[i - 1];
            const ratio = prev.teeth / g.teeth;
            // The standard external-mesh relation. Without the phi terms the
            // wheels turn at the right rates but their teeth collide.
            theta = -ratio * theta + (1 + ratio) * g.phi + Math.PI / g.teeth;
          }

          // Brass, lit from the upper left like everything else in the app.
          const bg = ctx.createRadialGradient(
            g.x - g.r * 0.4, g.y - g.r * 0.45, g.r * 0.1, g.x, g.y, g.r * 1.15);
          bg.addColorStop(0, 'rgba(214,170,84,0.62)');
          bg.addColorStop(0.55, 'rgba(150,112,44,0.5)');
          bg.addColorStop(1, 'rgba(72,52,20,0.44)');
          gearPath(g, theta);
          ctx.fillStyle = bg;
          ctx.fill();
          ctx.strokeStyle = 'rgba(246,214,140,0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Spokes and hub, cut out rather than drawn on: a solid disc reads
          // as a coin, and it is the holes that say "wheel".
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          const spokes = g.r > c.h * 0.1 ? 5 : 4;
          for (let k = 0; k < spokes; k++) {
            const a = theta + (k / spokes) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(g.x + Math.cos(a) * g.r * 0.56, g.y + Math.sin(a) * g.r * 0.56,
              g.r * 0.19, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          ctx.fillStyle = 'rgba(28,20,8,0.55)';
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.r * 0.13, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(246,214,140,0.45)';
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

  // Cognac — bound leather. Pebbled grain, and gold foil tooling along the
  // edges the way a good binding is blocked. The grain is static; what moves
  // is a warm sheen, because leather is the least reflective thing here and
  // over-lighting it turns it into vinyl immediately.
  RUNTIMES.cognac = {
    start() {
      const b = back();
      if (!b) return;
      const hide = makeCanvas(b, 'fx-cognac-hide', 0.5);
      const lit = makeCanvas(b, 'fx-cognac-sheen', 0.35);
      const hctx = hide.ctx;
      const lctx = lit.ctx;

      const drawHide = () => {
        const w = hide.w;
        const h = hide.h;
        const g = hctx.createLinearGradient(0, 0, w * 0.4, h);
        g.addColorStop(0, '#4a2a15');
        g.addColorStop(0.5, '#38200f');
        g.addColorStop(1, '#2a180b');
        hctx.fillStyle = g;
        hctx.fillRect(0, 0, w, h);
        // Pebbling: overlapping soft cells, each lit on one side and shaded
        // on the other. Drawn as pairs of offset arcs, which is cheap and
        // reads correctly as grain at any distance you would look at it.
        for (let i = 0; i < 1500; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          const r = 2.5 + Math.random() * 6;
          hctx.strokeStyle = 'rgba(255,206,150,0.055)';
          hctx.lineWidth = 1;
          hctx.beginPath();
          hctx.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.95);
          hctx.stroke();
          hctx.strokeStyle = 'rgba(0,0,0,0.10)';
          hctx.beginPath();
          hctx.arc(x, y, r, Math.PI * 0.05, Math.PI * 0.95);
          hctx.stroke();
        }
      };
      const resize = () => { hide.resize(); lit.resize(); drawHide(); };
      resize();
      window.addEventListener('resize', resize);
      this._resize = resize;

      let t = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        t += dt;
        const w = lit.w;
        const h = lit.h;
        lctx.clearRect(0, 0, w, h);
        lctx.globalCompositeOperation = 'lighter';
        // One slow warm pool, and that is all. Leather's whole character is
        // that it absorbs light rather than throwing it back.
        const x = w * (0.35 + Math.sin(t * 0.10) * 0.28);
        const y = h * (0.3 + Math.cos(t * 0.07) * 0.18);
        const r = Math.max(w, h) * 0.62;
        const g = lctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(214,150,72,0.15)');
        g.addColorStop(0.5, 'rgba(180,116,52,0.06)');
        g.addColorStop(1, 'rgba(150,96,40,0)');
        lctx.fillStyle = g;
        lctx.fillRect(0, 0, w, h);
        lctx.globalCompositeOperation = 'source-over';
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
    try {
      RUNTIMES[name].start();
    } catch (e) {
      console.error('fx start failed', name, e);
      current = null;
    }
  }

  window.PP_FX = { apply, active: () => current };
})();

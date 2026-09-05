// Card sketches for the theme browser.
//
// The miniature in a theme card is the app drawn from the theme's own seven
// variables — right colours, right proportions, and completely still. For a
// plain palette that is the whole theme and the card is honest. For the other
// fifty it is a lie by omission: Koi is a pond with fish in it and its card
// was a rectangle of pond-coloured nothing.
//
// So every theme that does something gets a signature drawn here: a few
// seconds of the actual idea, at card size. Koi gets fish. Last Train gets a
// train. Telex gets punched tape. They are not the runtimes — a runtime is a
// hundred times this much code and there are seventy cards on screen — they
// are the smallest drawing that makes the theme recognisable, which is a
// different job and a much smaller one.
//
// Each sketch is (g, w, h, time, t) where `time` is seconds and `t` is the
// theme, so a sketch can take its colours from the palette it belongs to and
// nothing has to be hard-coded twice.
(function () {
  'use strict';

  // ---- small shared helpers -------------------------------------------------

  // Deterministic per index, so a card's stars, leaves and windows are in the
  // same places every time it is drawn rather than shimmering at 12fps.
  function h1(i) {
    let x = Math.imul(i ^ 0x9e3779b9, 2654435761);
    x = Math.imul(x ^ (x >>> 15), 668265263);
    return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
  }
  const rgba = (c, a) => {
    const s = String(c || '#888').trim();
    if (s.startsWith('rgba')) return s.replace(/[\d.]+\)$/, a + ')');
    if (s.startsWith('rgb(')) return s.replace('rgb(', 'rgba(').replace(')', ',' + a + ')');
    const hex = s.replace('#', '');
    const n = hex.length === 3
      ? hex.split('').map((ch) => parseInt(ch + ch, 16))
      : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (n.some(isNaN)) return 'rgba(140,140,140,' + a + ')';
    return 'rgba(' + n[0] + ',' + n[1] + ',' + n[2] + ',' + a + ')';
  };
  const dot = (g, x, y, r, c) => {
    g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  const line = (g, x1, y1, x2, y2, c, w) => {
    g.strokeStyle = c; g.lineWidth = w || 1;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };

  // ---- the sketches ---------------------------------------------------------
  //
  // Keyed by the theme's `fx` name where it has one, and by its own key where
  // it does not. Anything without an entry falls through to a family default
  // chosen by category, which is still better than a blank card.

  const S = {};

  // ── weather ───────────────────────────────────────────────────────────────
  S.rain = (g, w, h, tm, t) => {
    for (let i = 0; i < 26; i++) {
      const x = (h1(i) * w + tm * 14 * (0.6 + h1(i + 9))) % (w + 20) - 10;
      const y = (h1(i + 5) * h + tm * 90 * (0.6 + h1(i))) % (h + 20) - 10;
      line(g, x, y, x - 2, y - 7, rgba(t.text, 0.30), 1);
    }
  };
  S.storm = (g, w, h, tm, t) => {
    S.rain(g, w, h, tm, t);
    // A strike every few seconds, and the flash is on the cloud as well as
    // the bolt — a bolt on its own reads as a scratch.
    const p = tm % 3.4;
    if (p < 0.16) {
      g.fillStyle = rgba('#ffffff', 0.10 * (1 - p / 0.16));
      g.fillRect(0, 0, w, h);
      const bx = w * 0.62;
      g.strokeStyle = rgba('#ffffff', 0.8);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(bx, 2);
      g.lineTo(bx - 4, h * 0.34);
      g.lineTo(bx + 2, h * 0.34);
      g.lineTo(bx - 5, h * 0.66);
      g.stroke();
    }
    g.fillStyle = rgba(t.elevated, 0.9);
    g.beginPath();
    g.ellipse(w * 0.5, 4, w * 0.5, 7, 0, 0, Math.PI * 2);
    g.fill();
  };
  S.downpour = (g, w, h, tm, t) => {
    // Drops on the glass, each sliding down its own track and leaving a trail.
    for (let i = 0; i < 14; i++) {
      const x = 4 + h1(i) * (w - 8);
      const speed = 8 + h1(i + 3) * 22;
      const y = ((tm * speed + h1(i + 7) * h) % (h + 14)) - 7;
      const r = 1.2 + h1(i + 11) * 1.8;
      g.strokeStyle = rgba(t.text, 0.10);
      g.lineWidth = r * 0.8;
      g.beginPath(); g.moveTo(x, y - 10 - r * 4); g.lineTo(x, y); g.stroke();
      dot(g, x, y, r, rgba(t.text, 0.38));
      dot(g, x - r * 0.3, y - r * 0.3, r * 0.35, rgba('#ffffff', 0.5));
    }
  };
  S.frost = (g, w, h, tm, t) => {
    // Crystals growing from the corners, six-fold, as they actually do.
    const grow = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tm * 0.7));
    [[0, 0], [w, 0], [0, h], [w, h]].forEach((o, k) => {
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2 + k;
        const len = (10 + h1(k * 6 + a) * 16) * grow;
        const ex = o[0] + Math.cos(ang) * len, ey = o[1] + Math.sin(ang) * len;
        line(g, o[0], o[1], ex, ey, rgba(t.accent, 0.5), 1);
        for (let b = 1; b <= 2; b++) {
          const px = o[0] + (ex - o[0]) * (b / 3), py = o[1] + (ey - o[1]) * (b / 3);
          line(g, px, py, px + Math.cos(ang + 1) * 4, py + Math.sin(ang + 1) * 4, rgba(t.accent, 0.35), 0.8);
          line(g, px, py, px + Math.cos(ang - 1) * 4, py + Math.sin(ang - 1) * 4, rgba(t.accent, 0.35), 0.8);
        }
      }
    });
  };
  S.aurora = (g, w, h, tm, t) => {
    for (let b = 0; b < 3; b++) {
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h * (0.18 + b * 0.1) + Math.sin(x * 0.05 + tm * 0.6 + b) * 6;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = rgba(b === 1 ? t.accent : t.text, 0.30 - b * 0.06);
      g.lineWidth = 5 - b;
      g.stroke();
    }
  };
  S.starfall = (g, w, h, tm, t) => {
    for (let i = 0; i < 30; i++) {
      const a = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(tm * (0.5 + h1(i)) + i));
      dot(g, h1(i) * w, h1(i + 40) * h * 0.8, 0.7 + h1(i + 80), rgba('#e6ecff', a));
    }
    const p = (tm * 0.42) % 1;
    const cx = w * (0.15 + p * 0.75), cy = h * (0.05 + p * 0.5);
    const grad = g.createLinearGradient(cx, cy, cx - 16, cy - 11);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    line(g, cx, cy, cx - 16, cy - 11, grad, 1.4);
  };
  S.moon = (g, w, h, tm, t) => {
    const cx = w * 0.7, cy = h * 0.3, r = Math.min(w, h) * 0.19;
    dot(g, cx, cy, r * 1.9, rgba(t.accent, 0.07));
    dot(g, cx, cy, r, rgba('#eef1f7', 0.92));
    // Craters, and the terminator — a flat disc reads as a coin.
    for (let i = 0; i < 5; i++) {
      dot(g, cx + (h1(i) - 0.5) * r * 1.3, cy + (h1(i + 3) - 0.5) * r * 1.3,
        r * (0.10 + h1(i + 9) * 0.16), rgba('#9aa3b4', 0.5));
    }
    g.globalCompositeOperation = 'destination-out';
    dot(g, cx - r * (0.5 + 0.35 * Math.sin(tm * 0.3)), cy, r * 0.98, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'source-over';
  };
  S.sunset = (g, w, h, tm, t) => {
    const sy = h * 0.42;
    const grad = g.createLinearGradient(0, 0, 0, sy);
    grad.addColorStop(0, rgba(t.accent, 0.28));
    grad.addColorStop(1, rgba('#ff9a52', 0.55));
    g.fillStyle = grad; g.fillRect(0, 0, w, sy);
    dot(g, w * 0.5, sy - 4, Math.min(w, h) * 0.13, rgba('#ffd08a', 0.95));
    g.fillStyle = rgba('#123', 0.55); g.fillRect(0, sy, w, h - sy);
    for (let i = 0; i < 7; i++) {
      const y = sy + 3 + i * ((h - sy) / 8);
      const ww = 6 + Math.abs(Math.sin(tm * 0.9 + i)) * 14 + i * 2;
      g.fillStyle = rgba('#ffd08a', 0.30 - i * 0.03);
      g.fillRect(w * 0.5 - ww / 2, y, ww, 1.2);
    }
  };
  S.tide = (g, w, h, tm, t) => {
    const sy = h * 0.55 + Math.sin(tm * 0.4) * 3;
    g.fillStyle = rgba('#2a6a86', 0.75);
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 3) {
      g.lineTo(x, sy + Math.sin(x * 0.13 + tm * 1.4) * 2 + Math.sin(x * 0.05 - tm) * 1.4);
    }
    g.lineTo(w, h); g.closePath(); g.fill();
    for (let x = 4; x < w; x += 7) {
      const y = sy + Math.sin(x * 0.13 + tm * 1.4) * 2;
      if (Math.sin(x * 0.7 + tm * 2.2) < 0.4) continue;
      g.fillStyle = rgba('#d8f2fb', 0.55);
      g.fillRect(x, y + 1, 4, 1);
    }
  };
  S.koi = (g, w, h, tm, t) => {
    // Fish. This is the card the whole file exists for.
    g.fillStyle = rgba('#0d2a2e', 0.5); g.fillRect(0, 0, w, h);
    const fish = (cx, cy, sc, col, phase) => {
      const wag = Math.sin(tm * 2.4 + phase) * 0.42;
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.sin(tm * 0.5 + phase) * 0.25);
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(0, 0, 9 * sc, 3.6 * sc, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();                       // tail
      g.moveTo(-8 * sc, 0);
      g.lineTo(-14 * sc, -3.4 * sc + wag * 4 * sc);
      g.lineTo(-14 * sc, 3.4 * sc + wag * 4 * sc);
      g.closePath(); g.fill();
      g.beginPath();                       // dorsal
      g.moveTo(1 * sc, -3 * sc); g.lineTo(-3 * sc, -6 * sc); g.lineTo(-4 * sc, -2.6 * sc);
      g.closePath(); g.fill();
      dot(g, 5.5 * sc, -1 * sc, 0.8 * sc, 'rgba(10,10,10,0.8)');
      g.restore();
    };
    const p = (tm * 0.16) % 1;
    fish(w * (0.15 + p * 0.7), h * 0.42, 1, rgba('#e8834a', 0.95), 0);
    fish(w * (0.9 - p * 0.7), h * 0.66, 0.8, rgba('#f0eee6', 0.9), 2.1);
    for (let i = 0; i < 3; i++) {
      const r = ((tm * 9 + i * 12) % 26);
      g.strokeStyle = rgba('#bfe6ee', 0.22 * (1 - r / 26));
      g.lineWidth = 0.9;
      g.beginPath(); g.ellipse(w * 0.32, h * 0.3, r, r * 0.4, 0, 0, Math.PI * 2); g.stroke();
    }
  };
  S.bubbles = (g, w, h, tm, t) => {
    for (let i = 0; i < 14; i++) {
      const x = h1(i) * w + Math.sin(tm + i) * 3;
      const y = h - ((tm * (8 + h1(i + 3) * 16) + h1(i + 6) * h) % (h + 12));
      const r = 1.4 + h1(i + 9) * 3.4;
      g.strokeStyle = rgba(t.accent, 0.5); g.lineWidth = 0.9;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      dot(g, x - r * 0.35, y - r * 0.35, r * 0.25, rgba('#ffffff', 0.55));
    }
  };
  S.deep = (g, w, h, tm, t) => {
    g.fillStyle = 'rgba(2,10,20,0.55)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = h1(i) * w, y = h1(i + 5) * h;
      const a = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(tm * (0.4 + h1(i)) * 2 + i));
      dot(g, x, y, 5, rgba(t.accent, a * 0.16));
      dot(g, x, y, 1.3, rgba(t.accent, a));
    }
  };

  // ── fire and light ────────────────────────────────────────────────────────
  const flame = (g, x, y, sc, tm, seed) => {
    const cols = ['rgba(255,246,200,0.95)', 'rgba(255,196,78,0.9)', 'rgba(244,122,30,0.85)'];
    for (let i = 0; i < 16; i++) {
      const p = ((tm * 1.6 + h1(seed + i) * 3) % 1);
      const fx = x + Math.sin(tm * 3 + i) * 2.2 * sc * p;
      const fy = y - p * 13 * sc;
      dot(g, fx, fy, (1 - p) * 2.6 * sc + 0.4, cols[Math.min(2, Math.floor(p * 3))]);
    }
  };
  S.embers = (g, w, h, tm, t) => {
    for (let i = 0; i < 22; i++) {
      const p = ((tm * 0.35 + h1(i)) % 1);
      const x = h1(i + 4) * w + Math.sin(tm * 1.4 + i) * 5;
      dot(g, x, h - p * h, 1.1 * (1 - p) + 0.4, rgba('#ff9a3c', 0.85 * (1 - p)));
    }
  };
  S.hearth = (g, w, h, tm, t) => {
    g.fillStyle = rgba('#ff8a2a', 0.10);
    g.fillRect(0, h * 0.4, w, h * 0.6);
    flame(g, w * 0.5, h * 0.86, 1.5, tm, 3);
    g.fillStyle = 'rgba(40,26,18,0.9)';
    g.fillRect(w * 0.32, h * 0.86, w * 0.36, 4);
  };
  S.nostalgia = (g, w, h, tm, t) => {
    // Barrel Fire, at card size: the drum, the flame in it, and snow.
    g.fillStyle = 'rgba(12,14,30,0.7)'; g.fillRect(0, 0, w, h);
    for (let x = 2; x < w; x += 7) {
      const bh = 6 + h1(x) * 14;
      g.fillStyle = 'rgba(10,11,26,0.95)';
      g.fillRect(x, h * 0.5 - bh, 6, bh + 3);
      if (h1(x + 3) > 0.6) {
        g.fillStyle = 'rgba(244,216,132,0.9)';
        g.fillRect(x + 2, h * 0.5 - bh + 3, 1, 2);
      }
    }
    g.fillStyle = 'rgba(196,206,226,0.95)';
    g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = 'rgba(58,44,38,1)';
    g.fillRect(w * 0.42, h * 0.62, w * 0.16, h * 0.18);
    flame(g, w * 0.5, h * 0.62, 1.1, tm, 7);
    for (let i = 0; i < 20; i++) {
      const y = ((tm * 6 + h1(i) * h) % h);
      dot(g, h1(i + 2) * w + Math.sin(tm + i) * 2, y, 0.9, 'rgba(230,238,250,0.85)');
    }
  };
  // Snow Street '97 shared the retro family's card with Barrel Fire, so two
  // very different scenes showed the same picture of a burning drum. This is
  // its own street: the lit shopfront in the middle, a lamp throwing a cone
  // onto the snow, a car crossing every few seconds, and weather.
  S.snowstreet = (g, w, h, tm, t) => {
    const ground = h * 0.74;

    // Night sky, warmer near the horizon the way a snowy city is.
    const sky = g.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, 'rgba(6,8,20,0.92)');
    sky.addColorStop(1, 'rgba(38,30,50,0.92)');
    g.fillStyle = sky; g.fillRect(0, 0, w, ground);

    // Terraces either side, with a few windows on.
    for (let x = -2; x < w + 6; x += 9) {
      const bh = h * (0.2 + h1(x) * 0.22);
      const top = ground - bh;
      g.fillStyle = 'rgba(14,15,30,1)';
      g.fillRect(x, top, 8, bh);
      g.fillStyle = 'rgba(70,80,110,0.5)';
      g.fillRect(x, top, 8, 1);                       // snow on the roof
      for (let r = 0; r < 3; r++) {
        if (h1(x * 3 + r) < 0.62) continue;
        g.fillStyle = 'rgba(240,206,140,0.85)';
        g.fillRect(x + 2 + (r % 2) * 3, top + 3 + r * 5, 2, 3);
      }
    }

    // The shop: a bright window in the middle, and the light it spills.
    const sx = w * 0.36, sw = w * 0.3, sy = ground - h * 0.3;
    g.fillStyle = 'rgba(24,18,24,1)';
    g.fillRect(sx, sy, sw, h * 0.3);
    const spill = g.createLinearGradient(0, sy, 0, ground + h * 0.1);
    spill.addColorStop(0, 'rgba(255,206,132,0.32)');
    spill.addColorStop(1, 'rgba(255,206,132,0)');
    g.fillStyle = spill;
    g.fillRect(sx - sw * 0.35, sy, sw * 1.7, ground - sy + h * 0.1);
    g.fillStyle = 'rgba(252,214,146,0.95)';
    g.fillRect(sx + 2, sy + h * 0.09, sw - 4, h * 0.14);
    // Stock on the shelf, as coloured specks.
    for (let i = 0; i < 7; i++) {
      g.fillStyle = ['#c43e34', '#3e8ccc', '#e8ca42', '#58b25c'][i % 4];
      g.fillRect(sx + 4 + i * ((sw - 8) / 7), sy + h * 0.17, 1.5, 2.5);
    }
    g.fillStyle = 'rgba(255,72,132,0.9)';                       // neon over the door
    g.fillRect(sx + sw * 0.25, sy + h * 0.04, sw * 0.5, 1.6);

    // Snow on the ground, and the road across it.
    g.fillStyle = 'rgba(196,206,226,0.95)'; g.fillRect(0, ground, w, h - ground);
    g.fillStyle = 'rgba(30,32,44,0.95)';    g.fillRect(0, ground + h * 0.09, w, h * 0.1);

    // A lamp, with its cone in the air and its pool on the snow.
    const lx = w * 0.14, lh = h * 0.34;
    g.fillStyle = 'rgba(18,20,30,1)'; g.fillRect(lx, ground - lh, 1.5, lh);
    g.fillStyle = 'rgba(255,238,200,1)'; g.fillRect(lx - 1, ground - lh, 3.5, 2);
    const cone = g.createRadialGradient(lx + 0.75, ground - lh + 1, 0, lx + 0.75, ground - lh + 1, h * 0.4);
    cone.addColorStop(0, 'rgba(255,216,160,0.34)');
    cone.addColorStop(1, 'rgba(255,216,160,0)');
    g.fillStyle = cone; g.fillRect(0, ground - lh - 2, w * 0.4, h);

    // A car, right to left, every few seconds.
    const cp = (tm * 0.3) % 2.2;
    if (cp < 1) {
      const cx = w * 1.1 - cp * (w * 1.3), cy = ground + h * 0.1;
      g.fillStyle = 'rgba(118,30,30,1)';
      g.fillRect(cx, cy, w * 0.17, h * 0.07);
      g.fillStyle = 'rgba(255,244,214,0.95)';
      g.fillRect(cx - 1.5, cy + h * 0.03, 2, 1.6);              // headlight
      g.fillStyle = 'rgba(255,60,50,0.9)';
      g.fillRect(cx + w * 0.17 - 1, cy + h * 0.03, 1.5, 1.4);   // tail light
    }

    // Weather, blowing across rather than straight down.
    for (let i = 0; i < 26; i++) {
      const y = (tm * 7 + h1(i) * h * 1.4) % (h * 1.1);
      const x = (h1(i + 5) * w - tm * 5 + Math.sin(tm * 0.8 + i) * 3 + w) % w;
      dot(g, x, y, h1(i + 9) > 0.75 ? 1.2 : 0.8, 'rgba(232,240,252,0.9)');
    }
  };

  S.lasttrain = (g, w, h, tm, t) => {
    g.fillStyle = 'rgba(9,11,24,0.75)'; g.fillRect(0, 0, w, h);
    // Conifers.
    g.fillStyle = 'rgba(7,9,16,1)';
    for (let x = -2; x < w + 4; x += 6) {
      const th = 8 + h1(x) * 10;
      g.beginPath();
      g.moveTo(x, h * 0.46); g.lineTo(x + 3, h * 0.46 - th); g.lineTo(x + 6, h * 0.46);
      g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(26,32,48,1)'; g.fillRect(0, h * 0.46, w, h * 0.2);
    g.fillStyle = 'rgba(120,126,138,0.9)';
    g.fillRect(0, h * 0.63, w, 1); g.fillRect(0, h * 0.66, w, 1);
    // The train, coming through every few seconds.
    const p = (tm * 0.22) % 1.6;
    if (p < 1) {
      const tx = -w * 0.5 + p * w * 2;
      g.fillStyle = 'rgba(18,20,28,1)';
      g.fillRect(tx, h * 0.46, w * 0.5, h * 0.17);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = 'rgba(252,234,180,0.95)';
        g.fillRect(tx + 3 + i * (w * 0.06), h * 0.5, w * 0.032, h * 0.06);
      }
    }
    g.fillStyle = 'rgba(22,24,31,1)'; g.fillRect(0, h * 0.7, w, h * 0.3);
    g.fillStyle = 'rgba(230,186,58,1)'; g.fillRect(0, h * 0.73, w, 1.4);
    for (let i = 0; i < 14; i++) {
      dot(g, h1(i) * w, ((tm * 5 + h1(i + 3) * h) % h), 0.8, 'rgba(206,218,240,0.8)');
    }
  };
  S.blackout = (g, w, h, tm, t) => {
    g.fillStyle = 'rgba(0,0,0,0.82)'; g.fillRect(0, 0, w, h);
    const cx = w * (0.5 + Math.sin(tm * 0.5) * 0.22), cy = h * 0.5;
    const grad = g.createRadialGradient(cx, cy, 1, cx, cy, Math.min(w, h) * 0.5);
    grad.addColorStop(0, rgba(t.accent, 0.55));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  };
  S.nightvision = (g, w, h, tm, t) => {
    g.fillStyle = 'rgba(6,26,12,0.75)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = h1(i + Math.floor(tm * 8) * 97) * w;
      const y = h1(i + 300 + Math.floor(tm * 8) * 31) * h;
      dot(g, x, y, 0.7, 'rgba(120,255,160,0.35)');
    }
    g.strokeStyle = 'rgba(120,255,160,0.5)'; g.lineWidth = 1;
    g.strokeRect(w * 0.5 - 8, h * 0.5 - 8, 16, 16);
    line(g, w * 0.5 - 14, h * 0.5, w * 0.5 - 10, h * 0.5, 'rgba(120,255,160,0.5)', 1);
    line(g, w * 0.5 + 10, h * 0.5, w * 0.5 + 14, h * 0.5, 'rgba(120,255,160,0.5)', 1);
  };

  S.fair = (g, w, h, tm, t) => {
    const grad = g.createLinearGradient(0, 0, 0, h * 0.7);
    grad.addColorStop(0, 'rgba(30,20,48,0.9)');
    grad.addColorStop(1, 'rgba(186,108,66,0.55)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const cx = w * 0.55, cy = h * 0.44, r = Math.min(w, h) * 0.32;
    g.strokeStyle = 'rgba(120,112,132,0.8)'; g.lineWidth = 0.8;
    line(g, cx, cy, cx - r * 0.7, h, 'rgba(90,84,104,0.9)', 1.2);
    line(g, cx, cy, cx + r * 0.7, h, 'rgba(90,84,104,0.9)', 1.2);
    for (let i = 0; i < 10; i++) {
      const a = tm * 0.5 + (i / 10) * Math.PI * 2;
      line(g, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 'rgba(150,142,166,0.7)', 0.7);
      const on = Math.sin(a * 3 - tm * 3) > 0;
      dot(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5,
        on ? 'rgba(255,232,176,0.95)' : 'rgba(120,110,120,0.7)');
    }
    g.strokeStyle = 'rgba(150,142,166,0.55)'; g.lineWidth = 0.8;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  };
  S.bedroom = (g, w, h, tm, t) => {
    g.fillStyle = 'rgba(22,20,28,0.85)'; g.fillRect(0, 0, w, h);
    const tw = w * 0.42, th = tw * 0.72;
    const tx = w * 0.5 - tw / 2, ty = h * 0.5 - th / 2;
    // Snow, per pixel per frame — the whole character of it is that it has no
    // pattern, so a scrolling texture would be the wrong thing entirely.
    const cell = 2;
    for (let y = 0; y < th; y += cell) {
      for (let x = 0; x < tw; x += cell) {
        const n = h1(Math.round(x / cell) * 71 + Math.round(y / cell) * 131 + Math.floor(tm * 12) * 977);
        g.fillStyle = n > 0.5 ? 'rgba(206,212,224,0.95)' : 'rgba(90,94,106,0.95)';
        g.fillRect(tx + x, ty + y, cell, cell);
      }
    }
    g.strokeStyle = 'rgba(60,58,66,1)'; g.lineWidth = 2.5;
    g.strokeRect(tx - 1, ty - 1, tw + 2, th + 2);
    const glow = g.createRadialGradient(w * 0.5, h * 0.5, 2, w * 0.5, h * 0.5, w * 0.7);
    glow.addColorStop(0, 'rgba(170,180,200,0.22)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
  };
  S.harbour = (g, w, h, tm, t) => {
    g.fillStyle = 'rgba(12,18,32,0.9)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(20,22,32,1)'; g.fillRect(0, h * 0.3, w, h * 0.22);
    for (let i = 0; i < 10; i++) {
      if (h1(i) < 0.45) continue;
      g.fillStyle = 'rgba(250,226,150,0.9)';
      g.fillRect(4 + i * (w / 10), h * 0.34 + h1(i + 4) * h * 0.12, 1.6, 2.2);
    }
    // The tower, and a beam that comes round rather than spinning in place.
    const lx = w * 0.78;
    g.fillStyle = 'rgba(206,206,200,1)'; g.fillRect(lx - 2, h * 0.16, 4, h * 0.36);
    g.fillStyle = 'rgba(176,62,54,1)'; g.fillRect(lx - 2, h * 0.26, 4, 3);
    const ph = Math.sin(tm * 1.1);
    if (ph > 0) {
      const dir = Math.cos(tm * 1.1) > 0 ? -1 : 1;
      const grad = g.createLinearGradient(lx, h * 0.18, lx + dir * w, h * 0.18);
      grad.addColorStop(0, 'rgba(246,240,214,' + (ph * 0.5).toFixed(2) + ')');
      grad.addColorStop(1, 'rgba(246,240,214,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(lx, h * 0.18);
      g.lineTo(lx + dir * w, h * 0.02);
      g.lineTo(lx + dir * w, h * 0.34);
      g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(22,44,66,0.95)'; g.fillRect(0, h * 0.52, w, h * 0.48);
    for (let i = 0; i < 12; i++) {
      const y = h * 0.55 + h1(i) * h * 0.42;
      const x = ((tm * 6 + h1(i + 3) * w) % w);
      g.fillStyle = 'rgba(176,212,234,0.45)';
      g.fillRect(x, y, 4 + h1(i + 6) * 5, 1);
    }
  };

  S.alley = (g, w, h, tm, t) => {
    g.fillStyle = 'rgba(6,9,18,0.95)'; g.fillRect(0, 0, w, h);
    // Brick, in courses, with a stagger — the same rule as the runtime, just
    // coarser. A flat brown rectangle does not read as a wall.
    for (let y = h * 0.16; y < h * 0.74; y += 3) {
      const course = Math.round(y / 3);
      for (let x = -4; x < w; x += 7) {
        const bx = x + (course % 2) * 3.5;
        const sh = h1(Math.round(bx) + course * 97);
        g.fillStyle = 'rgba(' + Math.round(46 + sh * 16) + ',' +
          Math.round(34 + sh * 13) + ',' + Math.round(30 + sh * 9) + ',1)';
        g.fillRect(bx, y, 6, 2);
      }
    }
    // Three lit windows. Only three: the rest of the block is asleep, and
    // that is what makes the lit ones worth looking at.
    const lit = [[0.22, 0.30], [0.44, 0.22], [0.62, 0.44]];
    for (let i = 0; i < 9; i++) {
      const x = w * (0.10 + (i % 3) * 0.26 + 0.04), y = h * (0.22 + Math.floor(i / 3) * 0.17);
      g.fillStyle = 'rgba(14,18,30,1)';
      g.fillRect(x, y, 7, 9);
    }
    for (const [u, v] of lit) {
      const x = w * u, y = h * v;
      const grad = g.createRadialGradient(x + 3, y + 4, 1, x + 3, y + 4, 14);
      grad.addColorStop(0, 'rgba(243,199,117,0.5)');
      grad.addColorStop(1, 'rgba(243,199,117,0)');
      g.fillStyle = grad; g.fillRect(x - 12, y - 11, 30, 32);
      g.fillStyle = 'rgba(250,214,140,0.95)';
      g.fillRect(x, y, 7, 9);
      g.fillStyle = 'rgba(120,92,52,0.9)';
      g.fillRect(x + 3, y, 1, 9); g.fillRect(x, y + 4, 7, 1);
    }
    // The lamp and its cone.
    const lx = w * 0.80, ly = h * 0.36;
    g.fillStyle = 'rgba(28,30,38,1)'; g.fillRect(lx - 0.5, ly, 1.5, h * 0.4);
    g.fillStyle = 'rgba(255,226,158,1)'; g.fillRect(lx - 3, ly - 4, 6, 4);
    const cone = g.createLinearGradient(lx, ly, lx, h);
    cone.addColorStop(0, 'rgba(255,226,158,0.34)');
    cone.addColorStop(1, 'rgba(255,226,158,0)');
    g.fillStyle = cone;
    g.beginPath(); g.moveTo(lx - 3, ly); g.lineTo(lx + 3, ly);
    g.lineTo(lx + 16, h); g.lineTo(lx - 16, h); g.closePath(); g.fill();
    // Snow on the ground, and the torch sweeping across it.
    g.fillStyle = 'rgba(200,214,238,0.95)'; g.fillRect(0, h * 0.76, w, h * 0.24);
    const aim = w * (0.4 + Math.sin(tm * 0.6) * 0.28);
    const beam = g.createLinearGradient(w * 0.12, h * 0.8, aim, h * 0.4);
    beam.addColorStop(0, 'rgba(255,244,210,0.5)');
    beam.addColorStop(1, 'rgba(255,244,210,0)');
    g.fillStyle = beam;
    g.beginPath(); g.moveTo(w * 0.12, h * 0.8);
    g.lineTo(aim - 9, h * 0.38); g.lineTo(aim + 9, h * 0.44); g.closePath(); g.fill();
    g.fillStyle = 'rgba(12,13,18,1)'; g.fillRect(w * 0.11, h * 0.68, 3, 10);
    for (let i = 0; i < 16; i++) {
      dot(g, h1(i) * w, ((tm * 7 + h1(i + 4) * h) % h), 0.9, 'rgba(228,238,252,0.8)');
    }
  };

  // ── instruments and screens ───────────────────────────────────────────────
  S.crt = (g, w, h, tm, t) => {
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y, w, 1);
    }
    const b = (tm * 40) % (h + 30) - 30;
    const grad = g.createLinearGradient(0, b, 0, b + 30);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, rgba(t.accent, 0.10));
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, b, w, 30);
  };
  S.scope = (g, w, h, tm, t) => {
    g.strokeStyle = rgba(t.accent, 0.13); g.lineWidth = 0.6;
    for (let i = 1; i < 5; i++) {
      line(g, (w / 5) * i, 0, (w / 5) * i, h, rgba(t.accent, 0.13), 0.6);
      line(g, 0, (h / 4) * i, w, (h / 4) * i, rgba(t.accent, 0.13), 0.6);
    }
    for (const pass of [[3.2, 0.18], [1.1, 0.85]]) {
      g.strokeStyle = rgba('#3ee88a', pass[1]);
      g.lineWidth = pass[0];
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const u = x / w;
        const y = h / 2 - (Math.sin(u * 12 + tm) * 0.5 + Math.sin(u * 27 + tm * 1.7) * 0.22) * h * 0.32;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  S.telex = (g, w, h, tm, t) => {
    const ty = h * 0.55, th = h * 0.3;
    g.fillStyle = 'rgba(186,178,160,0.92)'; g.fillRect(0, ty, w, th);
    const pitch = 6, off = (tm * 9) % pitch;
    for (let x = w - off; x > -pitch; x -= pitch) {
      dot(g, x, ty + th * 0.5, 0.9, 'rgba(16,15,14,0.9)');
      const bits = Math.floor(h1(Math.round((x + off) / pitch)) * 32);
      for (let b = 0; b < 5; b++) {
        if (!(bits & (1 << b))) continue;
        const r = ty + 3 + (b < 2 ? b : b + 1) * ((th - 6) / 5);
        dot(g, x, r, 1.5, 'rgba(16,15,14,0.9)');
      }
    }
    g.fillStyle = 'rgba(48,46,42,0.95)'; g.fillRect(w - 8, ty - 4, 6, th + 8);
  };
  S.circuit = (g, w, h, tm, t) => {
    g.strokeStyle = rgba(t.accent, 0.28); g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = h * (0.15 + i * 0.18);
      const bend = w * (0.3 + h1(i) * 0.4);
      g.beginPath(); g.moveTo(0, y); g.lineTo(bend, y);
      g.lineTo(bend + 8, y + (h1(i + 3) > 0.5 ? 8 : -8)); g.lineTo(w, y + (h1(i + 3) > 0.5 ? 8 : -8));
      g.stroke();
      const p = ((tm * 0.5 + h1(i)) % 1) * w;
      dot(g, p, y, 1.6, rgba(t.accent, 0.95));
    }
  };
  S.pulse = (g, w, h, tm, t) => {
    g.strokeStyle = rgba(t.accent, 0.85); g.lineWidth = 1.2;
    g.beginPath();
    const sweep = (tm * 0.5) % 1;
    for (let x = 0; x <= w; x += 2) {
      const u = ((x / w) - sweep + 1) % 1;
      let y = h / 2;
      if (u > 0.44 && u < 0.52) {
        const k = (u - 0.44) / 0.08;
        y -= Math.sin(k * Math.PI) * h * 0.34 * (k < 0.4 ? -0.3 : 1);
      }
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  };
  S.blueprint = (g, w, h, tm, t) => {
    g.strokeStyle = rgba(t.text, 0.13); g.lineWidth = 0.6;
    for (let x = 6; x < w; x += 8) line(g, x, 0, x, h, rgba(t.text, 0.10), 0.6);
    for (let y = 6; y < h; y += 8) line(g, 0, y, w, y, rgba(t.text, 0.10), 0.6);
    g.setLineDash([3, 3]);
    g.strokeStyle = rgba(t.accent, 0.7); g.lineWidth = 1;
    g.strokeRect(w * 0.2, h * 0.28, w * 0.6, h * 0.4);
    g.setLineDash([]);
  };
  S.filings = (g, w, h, tm, t) => {
    const cx = w * (0.5 + Math.sin(tm * 0.5) * 0.2), cy = h * 0.5;
    for (let i = 0; i < 90; i++) {
      const x = h1(i) * w, y = h1(i + 200) * h;
      const a = Math.atan2(y - cy, x - cx) + Math.PI / 2;
      line(g, x - Math.cos(a) * 2, y - Math.sin(a) * 2,
        x + Math.cos(a) * 2, y + Math.sin(a) * 2, rgba(t.text, 0.42), 0.9);
    }
  };
  S.music = (g, w, h, tm, t) => {
    for (let i = 0; i < 14; i++) {
      const v = Math.abs(Math.sin(tm * 3 + i * 0.7)) * (0.4 + h1(i) * 0.6);
      const bh = 3 + v * h * 0.6;
      g.fillStyle = rgba(t.accent, 0.35 + v * 0.5);
      g.fillRect(2 + i * ((w - 4) / 14), h - bh - 2, (w - 4) / 14 - 2, bh);
    }
  };
  S.sundial = (g, w, h, tm, t) => {
    const cx = w * 0.5, cy = h * 0.72;
    g.strokeStyle = rgba(t.text, 0.22); g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, Math.min(w, h) * 0.38, Math.PI, 0); g.stroke();
    const a = Math.PI + (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(tm * 0.25))) * Math.PI;
    line(g, cx, cy, cx + Math.cos(a) * w * 0.3, cy + Math.sin(a) * w * 0.3, rgba(t.accent, 0.85), 1.6);
    dot(g, cx, cy, 2, rgba(t.accent, 0.9));
  };
  S.almanac = (g, w, h, tm, t) => {
    const cx = w * 0.5, cy = h * 0.52, r = Math.min(w, h) * 0.32;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      line(g, cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8,
        cx + Math.cos(a) * r, cy + Math.sin(a) * r, rgba(t.text, 0.3), 1);
    }
    const a = (tm * 0.2 % 1) * Math.PI * 2 - Math.PI / 2;
    line(g, cx, cy, cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75, rgba(t.accent, 0.9), 1.6);
  };

  // ── typing ────────────────────────────────────────────────────────────────
  S.cursive = (g, w, h, tm, t) => {
    g.strokeStyle = rgba(t.accent, 0.75); g.lineWidth = 1.4;
    g.lineCap = 'round';
    g.beginPath();
    const n = 60, prog = 0.25 + 0.75 * ((tm * 0.4) % 1);
    for (let i = 0; i < n * prog; i++) {
      const u = i / n;
      const x = 6 + u * (w - 12);
      const y = h * 0.55 + Math.sin(u * 22) * 6 + Math.sin(u * 7) * 3;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  };
  S.ink = (g, w, h, tm, t) => {
    const p = (tm * 0.5) % 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = 4 + p * 14 + h1(i) * 4;
      dot(g, w * 0.5 + Math.cos(a) * r * 0.6, h * 0.5 + Math.sin(a) * r * 0.5,
        3 + h1(i + 4) * 3, rgba(t.text, 0.28 * (1 - p)));
    }
    dot(g, w * 0.5, h * 0.5, 5, rgba(t.text, 0.55));
  };
  S.ghost = (g, w, h, tm, t) => {
    const words = ['deleted', 'gone', 'was here'];
    g.font = '7px monospace';
    words.forEach((wd, i) => {
      const p = ((tm * 0.25 + i * 0.33) % 1);
      g.fillStyle = rgba(t.text, 0.36 * (1 - p));
      g.fillText(wd, 6 + i * 14, h * 0.7 - p * h * 0.4);
    });
  };
  S.wound = (g, w, h, tm, t) => {
    const p = 0.5 + 0.5 * Math.sin(tm * 1.6);
    g.strokeStyle = rgba(t.danger || '#e05a5a', 0.5 + p * 0.4);
    g.lineWidth = 1.2 + p;
    g.beginPath();
    g.moveTo(w * 0.2, h * 0.3);
    g.quadraticCurveTo(w * 0.5, h * 0.55, w * 0.78, h * 0.42);
    g.stroke();
    dot(g, w * 0.78, h * 0.42, 1.6, rgba(t.danger || '#e05a5a', 0.9));
  };
  S.zen = (g, w, h, tm, t) => {
    g.strokeStyle = rgba(t.text, 0.16); g.lineWidth = 0.9;
    const cx = w * 0.55, cy = h * 0.5;
    for (let y = 3; y < h; y += 5) {
      g.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const d = Math.hypot(x - cx, (y - cy) * 1.4);
        g.lineTo(x, y + Math.max(0, 10 - d) * 0.5 * Math.sin(tm));
      }
      g.stroke();
    }
    dot(g, cx, cy, 3.4, rgba(t.text, 0.35));
  };
  S.kintsugi = (g, w, h, tm, t) => {
    g.strokeStyle = rgba('#e2b24a', 0.85); g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, h * 0.7);
    g.lineTo(w * 0.28, h * 0.45); g.lineTo(w * 0.42, h * 0.6);
    g.lineTo(w * 0.7, h * 0.28); g.lineTo(w, h * 0.4);
    g.stroke();
    g.strokeStyle = rgba('#e2b24a', 0.4); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(w * 0.42, h * 0.6); g.lineTo(w * 0.5, h); g.stroke();
  };
  S.silk = (g, w, h, tm, t) => {
    const cx = 2, cy = 2;
    g.strokeStyle = rgba(t.text, 0.3); g.lineWidth = 0.7;
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      line(g, cx, cy, cx + Math.cos(a) * w * 0.7, cy + Math.sin(a) * h * 0.9, rgba(t.text, 0.28), 0.7);
    }
    for (let r = 8; r < w * 0.7; r += 7) {
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * (Math.PI / 2);
        const rr = r + Math.sin(tm * 2 + i) * 0.8;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 1.25;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = rgba(t.text, 0.22); g.stroke();
    }
  };

  // ── playable ──────────────────────────────────────────────────────────────
  S.sandbox = (g, w, h, tm, t) => {
    const pile = (cx, base) => {
      for (let i = 0; i < 60; i++) {
        const u = h1(i + base) - 0.5;
        const y = h - h1(i + base + 40) * h * 0.35;
        g.fillStyle = rgba('#d8b06a', 0.7);
        g.fillRect(cx + u * (h - y) * 1.6, y, 1.4, 1.4);
      }
    };
    pile(w * 0.35, 0); pile(w * 0.68, 90);
    for (let i = 0; i < 10; i++) {
      const y = ((tm * 30 + h1(i) * h) % h);
      g.fillStyle = rgba('#e6c184', 0.8);
      g.fillRect(w * 0.35 + (h1(i + 3) - 0.5) * 6, y, 1.4, 1.4);
    }
  };
  S.constellation = (g, w, h, tm, t) => {
    const pts = [];
    for (let i = 0; i < 9; i++) pts.push([h1(i) * w, h1(i + 30) * h]);
    g.strokeStyle = rgba(t.accent, 0.5); g.lineWidth = 0.8;
    g.beginPath();
    const n = 2 + Math.floor(((tm * 0.5) % 1) * (pts.length - 2));
    for (let i = 0; i < n; i++) {
      if (i === 0) g.moveTo(pts[i][0], pts[i][1]); else g.lineTo(pts[i][0], pts[i][1]);
    }
    g.stroke();
    pts.forEach((p, i) => dot(g, p[0], p[1], i < n ? 1.6 : 1, rgba('#e8eeff', i < n ? 0.95 : 0.45)));
  };
  S.marbles = (g, w, h, tm, t) => {
    const cols = ['#60a4dc', '#dc8060', '#8cc896', '#d6be60'];
    for (let i = 0; i < 5; i++) {
      const r = 3 + h1(i) * 3;
      const x = 6 + i * ((w - 12) / 5) + Math.sin(tm * 1.2 + i) * 3;
      const y = h - 4 - r - Math.abs(Math.sin(tm * 2 + i * 1.3)) * (i === 2 ? 10 : 2);
      dot(g, x, y, r, rgba(cols[i % cols.length], 0.85));
      dot(g, x - r * 0.3, y - r * 0.35, r * 0.3, 'rgba(255,255,255,0.8)');
    }
    g.fillStyle = rgba(t.text, 0.10); g.fillRect(0, h - 3, w, 1);
  };
  S.rippleink = (g, w, h, tm, t) => {
    const cols = ['#9d7fd9', '#6096d2', '#d48aaa'];
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = rgba(cols[k], 0.6); g.lineWidth = 1;
      g.beginPath();
      const R = 5 + k * 6;
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const wob = Math.sin(a * 3 + tm * 1.2 + k) * (2 + k);
        const x = w * 0.5 + Math.cos(a) * (R + wob) * 1.3;
        const y = h * 0.5 + Math.sin(a) * (R + wob);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.stroke();
    }
  };
  S.pendulums = (g, w, h, tm, t) => {
    const N = 7, top = h * 0.16;
    g.fillStyle = rgba(t.text, 0.25); g.fillRect(w * 0.1, top - 2, w * 0.8, 1.6);
    for (let i = 0; i < N; i++) {
      const px = w * 0.14 + i * (w * 0.72 / (N - 1));
      const L = h * 0.5 * (24 / (24 + i));
      const a = Math.sin(tm * 2 * (24 + i) / 24) * 0.5;
      const bx = px + Math.sin(a) * L, by = top + Math.cos(a) * L;
      line(g, px, top, bx, by, rgba(t.text, 0.22), 0.7);
      dot(g, bx, by, 2.4, rgba('#d8b46a', 0.9));
    }
  };

  // ── materials ─────────────────────────────────────────────────────────────
  S.glass = (g, w, h, tm, t) => {
    for (let i = 0; i < 3; i++) {
      const x = w * (0.2 + i * 0.3) + Math.sin(tm * 0.6 + i) * 6;
      const grad = g.createLinearGradient(x - 10, 0, x + 10, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.16)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(x - 10, 0, 20, h);
    }
  };
  S.marble = (g, w, h, tm, t) => {
    g.strokeStyle = rgba(t.text, 0.2); g.lineWidth = 0.8;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        g.lineTo(x, h * (0.2 + i * 0.2) + Math.sin(x * 0.09 + i * 2) * 5 + Math.sin(x * 0.31 + i) * 2);
      }
      g.stroke();
    }
  };
  S.velvet = (g, w, h, tm, t) => {
    const cx = w * (0.5 + Math.sin(tm * 0.4) * 0.3);
    const grad = g.createRadialGradient(cx, h * 0.5, 2, cx, h * 0.5, w * 0.6);
    grad.addColorStop(0, rgba(t.accent, 0.30));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  };
  S.obsidian = (g, w, h, tm, t) => {
    const sweep = ((tm * 0.25) % 1) * (w + h) - h * 0.5;
    for (let r = 1; r <= 5; r++) {
      const rr = 5 + r * 5;
      const at = w * 0.45 + h * 0.5;
      const lit = Math.max(0, 1 - Math.abs(at - sweep) / (w * 0.4));
      g.strokeStyle = rgba('#c4d6ea', 0.12 + lit * 0.6);
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const wob = 1 + Math.sin(a * 2 + r) * 0.16;
        const x = w * 0.45 + Math.cos(a) * rr * wob * 1.3;
        const y = h * 0.5 + Math.sin(a) * rr * wob;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.stroke();
    }
  };
  S.nacre = (g, w, h, tm, t) => {
    for (let i = 0; i < 9; i++) {
      const hue = (i * 34 + tm * 20) % 360;
      g.strokeStyle = 'hsla(' + hue.toFixed(0) + ',60%,72%,0.42)';
      g.lineWidth = 3;
      g.beginPath();
      const r = 6 + i * 5;
      g.ellipse(w * 0.2, h * 1.05, r * 1.5, r, 0, Math.PI, Math.PI * 2);
      g.stroke();
    }
  };
  S.fountain = (g, w, h, tm, t) => {
    for (let i = 0; i < 26; i++) {
      const p = ((tm * 0.9 + h1(i)) % 1);
      const a = (h1(i + 7) - 0.5) * 1.4;
      const v = 1 - Math.pow(2 * p - 1, 2);
      dot(g, w * 0.5 + Math.sin(a) * p * w * 0.4, h * 0.85 - v * h * 0.6,
        1.1, rgba('#bfe6ee', 0.8));
    }
    g.fillStyle = rgba('#2f6d80', 0.5); g.fillRect(0, h * 0.85, w, h * 0.15);
  };
  S.tuxedo = (g, w, h, tm, t) => {
    g.fillStyle = rgba(t.text, 0.85);
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.5);
    g.lineTo(w * 0.3, h * 0.4); g.lineTo(w * 0.3, h * 0.6); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.5);
    g.lineTo(w * 0.7, h * 0.4); g.lineTo(w * 0.7, h * 0.6); g.closePath(); g.fill();
    dot(g, w * 0.5, h * 0.5, 2.4, rgba(t.text, 0.95));
  };
  S.blackcard = (g, w, h, tm, t) => {
    g.fillStyle = rgba(t.elevatedHi, 0.9);
    g.fillRect(w * 0.18, h * 0.3, w * 0.64, h * 0.4);
    const grad = g.createLinearGradient(w * 0.18, 0, w * 0.82, 0);
    const p = (tm * 0.3) % 1;
    grad.addColorStop(Math.max(0, p - 0.2), 'rgba(255,255,255,0)');
    grad.addColorStop(p, 'rgba(255,255,255,0.34)');
    grad.addColorStop(Math.min(1, p + 0.2), 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(w * 0.18, h * 0.3, w * 0.64, h * 0.4);
  };

  // ── sound ─────────────────────────────────────────────────────────────────
  S.koto = (g, w, h, tm, t) => {
    for (let i = 0; i < 6; i++) {
      const y = h * (0.18 + i * 0.13);
      g.strokeStyle = rgba(t.text, 0.35); g.lineWidth = 0.8;
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const env = Math.max(0, Math.sin(tm * 2 - i));
        g.lineTo(x, y + Math.sin(x / w * Math.PI) * Math.sin(tm * 20 + i) * 3 * env);
      }
      g.stroke();
    }
  };
  S.chimes = (g, w, h, tm, t) => {
    const N = 5;
    g.fillStyle = rgba(t.text, 0.3); g.fillRect(w * 0.15, 3, w * 0.7, 1.4);
    for (let i = 0; i < N; i++) {
      const x = w * 0.2 + i * (w * 0.6 / (N - 1)) + Math.sin(tm * 1.4 + i) * 2;
      const L = h * (0.62 - i * 0.07);
      const ring = Math.max(0, Math.sin(tm * 1.1 - i * 0.6));
      const grad = g.createLinearGradient(x - 2, 0, x + 2, 0);
      grad.addColorStop(0, rgba('#5a6470', 0.8));
      grad.addColorStop(0.4, rgba('#cdd8e4', 0.6 + ring * 0.4));
      grad.addColorStop(1, rgba('#464e5a', 0.8));
      g.fillStyle = grad;
      g.fillRect(x - 2, 6, 4, L);
    }
  };
  S.cicadas = (g, w, h, tm, t) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(14,22,14,0.85)';
      g.beginPath();
      g.ellipse(h1(i) * w, h1(i + 20) * h, 10 + h1(i + 3) * 12, 5 + h1(i + 6) * 5,
        h1(i + 9) * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.max(0, Math.sin(tm * (1 + i * 0.3) + i));
      dot(g, w * (0.2 + i * 0.2), h * (0.3 + h1(i) * 0.4), 1.4, rgba('#c4d47a', a * 0.9));
    }
  };
  S.wind = (g, w, h, tm, t) => {
    for (let i = 0; i < 8; i++) {
      const x = ((tm * (30 + h1(i) * 60) + h1(i + 4) * w) % (w + 20)) - 10;
      const y = h1(i + 9) * h;
      g.save(); g.translate(x, y); g.rotate(tm * 3 + i);
      g.fillStyle = rgba('#96683a', 0.75);
      g.beginPath(); g.ellipse(0, 0, 3.4, 1.8, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.strokeStyle = rgba(t.text, 0.16); g.lineWidth = 0.8;
    for (let i = 0; i < 4; i++) {
      const y = h1(i + 30) * h;
      const x = ((tm * 90 + h1(i) * w) % (w + 40)) - 20;
      line(g, x - 14, y, x, y, rgba(t.text, 0.16), 0.8);
    }
  };
  S.mechanical = (g, w, h, tm, t) => {
    const N = 3;
    for (let i = 0; i < N; i++) {
      const down = Math.max(0, Math.sin(tm * 3 - i * 1.2)) > 0.7 ? 2 : 0;
      const x = w * 0.5 + (i - 1) * 13;
      g.fillStyle = rgba(t.elevatedHi, 0.95);
      g.fillRect(x - 5, h * 0.42 + down, 10, 9);
      g.fillStyle = rgba(t.text, 0.5);
      g.fillRect(x - 5, h * 0.42 + down, 10, 1.6);
    }
  };
  S.typewriter = (g, w, h, tm, t) => {
    g.fillStyle = rgba('#efe6d4', 0.9);
    g.fillRect(w * 0.15, h * 0.2, w * 0.7, h * 0.6);
    g.fillStyle = rgba('#3a2c24', 0.75);
    const chars = Math.floor(((tm * 3) % 12));
    for (let i = 0; i < chars; i++) g.fillRect(w * 0.2 + i * 4, h * 0.45, 2.6, 1.6);
    g.fillStyle = rgba(t.accent, 0.9);
    g.fillRect(w * 0.2 + chars * 4, h * 0.42, 1.4, 5);
  };

  // ---- family fallbacks -----------------------------------------------------
  // A theme with no sketch of its own still gets something that belongs to its
  // category, which beats a blank card and is honest about what it is.
  const FAMILY = {
    reactive: S.cursive,
    nature: S.starfall,
    machines: S.circuit,
    retro: S.nostalgia,
    live: S.almanac,
    sound: S.koto,
    play: S.constellation,
    luxury: S.glass
  };

  window.PP_SKETCH = {
    // Whether this theme has anything worth animating. A plain palette does
    // not, and drawing motes over it would be inventing a theme it is not.
    has(key, t) {
      return !!(S[key] || (t && t.fx && (S[t.fx] || FAMILY[t.type])));
    },
    draw(key, t, g, w, h, time) {
      const fn = S[key] || (t.fx && S[t.fx]) || (t.fx && FAMILY[t.type]);
      if (!fn) return false;
      g.clearRect(0, 0, w, h);
      g.save();
      try { fn(g, w, h, time, t); } catch (e) { /* one bad card is not the grid */ }
      g.restore();
      return true;
    }
  };
})();

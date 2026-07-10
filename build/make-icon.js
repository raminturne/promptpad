// Generates build/icon.ico (256x256 PNG-in-ICO) — no external deps.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const bg = [0x1b, 0x21, 0x1a];
const text = [0xd3, 0xda, 0xd9];
const accent = [0x7f, 0xbf, 0x8b];

// RGBA buffer
const px = Buffer.alloc(SIZE * SIZE * 4, 0); // transparent

function setPx(x, y, c, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // simple alpha blend over existing
  const ea = px[i + 3] / 255;
  const na = a / 255;
  const out = na + ea * (1 - na);
  for (let k = 0; k < 3; k++) {
    const ex = px[i + k];
    px[i + k] = Math.round((c[k] * na + ex * ea * (1 - na)) / (out || 1));
  }
  px[i + 3] = Math.round(out * 255);
}

function fillRoundRect(x0, y0, w, h, r, color, alpha = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.min(x - x0, x0 + w - 1 - x);
      const dy = Math.min(y - y0, y0 + h - 1 - y);
      if (dx < r && dy < r) {
        const ddx = r - dx;
        const ddy = r - dy;
        if (ddx * ddx + ddy * ddy > r * r) continue;
      }
      setPx(x, y, color, alpha);
    }
  }
}

function fillCircle(cx, cy, rad, color, alpha = 255) {
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= rad * rad) {
        // soft edge
        const edge = rad * rad - d;
        const a = edge < rad ? Math.min(255, alpha) : alpha;
        setPx(x, y, color, a);
      }
    }
  }
}

// Background rounded square
fillRoundRect(8, 8, SIZE - 16, SIZE - 16, 52, bg, 255);

// Notepad "text lines"
const lineX = 72;
const lineH = 16;
const radius = 8;
const rows = [
  { y: 92, w: 112 },
  { y: 128, w: 88 },
  { y: 164, w: 104 }
];
rows.forEach((row) => {
  fillRoundRect(lineX, row.y, row.w, lineH, radius, text, 235);
});

// Accent dot (cursor / bullet) with glow
fillCircle(196, 100, 26, accent, 30); // glow
fillCircle(196, 100, 14, accent, 255);

// ---------- PNG encode ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, body, crcBuf]);
}

const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// filtered scanlines (filter byte 0 per row)
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idatData = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idatData),
  chunk('IEND', Buffer.alloc(0))
]);

// ---------- ICO wrap ----------
const icondir = Buffer.alloc(6);
icondir.writeUInt16LE(0, 0); // reserved
icondir.writeUInt16LE(1, 2); // type icon
icondir.writeUInt16LE(1, 4); // count

const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 -> 0
entry[1] = 0; // height 256 -> 0
entry[2] = 0; // colors
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8); // size
entry.writeUInt32LE(22, 12); // offset (6 + 16)

const ico = Buffer.concat([icondir, entry, png]);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
console.log('Wrote build/icon.ico (' + ico.length + ' bytes)');

// Plain PNG too — used for the Linux build icon and the Linux/macOS tray
// (electron-builder's linux target wants a PNG, not an ICO).
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('Wrote build/icon.png (' + png.length + ' bytes)');

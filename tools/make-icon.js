// يرسم أيقونة «خريطة المصحف»: مصحف مفتوح على بلاطة خضراء، في صفحته اليمنى مربعات ملوّنة كبلاطات الخريطة
// Node خالص بلا مكتبات صور (تنعيم الحواف بأخذ عينات 4×4 لكل بكسل)؛ مبني على أداة أيقونة Elfar Tasks
// الاستخدام: node tools/make-icon.js → build/icon.png (512) وelectron/icon.png (256)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// الأشكال في مساحة تصميم 64×64
const P = (pts, color) => ({   // مضلّع
  hit: (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }, color: hex(color),
});
const L = (ax, ay, bx, by, w, color) => ({
  hit: (x, y) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= w / 2;
  }, color: hex(color),
});
const R = (x0, y0, w, h, color) => ({ hit: (x, y) => x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h, color: hex(color) });
const tile = {
  hit: (x, y) => {
    const r = 14, cx = Math.min(Math.max(x, r), 64 - r), cy = Math.min(Math.max(y, r), 64 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }, color: hex('#1f5e4a'),
};

const shapes = [
  tile,
  // غلاف المصحف (ذهبي) تحت الصفحتين
  P([[7, 21], [32, 25.5], [57, 21], [57, 49], [32, 53.5], [7, 49]], '#c9a227'),
  // الصفحتان
  P([[9, 22.5], [31.2, 26.6], [31.2, 51], [9, 47]], '#fbf6e8'),
  P([[32.8, 26.6], [55, 22.5], [55, 47], [32.8, 51]], '#fbf6e8'),
  L(32, 26, 32, 52, 1.2, '#b08a1e'),
  // الصفحة اليسرى: أسطر
  ...[0, 1, 2, 3, 4].map(k => L(12.5, 28 + k * 4.2 - 0.0, 28, 30.8 + k * 4.2, 1.5, '#9c9584')),
  // الصفحة اليمنى: بلاطات الخريطة
  ...[
    [36, 29, '#d4a017'], [42.5, 28, '#d4a017'], [49, 27, '#3b7dd8'],
    [36, 35.5, '#3b7dd8'], [42.5, 34.5, '#2fa36b'], [49, 33.5, '#d4a017'],
    [36, 42, '#2fa36b'], [42.5, 41, '#e3ddcf'], [49, 40, '#e3ddcf'],
  ].map(([x, y, c]) => R(x, y, 5, 5, c)),
];

function render(size) {
  const ss = 4, px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const u = ((x + (sx + 0.5) / ss) / size) * 64, v = ((y + (sy + 0.5) / ss) / size) * 64;
        let col = null;
        for (const sh of shapes) if (sh.hit(u, v)) col = sh.color;   // الأخير فوق
        if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
      }
      const i = (y * size + x) * 4, n = ss * ss;
      if (a) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, px);
}

// مُرمِّز PNG بسيط (RGBA، ٨ بت)
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), render(512));
fs.writeFileSync(path.join(root, 'electron', 'icon.png'), render(256));
console.log('icons written');

// يرسم شعار التطبيق من tools/logo.html (بخط الرقعة الحقيقي) إلى:
// • build/icon.png (512) وbuild/icon.ico (كل المقاسات، لملف التثبيت وشريط المهام)
// • electron/icon.png (256، للواجهة و«عن التطبيق») وelectron/icon.ico (للنافذة وبجوار الساعة)
// المقاسات ≤ ٦٤ من نسخة small (حروف أكبر وألوان أعمق) لتبقى واضحة في شريط المهام
// الاستخدام: npm run icon   (= electron tools/render-icon.js)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
// صفحة واحدة: تُلتقط النسخة الكاملة، ثم يُضاف صنف small وتُلتقط نسخة المقاسات الصغيرة
let win = null;
async function render(variant) {
  if (!win) {
    win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true,
      webPreferences: { offscreen: true } });
    await win.loadFile(path.join(__dirname, 'logo.html'));
    const ok = await win.webContents.executeJavaScript(
      `document.fonts.load('700 156px "Aref Ruqaa"').then(f => document.fonts.ready.then(() => f.length > 0))`);
    if (!ok) throw new Error('لم يُحمَّل خط الرقعة');
  }
  await win.webContents.executeJavaScript(`document.documentElement.classList.toggle('small', ${variant === 'small'}); 1`);
  await new Promise(r => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  return img.resize({ width: 512, height: 512, quality: 'best' });
}
// ملف ICO بصور PNG داخله (يدعمه ويندوز منذ Vista)
function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach(([size, png], k) => {
    const e = 6 + 16 * k;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  return Buffer.concat([head, ...entries.map(e => e[1])]);
}
app.whenReady().then(async () => {
  try {
    const big = await render(''), small = await render('small');
    const at = (img, n) => img.resize({ width: n, height: n, quality: 'best' }).toPNG();
    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const icoBuf = ico(sizes.map(n => [n, at(n <= 64 ? small : big, n)]));
    const root = path.join(__dirname, '..');
    fs.writeFileSync(path.join(root, 'build', 'icon.png'), big.toPNG());
    fs.writeFileSync(path.join(root, 'build', 'icon.ico'), icoBuf);
    fs.writeFileSync(path.join(root, 'electron', 'icon.png'), at(big, 256));
    fs.writeFileSync(path.join(root, 'electron', 'icon.ico'), icoBuf);
    console.log('icons written: png 512/256, ico', sizes.join(','));
    app.exit(0);
  } catch (e) { console.error(e.message); app.exit(1); }
});

// يرسم شعار التطبيق من tools/logo.html (بخط الرقعة الحقيقي) إلى صور PNG:
// build/icon.png (512، لملف التثبيت) وelectron/icon.png (256، للنافذة والتنبيهات) وelectron/tray.png (32، بجوار الساعة)
// الاستخدام: npx electron tools/render-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, 'logo.html'));
  const ok = await win.webContents.executeJavaScript(
    "document.fonts.load('700 156px \"Aref Ruqaa\"').then(f => document.fonts.ready.then(() => f.length > 0))");
  if (!ok) { console.error('لم يُحمَّل خط الرقعة'); app.exit(1); return; }
  await new Promise(r => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const root = path.join(__dirname, '..');
  const big = img.resize({ width: 512, height: 512, quality: 'best' });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), big.toPNG());
  fs.writeFileSync(path.join(root, 'electron', 'icon.png'), big.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(root, 'electron', 'tray.png'), big.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
  console.log('icons written', img.getSize());
  app.exit(0);
});

// اختبار الشاشة: يشغّل التطبيق الحقيقي مخفيًا بمجلد بيانات مؤقت (لا يمسّ بياناتك)،
// وفيه ملف data.json جاهز ليُختبر استرجاع البيانات منه، ثم ينفّذ tests/smoke.renderer.js داخل الصفحة.
// التشغيل: npm run smoke (وهو جزء من npm run dist)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahibak-smoke-'));
// سبع آيات الفاتحة محفوظة ومفهومة، وقراءة صفحة اليوم
const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
  app: 'quran-map', v: 1, saved: new Date().toISOString(),
  keys: { 'quranMap.v1': '3'.repeat(7) + '0'.repeat(6229), 'quranMap.v1.read': JSON.stringify({ [day]: [1] }), 'quranMap.v1.wird': '5' },
}));
const r = spawnSync(electron, ['.'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, QURAN_DATA_DIR: dir, QURAN_SMOKE: path.join(__dirname, 'smoke.renderer.js') },
  encoding: 'utf8', timeout: 120000,
});
const line = (r.stdout || '').split(/\r?\n/).find(l => l.startsWith('SMOKE_RESULT '));
const backups = fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : [];
fs.rmSync(dir, { recursive: true, force: true });
if (!line) { console.error('لم يُرسل اختبار الشاشة نتيجة.', r.error || '', (r.stderr || '').slice(-1500)); process.exit(1); }
const res = JSON.parse(line.slice(13));
res.checks = res.checks || {};
res.checks['نسخة احتياطية يومية في مجلد backups'] = backups.length === 1;
const failed = Object.entries(res.checks).filter(([, ok]) => !ok).map(([k]) => k);
for (const [k, ok] of Object.entries(res.checks)) console.log(ok ? '✓' : '✗', k);
if (res.error) console.error('خطأ:', res.error);
if (res.errors && res.errors.length) console.error('أخطاء الصفحة:', res.errors);
if (!res.ok || failed.length || res.error || (res.errors && res.errors.length)) process.exit(1);
console.log('اجتاز التطبيق اختبار الشاشة.');

// صاحبك القرآن — نسخة سطح المكتب (Electron)
// • الواجهة هي نفسها ملفات الويب في جذر المشروع
// • البيانات: تُحفظ في localStorage كما في المتصفح، ونسخة منها في ملف data.json داخل AppData
//   مع نسخة احتياطية تلقائية لكل يوم (آخر ٦٠ يومًا)، فلا تضيع بمسح بيانات أي متصفح
// • التحديثات: من إصدارات GitHub (electron-updater) في النسخة المثبّتة فقط
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'Sahibak Al-Quran';   // اسم مجلد البيانات في AppData (بحروف لاتينية)
app.setName(APP_NAME);
// QURAN_DATA_DIR للاختبارات فقط: مجلد بيانات منفصل لا يمسّ بيانات المستخدم
const USER_DIR = process.env.QURAN_DATA_DIR || path.join(app.getPath('appData'), APP_NAME);
app.setPath('userData', USER_DIR);
const DATA_FILE = path.join(USER_DIR, 'data.json');
const BACKUP_DIR = path.join(USER_DIR, 'backups');
const LOG_FILE = path.join(USER_DIR, 'errors.log');
const SMOKE = process.env.QURAN_SMOKE || '';

function logError(where, msg) {
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 300 * 1024) fs.writeFileSync(LOG_FILE, fs.readFileSync(LOG_FILE, 'utf8').slice(-150 * 1024));
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${where}] v${app.getVersion()} ${msg}\n`);
  } catch { /* لا نسمح للتسجيل بإيقاف التطبيق */ }
}
process.on('uncaughtException', e => logError('main', e && e.stack || e));
process.on('unhandledRejection', e => logError('main', e && e.stack || e));

// نافذة واحدة فقط: فتح التطبيق مرة ثانية يُظهر النافذة المفتوحة
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
let win = null;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// الروابط الخارجية تُفتح في المتصفح، والتطبيق لا ينتقل خارج ملفاته
app.on('web-contents-created', (e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (ev, url) => { if (!url.startsWith('file:')) ev.preventDefault(); });
});

// ---------- ملف البيانات ----------
function readData() {
  for (const f of [DATA_FILE, DATA_FILE + '.bak']) {
    try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (d && typeof d === 'object') return d; } catch { /* جرّب التالي */ }
  }
  return null;
}
const dayStamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function writeData(json) {
  try {
    JSON.parse(json);                                   // لا نكتب نصًا تالفًا أبدًا
    fs.mkdirSync(USER_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak');
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, DATA_FILE);                      // كتابة ذرّية: الملف إما القديم كاملًا أو الجديد كاملًا
    // نسخة احتياطية واحدة لكل يوم، ويُحتفظ بآخر ٦٠
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const today = path.join(BACKUP_DIR, `backup-${dayStamp()}.json`);
    fs.copyFileSync(DATA_FILE, today);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^backup-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 60)).forEach(f => fs.rmSync(path.join(BACKUP_DIR, f), { force: true }));
    return true;
  } catch (e) { logError('data', e && e.stack || e); return false; }
}
ipcMain.on('data:read', e => { e.returnValue = readData(); });
ipcMain.on('data:write', (e, json) => { writeData(json); });
ipcMain.on('data:write-sync', (e, json) => { e.returnValue = writeData(json); });
ipcMain.handle('data:open-backups', () => { fs.mkdirSync(BACKUP_DIR, { recursive: true }); return shell.openPath(BACKUP_DIR); });
ipcMain.on('log:error', (e, msg) => logError('renderer', msg));
ipcMain.on('app:version', e => { e.returnValue = app.getVersion(); });

// ---------- التحديث التلقائي (في النسخة المثبّتة فقط) ----------
let updaterInstall = () => null;
ipcMain.handle('app:install-update', () => updaterInstall());
function setupAutoUpdate() {
  if (!app.isPackaged || SMOKE) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;           // يُثبَّت بهدوء عند إغلاق التطبيق
  autoUpdater.on('update-downloaded', i => win && win.webContents.send('update-ready', i.version));
  autoUpdater.on('error', e => logError('updater', e && e.message || e));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 60 * 60 * 1000);
  updaterInstall = () => autoUpdater.quitAndInstall(true, true);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 980, minHeight: 680,
    title: 'صاحبك القرآن', show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131518' : '#f7f4ec',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
      backgroundThrottling: !SMOKE },   // في الاختبار تبقى النافذة مخفية فلا نبطّئ مؤقّتاتها
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.once('ready-to-show', () => { if (!SMOKE) { win.maximize(); win.show(); } });
  win.webContents.on('render-process-gone', (e, d) => logError('renderer', 'gone: ' + d.reason));
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3) logError('console', msg); });
  // اختبار الشاشة: يُشغَّل سكربت الاختبار داخل الصفحة ثم يُطبع الناتج ويُغلق التطبيق
  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      let res;
      try { res = await win.webContents.executeJavaScript(fs.readFileSync(SMOKE, 'utf8')); }
      catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
      process.stdout.write('SMOKE_RESULT ' + JSON.stringify(res) + '\n');
      // QURAN_SHOT: لقطة للنافذة بعد الاختبار (للمراجعة البصرية)
      if (process.env.QURAN_SHOT) {
        try { fs.writeFileSync(process.env.QURAN_SHOT, (await win.webContents.capturePage()).toPNG()); } catch (e) { logError('shot', e); }
      }
      app.exit(0);
    });
  }
}

app.whenReady().then(() => { createWindow(); setupAutoUpdate(); });
app.on('window-all-closed', () => app.quit());

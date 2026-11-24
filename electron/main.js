// صاحبُك القرآن — نسخة سطح المكتب (Electron)
// • الواجهة هي نفسها ملفات الويب في جذر المشروع
// • البيانات: تُحفظ في localStorage كما في المتصفح، ونسخة منها في ملف data.json داخل AppData
//   مع نسخة احتياطية تلقائية لكل يوم (آخر ٦٠ يومًا)، فلا تضيع بمسح بيانات أي متصفح
// • التحديثات: من إصدارات GitHub (electron-updater) في النسخة المثبّتة فقط
// • التنبيهات: إغلاق النافذة يُبقي التطبيق بجوار الساعة (Tray)، ويبدأ مع ويندوز في الخلفية،
//   فتظهر تنبيهات الأوراد في وقتها في نافذة صغيرة فيها «ابدأ الآن» و«بعد ١٥ دقيقة» و«ليس اليوم»
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, Tray, Notification, screen } = require('electron');
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
const ICON = path.join(__dirname, 'icon.png');

// إعدادات سطح المكتب (منفصلة عن بيانات الورد)
const CONFIG_FILE = path.join(USER_DIR, 'config.json');
let config = { autostart: true, keepInTray: true, trayHintShown: false };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { /* أول تشغيل */ }
// يبدأ مخفيًا مع ويندوز، أو بعد تحديث ثُبِّت تلقائيًا والتطبيق في الخلفية
const START_HIDDEN = process.argv.includes('--hidden') || config.startHiddenOnce === true;
const saveConfig = () => { try { fs.mkdirSync(USER_DIR, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) { logError('config', e); } };

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
let quitting = false;
function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) { win.maximize(); win.show(); }
  win.focus();
}
app.on('second-instance', showMain);
app.on('before-quit', () => { quitting = true; });

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
// حالة التحديث تُعرض في الإعدادات: checking / downloading (مع النسبة) / ready / latest / error / dev
let updaterInstall = () => null, updaterCheck = () => null;
let upd = { status: app.isPackaged ? 'idle' : 'dev' };
const sendUpd = s => { upd = { ...s, at: Date.now() }; if (win) win.webContents.send('update-status', upd); };
ipcMain.handle('app:install-update', () => updaterInstall());
ipcMain.handle('update:check', () => updaterCheck());
ipcMain.on('update:get', e => { e.returnValue = upd; });
function setupAutoUpdate() {
  if (!app.isPackaged || SMOKE) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;           // يُثبَّت بهدوء عند إغلاق التطبيق
  let ready = null;
  autoUpdater.on('checking-for-update', () => { if (!ready) sendUpd({ status: 'checking' }); });
  autoUpdater.on('update-available', i => sendUpd({ status: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', p => sendUpd({ status: 'downloading', version: upd.version, percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-not-available', () => { if (!ready) sendUpd({ status: 'latest' }); });
  autoUpdater.on('update-downloaded', i => {
    ready = i.version;
    sendUpd({ status: 'ready', version: i.version });
    if (win) win.webContents.send('update-ready', i.version);
    installIfHidden();
  });
  // التحديث تلقائي: إن كانت النافذة مخفية (التطبيق بجوار الساعة) يُثبَّت فورًا بصمت ويعود التطبيق إلى الخلفية؛
  // وإن كانت ظاهرة فعند إخفائها، أو بالزر «حدِّث الآن» فيُثبَّت ويفتح التطبيق مباشرة
  const installIfHidden = () => {
    if (!ready || !win || win.isVisible()) return;
    config.startHiddenOnce = true; saveConfig();
    updaterInstall();
  };
  if (win) win.on('hide', () => setTimeout(installIfHidden, 1500));
  autoUpdater.on('error', e => { logError('updater', e && e.message || e); if (!ready) sendUpd({ status: 'error' }); });
  const check = () => { if (upd.status !== 'downloading') autoUpdater.checkForUpdates().catch(() => {}); };
  updaterCheck = check;
  setTimeout(check, 8000);
  setInterval(check, 60 * 60 * 1000);
  // /S --force-run: تثبيت صامت بلا معالج، ثم يُفتح التطبيق وحده
  updaterInstall = () => {
    quitting = true;
    if (remWin) { remWin.destroy(); remWin = null; }
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  };
}

// ---------- التشغيل مع ويندوز ----------
function applyAutostart() {
  if (!app.isPackaged || SMOKE) return;
  try { app.setLoginItemSettings({ openAtLogin: !!config.autostart, args: ['--hidden'] }); } catch (e) { logError('autostart', e); }
}
ipcMain.on('autostart:get', e => { e.returnValue = !!config.autostart; });
ipcMain.handle('autostart:set', (e, on) => { config.autostart = !!on; saveConfig(); applyAutostart(); return config.autostart; });
ipcMain.on('tray:get', e => { e.returnValue = config.keepInTray !== false; });
ipcMain.handle('tray:set', (e, on) => { config.keepInTray = !!on; saveConfig(); return config.keepInTray; });

// ---------- أيقونة بجوار الساعة ----------
let tray = null;
function setupTray() {
  if (SMOKE) return;
  tray = new Tray(path.join(__dirname, 'tray.png'));
  tray.setToolTip('صاحبُك القرآن');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'فتح صاحبُك القرآن', click: showMain },
    { type: 'separator' },
    { label: 'خروج', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showMain);
}

// ---------- نافذة التنبيه ----------
// تطلبها الواجهة (التي تعرف أي الأوراد لم يكتمل) عبر reminder:show، وتُعاد إليها اختيارات المستخدم
let remWin = null;
const remQueue = [];
function showReminder(r) {
  if (remWin) { remQueue.push(r); return; }
  const wa = screen.getPrimaryDisplay().workArea, W = 400, H = 186;
  remWin = new BrowserWindow({
    width: W, height: H, x: wa.x + wa.width - W - 16, y: wa.y + wa.height - H - 16,
    frame: false, resizable: false, movable: true, alwaysOnTop: true, skipTaskbar: true, show: false,
    focusable: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1f23' : '#fffdf8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  remWin.loadFile(path.join(__dirname, 'reminder.html'), { query: { kind: r.kind, title: r.title, body: r.body } });
  remWin.once('ready-to-show', () => remWin && remWin.showInactive());
  // إن تُرك التنبيه دون اختيار يُختفي بعد دقيقتين ويُعاد بعد ١٥ دقيقة
  const auto = setTimeout(() => act(r.kind, 'auto'), 2 * 60 * 1000);
  const act = (kind, action) => {
    clearTimeout(auto);
    if (win) win.webContents.send('reminder:action', { kind, action });
    if (action === 'open') showMain();
    if (remWin) { remWin.destroy(); remWin = null; }
    if (remQueue.length) setTimeout(() => showReminder(remQueue.shift()), 600);
  };
  remWin.__act = act;
}
ipcMain.on('reminder:show', (e, r) => { if (r && r.kind && !SMOKE) showReminder(r); });
ipcMain.on('reminder:act', (e, kind, action) => { if (remWin && remWin.__act) remWin.__act(kind, action); });

function createWindow() {
  if (config.startHiddenOnce) { config.startHiddenOnce = false; saveConfig(); }
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 980, minHeight: 680,
    title: 'صاحبُك القرآن', show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131518' : '#f7f4ec',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
      backgroundThrottling: !SMOKE },   // في الاختبار تبقى النافذة مخفية فلا نبطّئ مؤقّتاتها
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.once('ready-to-show', () => { if (!SMOKE && !START_HIDDEN) { win.maximize(); win.show(); } });
  // الإغلاق يُخفي النافذة ويُبقي التطبيق يعمل للتنبيهات؛ والخروج من أيقونة الساعة
  win.on('close', e => {
    if (quitting || SMOKE || config.keepInTray === false) { quitting = true; return; }
    e.preventDefault();
    win.hide();
    if (!config.trayHintShown && Notification.isSupported()) {
      config.trayHintShown = true; saveConfig();
      new Notification({ title: 'صاحبُك القرآن يعمل في الخلفية', body: 'ليذكّرك بأورادك في وقتها. للخروج: اضغط بالزر الأيمن على أيقونته بجوار الساعة ثم «خروج».', icon: ICON }).show();
    }
  });
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

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.elfar.sahibak');   // لظهور اسم التطبيق في إشعارات ويندوز
  createWindow(); setupTray(); applyAutostart(); setupAutoUpdate();
});
app.on('window-all-closed', () => { if (SMOKE || quitting) app.quit(); });

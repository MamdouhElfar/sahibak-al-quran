// الجسر بين الواجهة ونسخة سطح المكتب: ملف البيانات، والنسخ الاحتياطية، والتحديثات
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qmDesktop', {
  readData: () => ipcRenderer.sendSync('data:read'),              // متزامن: يُقرأ مرة واحدة عند البدء
  writeData: json => ipcRenderer.send('data:write', json),
  writeDataSync: json => ipcRenderer.sendSync('data:write-sync', json),   // عند إغلاق النافذة
  openBackups: () => ipcRenderer.invoke('data:open-backups'),
  version: ipcRenderer.sendSync('app:version'),
  logError: msg => ipcRenderer.send('log:error', String(msg).slice(0, 2000)),
  onUpdateReady: cb => ipcRenderer.on('update-ready', (e, v) => cb(v)),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  // التنبيهات والتشغيل مع ويندوز
  showReminder: r => ipcRenderer.send('reminder:show', r),
  onReminderAction: cb => ipcRenderer.on('reminder:action', (e, a) => cb(a)),
  reminderAct: (kind, action) => ipcRenderer.send('reminder:act', kind, action),   // من نافذة التنبيه نفسها
  getAutostart: () => ipcRenderer.sendSync('autostart:get'),
  setAutostart: on => ipcRenderer.invoke('autostart:set', on),
  getKeepInTray: () => ipcRenderer.sendSync('tray:get'),
  setKeepInTray: on => ipcRenderer.invoke('tray:set', on),
  // التحديثات
  getUpdate: () => ipcRenderer.sendSync('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  onUpdateStatus: cb => ipcRenderer.on('update-status', (e, s) => cb(s)),
  // مخزن نموذج التسميع في مجلد البيانات
  tilawa: {
    get: k => ipcRenderer.invoke('tw:get', k).then(b => b ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null),
    put: (k, bytes) => ipcRenderer.invoke('tw:put', k, bytes),
    delete: k => ipcRenderer.invoke('tw:delete', k),
    keys: () => ipcRenderer.invoke('tw:keys'),
    size: () => ipcRenderer.invoke('tw:size'),
    clear: () => ipcRenderer.invoke('tw:clear'),
  },
});

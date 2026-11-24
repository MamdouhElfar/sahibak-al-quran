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
});

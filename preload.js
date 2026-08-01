const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');

contextBridge.exposeInMainWorld('electronAPI', {
  saveEvents: (payload) => ipcRenderer.sendSync('save-events', payload),
  loadEvents: () => ipcRenderer.sendSync('load-events'),
  saveMemoImage: (base64Data) => ipcRenderer.sendSync('save-memo-image', base64Data),
  cleanUnusedMemoImages: (activePaths) => ipcRenderer.send('clean-unused-memo-images', activePaths),
  showSaveDialog: (defaultName) => ipcRenderer.invoke('show-save-dialog', defaultName),
  showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),
  showWindow: () => ipcRenderer.send('show-window'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  triggerAlarmWindow: (payload) => ipcRenderer.send('trigger-alarm-window', payload),
  dismissAlarm: () => ipcRenderer.send('dismiss-alarm'),
  snoozeAlarm: () => ipcRenderer.send('snooze-alarm'),
  registerGlobalShortcut: (accelerator) => ipcRenderer.invoke('register-global-shortcut', accelerator),
  send: (channel, data) => ipcRenderer.send(channel, data),
  checkForUpdates: () => ipcRenderer.send('check-for-updates-manual'),
  onRegisterSnooze: (callback) => ipcRenderer.on('register-snooze-from-main', (event, ...args) => callback(...args)),
  writeCustomFile: (filePath, data) => {
    try {
      fs.writeFileSync(filePath, data, 'utf-8');
      return true;
    } catch (e) {
      console.error('Failed to write custom file:', e);
      return false;
    }
  },
  readCustomFile: (filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error('Failed to read custom file:', e);
      return null;
    }
  }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('app:init'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  selectRegion: (displayId) => ipcRenderer.invoke('region:select', displayId),
  listCameras: () => ipcRenderer.invoke('cameras:list'),
  listRecordings: () => ipcRenderer.invoke('recordings:list'),
  startRecording: (opts) => ipcRenderer.invoke('record:start', opts),
  sendAudioChunk: (buf) => ipcRenderer.send('record:audio-chunk', buf),
  stopRecording: () => ipcRenderer.invoke('record:stop'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  showFile: (p) => ipcRenderer.invoke('file:show', p),
  openFile: (p) => ipcRenderer.invoke('file:open', p),
  regionDone: (rect) => ipcRenderer.send('region:done', rect),
  onStats: (cb) => ipcRenderer.on('record:stats', (_e, s) => cb(s)),
  onHotkey: (cb) => ipcRenderer.on('hotkey:toggle', () => cb()),
  edit: {
    pickVideo: () => ipcRenderer.invoke('edit:pick-video'),
    pickMusic: () => ipcRenderer.invoke('edit:pick-music'),
    probe: (p) => ipcRenderer.invoke('edit:probe', p),
    thumbs: (p, duration, count) => ipcRenderer.invoke('edit:thumbs', p, duration, count),
    export: (opts) => ipcRenderer.invoke('edit:export', opts),
    cancel: () => ipcRenderer.invoke('edit:cancel'),
    saveText: (o) => ipcRenderer.invoke('edit:save-text', o),
    onProgress: (cb) => ipcRenderer.on('edit:progress', (_e, p) => cb(p)),
  },
});

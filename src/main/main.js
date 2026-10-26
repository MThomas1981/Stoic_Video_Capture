const {
  app, BrowserWindow, ipcMain, screen, dialog, shell, globalShortcut, session, desktopCapturer, protocol,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { MODES, DEFAULT_SETTINGS } = require('./presets');
const { probeCapabilities, listCameras } = require('./ffmpeg');
const { Recorder } = require('./recorder');
const media = require('./media');

// media://local/<encoded path> serves local files to <video>/<audio> with
// range support so the editor can seek frame by frame.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: false } },
]);

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
};

function serveMedia(request) {
  const file = decodeURIComponent(new URL(request.url).pathname.slice(1));
  if (!MIME[path.extname(file).toLowerCase()] || !fs.existsSync(file)) {
    return new Response('Not found', { status: 404 });
  }
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()];
  const range = request.headers.get('Range');
  const m = range && range.match(/bytes=(\d*)-(\d*)/);
  if (!m) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    });
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

const recorder = new Recorder();
let mainWindow = null;
let settings = null;

// ---------- settings ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaultOutputDir = () => path.join(app.getPath('videos'), 'Stoic Video Capture');

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { /* first run */ }
  return { ...DEFAULT_SETTINGS, outputDir: defaultOutputDir(), ...saved };
}

function saveSettings(next) {
  settings = { ...settings, ...next };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  registerHotkey();
  return settings;
}

// ---------- displays ----------

// DXGI usually numbers the primary monitor 0, then the rest left to right.
function orderedDisplays() {
  const primary = screen.getPrimaryDisplay();
  const rest = screen.getAllDisplays().filter((d) => d.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return [primary, ...rest].map((d, index) => ({
    id: d.id,
    index,
    label: `Display ${index + 1}${index === 0 ? ' (main)' : ''} – ${Math.round(d.bounds.width * d.scaleFactor)}×${Math.round(d.bounds.height * d.scaleFactor)}`,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
  }));
}

function selectedDisplay() {
  const all = orderedDisplays();
  return all.find((d) => d.id === settings.displayId) || all[0];
}

function virtualOrigin() {
  const all = orderedDisplays();
  return {
    x: Math.min(...all.map((d) => d.bounds.x * d.scaleFactor)),
    y: Math.min(...all.map((d) => d.bounds.y * d.scaleFactor)),
  };
}

// ---------- region picker ----------

function pickRegion(displayId) {
  const display = orderedDisplays().find((d) => d.id === displayId) || selectedDisplay();
  return new Promise((resolve) => {
    const overlay = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.loadFile(path.join(__dirname, '..', 'renderer', 'region.html'));
    let done = false;
    const finish = (rect) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('region:done', onDone);
      if (!overlay.isDestroyed()) overlay.close();
      if (!rect || rect.width < 16 || rect.height < 16) return resolve(null);
      const s = display.scaleFactor;
      resolve({
        x: Math.round(rect.x * s), y: Math.round(rect.y * s),
        width: Math.round(rect.width * s), height: Math.round(rect.height * s),
      });
    };
    const onDone = (e, rect) => { if (e.sender === overlay.webContents) finish(rect); };
    ipcMain.on('region:done', onDone);
    overlay.on('closed', () => finish(null));
  });
}

// ---------- hotkey ----------

function registerHotkey() {
  globalShortcut.unregisterAll();
  if (!settings.hotkey) return;
  try {
    globalShortcut.register(settings.hotkey, () => mainWindow?.webContents.send('hotkey:toggle'));
  } catch { /* invalid accelerator; the UI validates too */ }
}

// ---------- recordings list ----------

function listRecordings() {
  const dir = settings.outputDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.(mp4|mkv|mov|webm)$/i.test(f))
    .map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { name: f, path: p, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 50);
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('app:init', async () => ({
    settings,
    modes: MODES,
    caps: await probeCapabilities(),
    displays: orderedDisplays(),
    cameras: await listCameras(),
    recordings: listRecordings(),
    version: app.getVersion(),
  }));

  ipcMain.handle('settings:save', (_e, next) => saveSettings(next));
  ipcMain.handle('region:select', (_e, displayId) => pickRegion(displayId));
  ipcMain.handle('cameras:list', () => listCameras());
  ipcMain.handle('recordings:list', () => listRecordings());

  ipcMain.handle('record:start', async (_e, { audioStartedAt }) => {
    const caps = await probeCapabilities();
    if (!caps.ok) throw new Error(caps.error);
    const result = await recorder.start({
      settings,
      caps,
      display: selectedDisplay(),
      virtualOrigin: virtualOrigin(),
      outputDir: settings.outputDir,
      audioStartedAt,
      onStats: (stats) => mainWindow?.webContents.send('record:stats', stats),
    });
    mainWindow?.setTitle('● Recording – Stoic Video Capture');
    return result;
  });

  ipcMain.on('record:audio-chunk', (_e, chunk) => recorder.appendAudio(chunk));

  ipcMain.handle('record:stop', async () => {
    try {
      return await recorder.stop();
    } finally {
      mainWindow?.setTitle('Stoic Video Capture');
    }
  });

  ipcMain.handle('folder:choose', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.outputDir,
    });
    if (res.canceled || !res.filePaths[0]) return settings;
    return saveSettings({ outputDir: res.filePaths[0] });
  });
  ipcMain.handle('folder:open', () => {
    fs.mkdirSync(settings.outputDir, { recursive: true });
    return shell.openPath(settings.outputDir);
  });
  ipcMain.handle('file:show', (_e, p) => shell.showItemInFolder(p));

  // ----- editor -----
  ipcMain.handle('edit:pick-video', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      defaultPath: settings.outputDir,
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'webm', 'm4v'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('edit:pick-music', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('edit:probe', (_e, p) => media.probe(p));
  ipcMain.handle('edit:thumbs', (_e, p, duration, count) => media.thumbnails(p, duration, count));
  ipcMain.handle('edit:export', async (_e, opts) => {
    const base = path.basename(opts.input).replace(/\.[^.]+$/, '');
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(settings.outputDir, `${base} (edited).mp4`),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    if (res.canceled || !res.filePath) return null;
    if (path.resolve(res.filePath) === path.resolve(opts.input)) {
      throw new Error('Choose a different file name; the original is being read.');
    }
    const caps = await probeCapabilities();
    return media.exportEdit({ ...opts, encoders: caps.encoders, outPath: res.filePath },
      (p) => mainWindow?.webContents.send('edit:progress', p));
  });
  ipcMain.handle('edit:cancel', () => media.cancelExport());
  ipcMain.handle('edit:save-text', async (_e, { suggestedName, text }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(settings.outputDir, suggestedName),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, text);
    return res.filePath;
  });
  ipcMain.handle('file:open', (_e, p) => shell.openPath(p));
}

// ---------- window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    title: 'Stoic Video Capture',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      backgroundThrottling: false, // keep audio recording while minimised
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('close', async (e) => {
    if (!recorder.active) return;
    e.preventDefault();
    try { await recorder.stop(); } catch { /* raw file is kept on failure */ }
    mainWindow.destroy();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    settings = loadSettings();
    protocol.handle('media', serveMedia);
    // System ("loopback") audio comes through getDisplayMedia in the renderer.
    session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    });
    registerIpc();
    registerHotkey();
    createWindow();
    probeCapabilities(); // warm up while the window loads
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}

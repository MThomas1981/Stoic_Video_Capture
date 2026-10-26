// Locates the bundled FFmpeg binary and asks it what this PC supports.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ENCODER_PRIORITY } = require('./ffmpeg-args');

function ffmpegPath() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'ffmpeg', exe),
    path.join(__dirname, '..', '..', 'resources', 'ffmpeg', exe),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || exe; // fall back to PATH
}

function run(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

async function testEncoder(name) {
  // A tiny real encode is the only reliable way to know the GPU/driver works.
  const res = await run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=black:s=320x240:r=30', '-frames:v', '5', '-c:v', name, '-f', 'null', '-']);
  return res.code === 0;
}

let capsPromise = null;

function probeCapabilities() {
  if (!capsPromise) {
    capsPromise = (async () => {
      const filters = await run(['-hide_banner', '-filters']);
      if (filters.code === -1) {
        return { ok: false, error: 'FFmpeg was not found', ddagrab: false, encoders: [] };
      }
      const ddagrab = process.platform === 'win32' && /\bddagrab\b/.test(filters.out);
      const test = async (list) => (await Promise.all(list.map(async (e) => [e, await testEncoder(e)])))
        .filter(([, ok]) => ok).map(([e]) => e);
      const [encoders, hevcEncoders] = await Promise.all([
        test(ENCODER_PRIORITY), test(['hevc_nvenc', 'hevc_amf', 'hevc_qsv', 'libx265']),
      ]);
      return { ok: true, ddagrab, encoders, hevcEncoders, path: ffmpegPath() };
    })();
  }
  return capsPromise;
}

/** Lists DirectShow cameras (webcams, capture cards). Windows only. */
async function listCameras() {
  if (process.platform !== 'win32') return [];
  const res = await run(['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  return parseDshowDevices(res.err).video;
}

function parseDshowDevices(text) {
  const video = [];
  const audio = [];
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) section = 'video';
    else if (/DirectShow audio devices/i.test(line)) section = 'audio';
    if (/Alternative name/i.test(line)) continue;
    const m = line.match(/"([^"]+)"(?:\s+\((video|audio|none)\))?/);
    if (!m) continue;
    const kind = m[2] || section;
    if (kind === 'video' && !video.includes(m[1])) video.push(m[1]);
    if (kind === 'audio' && !audio.includes(m[1])) audio.push(m[1]);
  }
  return { video, audio };
}

module.exports = { ffmpegPath, run, probeCapabilities, listCameras, parseDshowDevices };

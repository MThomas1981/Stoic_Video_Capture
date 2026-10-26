// Reading video files for the editor: probe, timeline thumbnails, export.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpegPath, run } = require('./ffmpeg');
const { buildExportArgs } = require('./edit-args');
const { FONTS } = require('../renderer/flavors');

function ffprobePath() {
  const ff = ffmpegPath();
  const probe = ff.replace(/ffmpeg(\.exe)?$/i, (_m, ext) => `ffprobe${ext || ''}`);
  return probe !== ff && fs.existsSync(probe) ? probe : (process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
}

function parseRate(r) {
  if (!r || r === '0/0') return 0;
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n;
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath(), ['-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', file], { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Could not read video: ${err.trim()}`));
      const j = JSON.parse(out);
      const v = j.streams.find((s) => s.codec_type === 'video');
      if (!v) return reject(new Error('This file has no video track'));
      const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 30;
      const duration = Number(j.format.duration) || Number(v.duration) || 0;
      resolve({
        path: file,
        name: path.basename(file),
        duration,
        fps,
        width: v.width,
        height: v.height,
        hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
        size: Number(j.format.size) || 0,
        frames: Math.round(duration * fps),
      });
    });
  });
}

/** Grabs `count` evenly spaced frames as small JPEG data URLs. */
async function thumbnails(file, duration, count = 24, height = 72) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoic-thumbs-'));
  const times = Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
  const results = new Array(count).fill(null);
  let next = 0;
  async function worker() {
    while (next < count) {
      const i = next++;
      const out = path.join(dir, `${i}.jpg`);
      await run(['-hide_banner', '-loglevel', 'error', '-y', '-ss', times[i].toFixed(3), '-i', file,
        '-frames:v', '1', '-vf', `scale=-2:${height}`, '-q:v', '6', out]);
      if (fs.existsSync(out)) results[i] = `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  fs.rmSync(dir, { recursive: true, force: true });
  return results.map((src, i) => ({ time: times[i], src }));
}

let currentExport = null;

function fontDir() {
  if (process.platform === 'win32') return path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  return '/usr/share/fonts/truetype/dejavu';
}

function exportEdit(opts, onProgress) {
  if (currentExport) return Promise.reject(new Error('An export is already running'));
  // drawtext reads each caption from a file, which avoids escaping problems.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stoic-export-'));
  const effects = opts.effects ? {
    ...opts.effects,
    texts: (opts.effects.texts || []).map((t, i) => {
      const textFile = path.join(tmp, `text${i}.txt`);
      fs.writeFileSync(textFile, String(t.text || ''));
      // Fall back to the bold font if this PC lacks the chosen one.
      const def = FONTS[t.font] || FONTS.bold;
      const file = path.join(fontDir(), process.platform === 'win32' ? def.win : def.linux);
      return { ...t, font: fs.existsSync(file) ? t.font : 'bold', textFile };
    }),
  } : undefined;
  let built;
  try {
    built = buildExportArgs({ ...opts, effects, fontDir: fontDir(), platform: process.platform });
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return Promise.reject(e);
  }
  const { args, outputDuration, encoder } = built;
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    currentExport = proc;
    let log = '';
    proc.stderr.on('data', (d) => {
      const text = String(d);
      log = (log + text).slice(-6000);
      const m = text.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
      if (m && outputDuration > 0) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        onProgress?.(Math.min(1, t / outputDuration));
      }
    });
    proc.on('error', (e) => { currentExport = null; fs.rmSync(tmp, { recursive: true, force: true }); reject(e); });
    proc.on('close', (code) => {
      const cancelled = proc.cancelled;
      currentExport = null;
      fs.rmSync(tmp, { recursive: true, force: true });
      if (cancelled) {
        fs.rmSync(opts.outPath, { force: true });
        return reject(new Error('Export cancelled'));
      }
      if (code !== 0) return reject(new Error(`Export failed (${encoder}):\n${log.trim()}`));
      onProgress?.(1);
      resolve({ path: opts.outPath, encoder });
    });
  });
}

function cancelExport() {
  if (!currentExport) return false;
  currentExport.cancelled = true;
  try { currentExport.stdin.write('q'); } catch { /* ignore */ }
  setTimeout(() => currentExport?.kill(), 2000);
  return true;
}

module.exports = { probe, thumbnails, exportEdit, cancelExport, ffprobePath };

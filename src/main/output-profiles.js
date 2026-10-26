// Export targets: file formats and one-click platform presets. Each target
// resolves to codecs, scaling, frame-rate caps and a bitrate or size budget.

const { QUALITY } = require('./presets');

const MiB = 1024 * 1024;

const FORMATS = {
  mp4: { label: 'MP4 (H.264)', ext: 'mp4', video: 'h264', audio: 'aac', note: 'Plays everywhere' },
  mp4hevc: { label: 'MP4 (H.265, smaller)', ext: 'mp4', video: 'hevc', audio: 'aac', note: 'About 40% smaller; newer devices' },
  mov: { label: 'MOV (H.264)', ext: 'mov', video: 'h264', audio: 'aac', note: 'For Premiere, Final Cut, iMovie' },
  mkv: { label: 'MKV (H.264)', ext: 'mkv', video: 'h264', audio: 'aac', note: 'Robust container for archiving' },
  webm: { label: 'WebM (VP9)', ext: 'webm', video: 'vp9', audio: 'opus', note: 'For websites; slower to export' },
  prores: { label: 'ProRes 422 HQ (MOV)', ext: 'mov', video: 'prores', audio: 'pcm', note: 'Editing-grade, very large files' },
  gif: { label: 'GIF (animated)', ext: 'gif', video: 'gif', audio: null, note: 'No sound; keep it short', defaultHeight: 360, maxFps: 15 },
  mp3: { label: 'MP3 (audio only)', ext: 'mp3', video: null, audio: 'mp3', note: 'Just the soundtrack' },
  wav: { label: 'WAV (audio only)', ext: 'wav', video: null, audio: 'pcm', note: 'Uncompressed soundtrack' },
};

// Mbps at 30 / 60 fps, from YouTube's upload recommendations.
const YT_BITRATES = { 2160: [35, 53], 1440: [16, 24], 1080: [8, 12], 720: [5, 7.5], 480: [2.5, 4], 360: [1, 1.5] };

const PLATFORMS = {
  youtube: { label: 'YouTube', maxHeight: 2160, maxFps: 60, bitrate: 'youtube', audioKbps: 256, note: 'Recommended upload settings' },
  steam: { label: 'Steam', maxHeight: 1080, maxFps: 60, mbps: [8, 10], audioKbps: 192, note: '1080p MP4 for Steam uploads and trailers' },
  twitch: { label: 'Twitch', maxHeight: 1080, maxFps: 60, mbps: [6, 8], audioKbps: 160, note: '1080p video upload' },
  x: { label: 'X / Twitter', maxHeight: 1080, maxFps: 60, mbps: [6, 10], audioKbps: 128, maxSeconds: 140, sizeMB: 512, note: '1080p, under 512 MB' },
  vertical: { label: 'TikTok / Shorts / Reels', vertical: true, maxFps: 60, mbps: [8, 10], audioKbps: 192, maxSeconds: 180, note: '1080×1920 vertical with blurred fill' },
  discord10: { label: 'Discord (10 MB)', sizeMB: 10, maxHeight: 1080, maxFps: 60, audioKbps: 96, note: 'Fits the free upload limit' },
  discord50: { label: 'Discord Nitro Basic (50 MB)', sizeMB: 50, maxHeight: 1080, maxFps: 60, audioKbps: 128, note: 'Fits Nitro Basic' },
  discord500: { label: 'Discord Nitro (500 MB)', sizeMB: 500, maxHeight: 1440, maxFps: 60, audioKbps: 160, note: 'Fits Nitro' },
  custom: { label: 'Custom file size…', sizeMB: null, maxHeight: 1080, maxFps: 60, audioKbps: 128, note: 'Squeeze to any size you choose' },
};

const RES_STEPS = [2160, 1440, 1080, 720, 480, 360];

const capHeight = (srcH, maxH) => (maxH && srcH > maxH ? maxH : null);

/**
 * @param {object} o
 * @param {object} o.target   { kind: 'format'|'platform', id, quality, height, sizeMB }
 * @param {object} o.source   { width, height, fps }  (final frame size after edits)
 * @param {number} o.duration seconds of the final video
 * @param {object} o.caps     { encoders: [...h264], hevcEncoders: [...] }
 * @param {number} o.bitrateScale  shrink factor when retrying a size target
 */
function resolveOutput({ target, source, duration, caps = {}, bitrateScale = 1 }) {
  const t = target || { kind: 'format', id: 'mp4' };
  const srcH = source.height;
  const srcFps = Math.round(source.fps || 60);
  const out = {
    ext: 'mp4', video: 'h264', audio: 'aac', audioKbps: 192, height: null, fps: null,
    vertical: false, mode: { type: 'quality', q: QUALITY[t.quality] ?? QUALITY.high },
    targetBytes: null, warnings: [], label: '',
  };

  if (t.kind === 'platform') {
    const p = PLATFORMS[t.id];
    if (!p) throw new Error(`Unknown export target: ${t.id}`);
    out.label = p.label;
    out.audioKbps = p.audioKbps;
    out.vertical = !!p.vertical;
    out.height = p.vertical ? null : capHeight(srcH, p.maxHeight);
    out.fps = srcFps > p.maxFps ? p.maxFps : null;
    const fps = out.fps || srcFps;
    const h = out.height || srcH;
    if (p.bitrate === 'youtube') {
      const step = RES_STEPS.slice().reverse().find((r) => r >= h) || 2160;
      out.mode = { type: 'bitrate', kbps: YT_BITRATES[step][fps > 30 ? 1 : 0] * 1000 };
    } else if (p.mbps) {
      out.mode = { type: 'bitrate', kbps: p.mbps[fps > 30 ? 1 : 0] * 1000 };
    }
    const sizeMB = t.id === 'custom' ? Number(t.sizeMB) : p.sizeMB;
    if (p.sizeMB !== undefined && t.id === 'custom' && !(sizeMB > 0)) throw new Error('Enter a file size in MB');
    if (sizeMB) {
      // Size budget: total bits over duration, minus audio, with 4% container headroom.
      out.targetBytes = sizeMB * MiB;
      const totalKbps = (sizeMB * MiB * 8 * 0.96) / 1000 / Math.max(1, duration);
      let audioKbps = p.audioKbps;
      if (totalKbps < 800) audioKbps = 64;
      let videoKbps = (totalKbps - audioKbps) * bitrateScale;
      // A big budget on a short clip shouldn't mean an absurd bitrate.
      const step = RES_STEPS.slice().reverse().find((r) => r >= h) || 2160;
      const ceiling = out.mode.type === 'bitrate' ? out.mode.kbps : YT_BITRATES[step][1] * 1500;
      videoKbps = Math.min(videoKbps, ceiling);
      if (videoKbps < 120) {
        throw new Error(`This video is too long to fit in ${sizeMB} MB. Trim it to under ${Math.floor((sizeMB * MiB * 8 * 0.96) / 1000 / 250)} seconds, or pick a bigger size.`);
      }
      out.audioKbps = audioKbps;
      // Low budgets look better smaller and at 30 fps than blocky at full size.
      if (videoKbps < 4500 && fps > 30) out.fps = 30;
      if (videoKbps < 1800) out.height = Math.min(out.height || srcH, 720);
      if (videoKbps < 900) out.height = Math.min(out.height || srcH, 480);
      if (videoKbps < 400) out.height = Math.min(out.height || srcH, 360);
      if (out.height && out.height >= srcH) out.height = null;
      out.mode = { type: 'bitrate', kbps: Math.round(videoKbps) };
    }
    if (p.maxSeconds && duration > p.maxSeconds) {
      out.warnings.push(`${p.label} may reject videos longer than ${Math.floor(p.maxSeconds / 60)}:${String(p.maxSeconds % 60).padStart(2, '0')}.`);
    }
  } else {
    const fmt = FORMATS[t.id];
    if (!fmt) throw new Error(`Unknown format: ${t.id}`);
    Object.assign(out, { ext: fmt.ext, video: fmt.video, audio: fmt.audio, label: fmt.label });
    const wanted = Number(t.height) || fmt.defaultHeight || null;
    out.height = wanted && wanted < srcH ? wanted : null;
    if (fmt.maxFps && srcFps > fmt.maxFps) out.fps = fmt.maxFps;
    if (out.audio === 'opus') out.audioKbps = 160;
    if (out.video === 'gif' && duration > 30) out.warnings.push('GIFs over 30 seconds get very large.');
  }

  out.encoder = pickVideoEncoder(out.video, caps);
  return out;
}

function pickVideoEncoder(video, caps) {
  const h264 = caps.encoders || [];
  const hevc = caps.hevcEncoders || [];
  switch (video) {
    case 'h264': return ['h264_nvenc', 'h264_amf', 'h264_qsv'].find((e) => h264.includes(e)) || 'libx264';
    case 'hevc': return ['hevc_nvenc', 'hevc_amf', 'hevc_qsv'].find((e) => hevc.includes(e)) || 'libx265';
    case 'vp9': return 'libvpx-vp9';
    case 'prores': return 'prores_ks';
    case 'gif': return 'gif';
    default: return null;
  }
}

function pixFmtFor(out) {
  if (out.video === 'prores') return 'yuv422p10le';
  if (out.encoder && out.encoder.endsWith('_qsv')) return 'nv12';
  return 'yuv420p';
}

/** Codec arguments for the chosen encoder and rate mode. */
function videoCodecArgs(out, fps) {
  const gop = String(Math.round(fps * 2));
  const m = out.mode;
  const kb = (n) => `${Math.round(n)}k`;
  const rate = m.type === 'bitrate' ? m.kbps : null;
  const q = m.q ?? QUALITY.high;
  switch (out.encoder) {
    case 'h264_nvenc':
    case 'hevc_nvenc':
      return ['-c:v', out.encoder, '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-g', gop,
        ...(rate ? ['-b:v', kb(rate), '-maxrate:v', kb(rate * 1.5), '-bufsize:v', kb(rate * 2)] : ['-cq', String(q), '-b:v', '0']),
        ...(out.encoder === 'hevc_nvenc' ? ['-tag:v', 'hvc1'] : [])];
    case 'h264_amf':
    case 'hevc_amf':
      return ['-c:v', out.encoder, '-quality', 'quality', '-g', gop,
        ...(rate ? ['-rc', 'vbr_peak', '-b:v', kb(rate), '-maxrate:v', kb(rate * 1.5)] : ['-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q + 2)]),
        ...(out.encoder === 'hevc_amf' ? ['-tag:v', 'hvc1'] : [])];
    case 'h264_qsv':
    case 'hevc_qsv':
      return ['-c:v', out.encoder, '-preset', 'medium', '-g', gop,
        ...(rate ? ['-b:v', kb(rate), '-maxrate:v', kb(rate * 1.5)] : ['-global_quality', String(q)]),
        ...(out.encoder === 'hevc_qsv' ? ['-tag:v', 'hvc1'] : [])];
    case 'libx265':
      return ['-c:v', 'libx265', '-preset', 'medium', '-tag:v', 'hvc1', '-g', gop,
        ...(rate ? ['-b:v', kb(rate), '-maxrate:v', kb(rate * 1.5), '-bufsize:v', kb(rate * 2)] : ['-crf', String(q + 3)])];
    case 'libvpx-vp9':
      return ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-g', gop,
        ...(rate ? ['-b:v', kb(rate), '-maxrate:v', kb(rate * 1.5), '-bufsize:v', kb(rate * 2)] : ['-crf', String(q + 10), '-b:v', '0'])];
    case 'prores_ks':
      return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0'];
    case 'gif':
      return ['-c:v', 'gif', '-loop', '0'];
    default: // libx264
      return ['-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-g', gop,
        ...(rate ? ['-b:v', kb(rate), '-maxrate:v', kb(rate * 1.5), '-bufsize:v', kb(rate * 2)] : ['-crf', String(q - 1)])];
  }
}

function audioCodecArgs(out) {
  switch (out.audio) {
    case 'aac': return ['-c:a', 'aac', '-b:a', `${out.audioKbps}k`];
    case 'opus': return ['-c:a', 'libopus', '-b:a', `${out.audioKbps}k`];
    case 'mp3': return ['-c:a', 'libmp3lame', '-q:a', '2'];
    case 'pcm': return ['-c:a', 'pcm_s16le'];
    default: return [];
  }
}

/** Human summary like "1080p · 60 fps · H.264 · ~12 Mbps". */
function describe(out, source) {
  const parts = [];
  if (out.vertical) parts.push('1080×1920 vertical');
  else if (out.video) parts.push(`${out.height || source.height}p`);
  if (out.video) parts.push(`${out.fps || Math.round(source.fps)} fps`);
  const codec = { h264: 'H.264', hevc: 'H.265', vp9: 'VP9', prores: 'ProRes', gif: 'GIF' }[out.video];
  if (codec) parts.push(codec);
  if (!out.video) parts.push('audio only');
  if (out.mode.type === 'bitrate' && out.video && out.video !== 'gif') parts.push(`~${(out.mode.kbps / 1000).toFixed(1)} Mbps`);
  if (out.targetBytes) parts.push(`under ${Math.round(out.targetBytes / MiB)} MB`);
  parts.push(`.${out.ext}`);
  return parts.join(' · ');
}

function listTargets() {
  return {
    platforms: Object.entries(PLATFORMS).map(([id, p]) => ({ id, label: p.label, note: p.note })),
    formats: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, note: f.note })),
  };
}

module.exports = {
  FORMATS, PLATFORMS, resolveOutput, videoCodecArgs, audioCodecArgs, pixFmtFor, describe, listTargets, MiB,
};

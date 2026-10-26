// Builds FFmpeg command lines. Kept free of Electron and child_process so the
// logic can be unit tested on any OS.

const { RESOLUTIONS, QUALITY } = require('./presets');

// Preferred order when encoder is "auto": GPU encoders first, CPU last.
const ENCODER_PRIORITY = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'];

function pickEncoder(requested, available) {
  if (requested && requested !== 'auto') {
    return available.includes(requested) ? requested : 'libx264';
  }
  return ENCODER_PRIORITY.find((e) => available.includes(e)) || 'libx264';
}

function even(n) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v - 1;
}

function encoderArgs(encoder, quality, fps, preferSpeed) {
  const q = QUALITY[quality] ?? QUALITY.high;
  const gop = String(Math.round(fps * 2));
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr',
        '-cq', String(q), '-b:v', '0', '-g', gop];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'balanced',
        '-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q + 2), '-g', gop];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', String(q), '-g', gop];
    default:
      return ['-c:v', 'libx264', '-preset', preferSpeed ? 'superfast' : 'veryfast',
        '-crf', String(q), '-pix_fmt', 'yuv420p', '-g', gop];
  }
}

/**
 * @param {object} o
 * @param {object} o.settings     merged user settings (see presets.DEFAULT_SETTINGS)
 * @param {object} o.caps         { ddagrab: bool, encoders: string[] }
 * @param {object} o.display      { index, bounds: {x,y,width,height}, scaleFactor } (screen source)
 * @param {object} o.virtualOrigin{ x, y } physical top-left of the whole desktop (gdigrab)
 * @param {string} o.outPath      temp video file (.mkv)
 * @returns {{ args: string[], encoder: string, captureMethod: string }}
 */
function buildRecordArgs({ settings, caps, display, virtualOrigin, outPath }) {
  const fps = Number(settings.fps) || 60;
  const encoder = pickEncoder(settings.encoder, caps.encoders || []);
  const targetHeight = RESOLUTIONS[settings.resolution] ?? null;
  const args = ['-hide_banner', '-loglevel', 'warning', '-stats', '-y'];
  const filters = [];
  let captureMethod;

  if (settings.source === 'camera') {
    if (!settings.cameraDevice) throw new Error('No camera selected');
    captureMethod = 'dshow';
    args.push('-f', 'dshow', '-rtbufsize', '512M', '-framerate', String(fps),
      '-i', `video=${settings.cameraDevice}`);
  } else {
    const scale = display?.scaleFactor || 1;
    const physW = even((display?.bounds.width || 1920) * scale);
    const physH = even((display?.bounds.height || 1080) * scale);
    const r = settings.source === 'region' && settings.region ? settings.region : null;
    const crop = r
      ? { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), w: even(r.width), h: even(r.height) }
      : null;

    if (caps.ddagrab) {
      // Desktop Duplication API: fast, low overhead, works with most games.
      captureMethod = 'ddagrab';
      const opts = [`output_idx=${display?.index ?? 0}`, `framerate=${fps}`,
        `draw_mouse=${settings.cursor ? 1 : 0}`];
      if (crop) opts.push(`offset_x=${crop.x}`, `offset_y=${crop.y}`, `video_size=${crop.w}x${crop.h}`);
      args.push('-f', 'lavfi', '-i', `ddagrab=${opts.join(':')}`);
      // NVENC and AMF can take the GPU frames directly when no scaling is needed.
      const zeroCopy = !targetHeight && (encoder === 'h264_nvenc' || encoder === 'h264_amf');
      if (!zeroCopy) filters.push('hwdownload', 'format=bgra');
    } else {
      // Fallback: GDI capture. Slower, but works everywhere.
      captureMethod = 'gdigrab';
      const ox = Math.round((display?.bounds.x || 0) * scale - (virtualOrigin?.x || 0)) + (crop?.x || 0);
      const oy = Math.round((display?.bounds.y || 0) * scale - (virtualOrigin?.y || 0)) + (crop?.y || 0);
      args.push('-f', 'gdigrab', '-framerate', String(fps),
        '-draw_mouse', settings.cursor ? '1' : '0',
        '-offset_x', String(ox), '-offset_y', String(oy),
        '-video_size', `${crop ? crop.w : physW}x${crop ? crop.h : physH}`,
        '-i', 'desktop');
    }
  }

  if (targetHeight) filters.push(`scale=-2:${targetHeight}:flags=bicubic`);
  if (filters.length && encoder !== 'libx264') filters.push('format=nv12');
  if (filters.length) args.push('-vf', filters.join(','));

  args.push(...encoderArgs(encoder, settings.quality, fps, settings.source !== 'camera'));
  args.push('-an', outPath);
  return { args, encoder, captureMethod };
}

/** Combine the recorded video with the separately recorded audio track. */
function buildMuxArgs({ videoPath, audioPath, outPath, audioOffsetMs = 0 }) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-y', '-i', videoPath];
  if (audioPath) {
    // Positive offset = audio started earlier than video, so skip into it.
    if (audioOffsetMs > 0) args.push('-ss', (audioOffsetMs / 1000).toFixed(3));
    else if (audioOffsetMs < 0) args.push('-itsoffset', (-audioOffsetMs / 1000).toFixed(3));
    args.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-map', '0:v:0', '-c:v', 'copy');
  }
  args.push('-movflags', '+faststart', outPath);
  return args;
}

module.exports = { buildRecordArgs, buildMuxArgs, pickEncoder, ENCODER_PRIORITY, even };

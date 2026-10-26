// Builds the FFmpeg command that renders an edit: keep the chosen clips,
// change speed, mix in music. Pure function so it can be tested anywhere.

const { encoderArgs, pickEncoder } = require('./ffmpeg-args');

const SPEED_MIN = 0.25;
const SPEED_MAX = 4;

const num = (n) => Number(n.toFixed(4)).toString();

/** atempo only accepts 0.5–2.0 per stage on older builds, so chain stages. */
function atempoChain(speed) {
  const stages = [];
  let s = speed;
  while (s > 2) { stages.push(2); s /= 2; }
  while (s < 0.5) { stages.push(0.5); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6 || !stages.length) stages.push(s);
  return stages.map((x) => `atempo=${num(x)}`).join(',');
}

function normalizeClips(clips, duration) {
  const list = (clips && clips.length ? clips : [{ start: 0, end: duration }])
    .map((c) => ({ start: Math.max(0, c.start), end: Math.min(duration, c.end) }))
    .filter((c) => c.end - c.start > 0.01);
  if (!list.length) throw new Error('Nothing to export: every clip is empty');
  return list;
}

/**
 * @param {object} o
 * @param {string} o.input
 * @param {object} o.probe       { duration, fps, hasAudio }
 * @param {Array}  o.clips       [{ start, end }] in source seconds, in output order
 * @param {number} o.speed       0.25 – 4
 * @param {number} o.originalVolume 0 – 2 (0 mutes the recording's own audio)
 * @param {object} o.music       { path, volume, startAt, fadeIn, fadeOut, loop } or null
 * @param {string[]} o.encoders  available encoders
 * @param {string} o.quality     low | medium | high | ultra
 * @param {string} o.outPath
 * @returns {{ args: string[], outputDuration: number, encoder: string }}
 */
function buildExportArgs(o) {
  const { input, probe, outPath } = o;
  const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(o.speed) || 1));
  const fps = Math.round(probe.fps || 60);
  const clips = normalizeClips(o.clips, probe.duration);
  const total = clips.reduce((sum, c) => sum + (c.end - c.start), 0) / speed;
  const origVol = o.originalVolume ?? 1;
  const keepOrig = probe.hasAudio && origVol > 0;
  const music = o.music && o.music.path ? o.music : null;
  const encoder = pickEncoder('auto', o.encoders || []);

  const args = ['-hide_banner', '-loglevel', 'warning', '-stats', '-y', '-i', input];
  if (music) {
    if (music.loop) args.push('-stream_loop', '-1');
    args.push('-i', music.path);
  }

  const f = [];
  const vLabels = [];
  const aLabels = [];
  clips.forEach((c, i) => {
    f.push(`[0:v]trim=start=${num(c.start)}:end=${num(c.end)},setpts=PTS-STARTPTS[v${i}]`);
    vLabels.push(`[v${i}]`);
    if (keepOrig) {
      f.push(`[0:a]atrim=start=${num(c.start)}:end=${num(c.end)},asetpts=PTS-STARTPTS[a${i}]`);
      aLabels.push(`[a${i}]`);
    }
  });

  let v;
  let a = null;
  if (clips.length > 1) {
    const pairs = clips.map((_, i) => vLabels[i] + (keepOrig ? aLabels[i] : '')).join('');
    f.push(`${pairs}concat=n=${clips.length}:v=1:a=${keepOrig ? 1 : 0}[vcat]${keepOrig ? '[acat]' : ''}`);
    v = '[vcat]';
    if (keepOrig) a = '[acat]';
  } else {
    v = vLabels[0];
    if (keepOrig) a = aLabels[0];
  }

  const pixFmt = encoder === 'h264_qsv' ? 'nv12' : 'yuv420p';
  const vChain = [];
  if (speed !== 1) vChain.push(`setpts=PTS/${num(speed)}`);
  vChain.push(`fps=${fps}`, `format=${pixFmt}`);
  f.push(`${v}${vChain.join(',')}[vout]`);

  const stereo = 'aformat=sample_rates=48000:channel_layouts=stereo';
  if (a) {
    const aChain = [];
    if (speed !== 1) aChain.push(atempoChain(speed));
    aChain.push(`volume=${num(origVol)}`, stereo);
    f.push(`${a}${aChain.join(',')}[orig]`);
    a = '[orig]';
  }

  if (music) {
    const startAt = Math.max(0, Math.min(total, Number(music.startAt) || 0));
    const len = Math.max(0.1, total - startAt);
    const mChain = [stereo, `volume=${num(music.volume ?? 1)}`, `atrim=0:${num(len)}`, 'asetpts=PTS-STARTPTS'];
    if (music.fadeIn > 0) mChain.push(`afade=t=in:st=0:d=${num(Math.min(music.fadeIn, len))}`);
    if (music.fadeOut > 0) {
      const d = Math.min(music.fadeOut, len);
      mChain.push(`afade=t=out:st=${num(len - d)}:d=${num(d)}`);
    }
    if (startAt > 0) mChain.push(`adelay=delays=${Math.round(startAt * 1000)}:all=1`);
    f.push(`[1:a]${mChain.join(',')}[mus]`);
    if (a) {
      f.push(`${a}[mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
    } else {
      f.push(`[mus]apad=whole_dur=${num(total)},atrim=0:${num(total)}[aout]`);
    }
    a = '[aout]';
  }

  args.push('-filter_complex', f.join(';'), '-map', '[vout]');
  if (a) args.push('-map', a, '-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');

  const enc = encoder === 'libx264'
    ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', String({ low: 28, medium: 23, high: 20, ultra: 17 }[o.quality] ?? 20), '-g', String(fps * 2)]
    : encoderArgs(encoder, o.quality || 'high', fps, false);
  args.push(...enc, '-movflags', '+faststart', '-t', num(total), outPath);
  return { args, outputDuration: total, encoder };
}

module.exports = { buildExportArgs, atempoChain, normalizeClips, SPEED_MIN, SPEED_MAX };

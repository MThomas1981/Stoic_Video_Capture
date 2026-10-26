// Builds the FFmpeg command that renders an edit: keep the chosen clips,
// join them (cut or animated transition), change speed, apply the style
// (look, text, logo, animated border) and mix in music. Pure function so it
// can be tested anywhere.

const { encoderArgs, pickEncoder, even } = require('./ffmpeg-args');
const {
  DEFAULT_EFFECTS, DEFAULT_LOOK, RANDOM_POOL, FONTS, TEXT_SIZES,
} = require('../renderer/flavors');

const SPEED_MIN = 0.25;
const SPEED_MAX = 4;

const num = (n) => Number(Number(n).toFixed(4)).toString();
const hex = (c, fallback = '#ffffff') => `0x${(/^#?[0-9a-f]{6}$/i.test(c || '') ? c : fallback).replace('#', '')}`;

/** Escapes a file path for use inside a quoted filter option. */
function filterPath(p) {
  return `'${String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`;
}

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

/** Transition length actually used: never more than 45% of the shortest clip. */
function transitionLength(clips, transition) {
  if (!transition || transition.type === 'none' || clips.length < 2) return 0;
  const shortest = Math.min(...clips.map((c) => c.end - c.start));
  return Math.max(0.1, Math.min(Number(transition.duration) || 0.6, shortest * 0.45));
}

function lookFilters(look) {
  const l = { ...DEFAULT_LOOK, ...look };
  const f = [];
  if (l.saturation !== 1 || l.contrast !== 1 || l.brightness !== 0) {
    f.push(`eq=saturation=${num(l.saturation)}:contrast=${num(l.contrast)}:brightness=${num(l.brightness)}`);
  }
  if (l.warmth) {
    const w = Math.max(-1, Math.min(1, l.warmth));
    f.push(`colorbalance=rs=${num(w * 0.12)}:bs=${num(-w * 0.12)}:rm=${num(w * 0.08)}:bm=${num(-w * 0.08)}`);
  }
  if (l.sharpen) f.push('unsharp=5:5:0.7:5:5:0');
  if (l.vhs) f.push('rgbashift=rh=-4:bh=4', 'gblur=sigma=0.6');
  if (l.grain > 0) f.push(`noise=alls=${Math.round(Math.min(1, l.grain) * 30)}:allf=t+u`);
  if (l.vignette) f.push('vignette=angle=PI/4.5');
  if (l.letterbox) {
    f.push('drawbox=x=0:y=0:w=iw:h=ih*0.11:color=black:t=fill',
      'drawbox=x=0:y=ih-ih*0.11:w=iw:h=ih*0.11:color=black:t=fill');
  }
  return f;
}

function fontPath(font, fontDir, platform) {
  const def = FONTS[font] || FONTS.bold;
  return `${fontDir.replace(/[\\/]+$/, '')}/${platform === 'win32' ? def.win : def.linux}`;
}

function textFilter(t, { height, fontDir, platform }) {
  const size = Math.round(height * (TEXT_SIZES[t.size] || TEXT_SIZES.m));
  const s = Math.max(0, Number(t.start) || 0);
  const e = Math.max(s + 0.1, Number(t.end) || s + 3);
  const pos = t.position || 'bottom';
  const x = pos.endsWith('left') ? 'w*0.05' : pos.endsWith('right') ? 'w-tw-w*0.05' : '(w-tw)/2';
  let y = pos.startsWith('top') ? 'h*0.08' : pos === 'center' ? '(h-th)/2' : 'h-th-h*0.09';
  const ramp = Math.min(0.4, (e - s) / 3);
  let alpha = '1';
  if (t.animation === 'fade' || t.animation === 'slide' || t.animation === 'drop') {
    alpha = `if(lt(t,${num(s + ramp)}),(t-${num(s)})/${num(ramp)},if(gt(t,${num(e - ramp)}),(${num(e)}-t)/${num(ramp)},1))`;
  }
  if (t.animation === 'slide') y = `${y}+h*0.06*max(0,1-(t-${num(s)})/0.5)`;
  if (t.animation === 'drop') y = `${y}-h*0.12*max(0,1-(t-${num(s)})/0.45)`;
  const opts = [
    `fontfile=${filterPath(fontPath(t.font, fontDir, platform))}`,
    `textfile=${filterPath(t.textFile)}`,
    'expansion=none', // show % and other characters literally
    `fontsize=${size}`,
    `fontcolor=${hex(t.color)}`,
    `x='${x}'`,
    `y='${y}'`,
    `alpha='${alpha}'`,
    `enable='between(t,${num(s)},${num(e)})'`,
  ];
  if (t.box) opts.push('box=1', 'boxcolor=black@0.55', `boxborderw=${Math.round(size * 0.35)}`);
  else opts.push(`borderw=${Math.max(1, Math.round(size * 0.06))}`, 'bordercolor=black@0.85');
  return `drawtext=${opts.join(':')}`;
}

function borderSource(border, w, h, fps) {
  const size = `s=${w}x${h}:r=${fps}`;
  switch (border.style) {
    case 'rainbow': return `color=c=0xff3355:${size},format=yuv420p,hue=h=t*90`;
    case 'pulse': return `color=c=${hex(border.color, '#ef4444')}:${size},format=yuv420p,hue=b='2.2*sin(2*PI*t*1.2)-0.8'`;
    case 'gradient':
      return `gradients=${size}:c0=${hex(border.color, '#a78bfa')}:c1=${hex(border.color2, '#60a5fa')}:nb_colors=2:speed=0.02,format=yuv420p`;
    default: return `color=c=${hex(border.color, '#4ade80')}:${size},format=yuv420p`;
  }
}

/**
 * @param {object} o
 * @param {string} o.input
 * @param {object} o.probe       { duration, fps, hasAudio, width, height }
 * @param {Array}  o.clips       [{ start, end }] in source seconds, in output order
 * @param {number} o.speed       0.25 – 4
 * @param {number} o.originalVolume 0 – 2 (0 mutes the recording's own audio)
 * @param {object} o.music       { path, volume, startAt, fadeIn, fadeOut, loop } or null
 * @param {object} o.effects     see Flavors.DEFAULT_EFFECTS; texts need a prepared textFile
 * @param {string} o.fontDir     folder holding the TTF fonts
 * @param {string} o.platform    process.platform (picks font file names)
 * @param {string[]} o.encoders  available encoders
 * @param {string} o.quality     low | medium | high | ultra
 * @param {string} o.outPath
 * @returns {{ args: string[], outputDuration: number, encoder: string }}
 */
function buildExportArgs(o) {
  const { input, probe, outPath } = o;
  const fx = { ...DEFAULT_EFFECTS, ...(o.effects || {}) };
  const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(o.speed) || 1));
  const fps = Math.round(probe.fps || 60);
  const W = even(probe.width || 1920);
  const H = even(probe.height || 1080);
  const clips = normalizeClips(o.clips, probe.duration);
  const xd = transitionLength(clips, fx.transition);
  const joined = clips.reduce((sum, c) => sum + (c.end - c.start), 0) - xd * (clips.length - 1);
  const total = joined / speed;
  const origVol = o.originalVolume ?? 1;
  const keepOrig = probe.hasAudio && origVol > 0;
  const music = o.music && o.music.path ? o.music : null;
  const logo = fx.logo && fx.logo.path ? fx.logo : null;
  const encoder = pickEncoder('auto', o.encoders || []);

  const args = ['-hide_banner', '-loglevel', 'warning', '-stats', '-y', '-i', input];
  let nextInput = 1;
  let musicIdx = null;
  let logoIdx = null;
  if (music) {
    if (music.loop) args.push('-stream_loop', '-1');
    args.push('-i', music.path);
    musicIdx = nextInput++;
  }
  if (logo) {
    args.push('-loop', '1', '-i', logo.path);
    logoIdx = nextInput++;
  }

  const f = [];
  const prep = `fps=${fps},format=yuv420p,settb=AVTB`;
  clips.forEach((c, i) => {
    f.push(`[0:v]trim=start=${num(c.start)}:end=${num(c.end)},setpts=PTS-STARTPTS${xd ? `,${prep}` : ''}[v${i}]`);
    if (keepOrig) f.push(`[0:a]atrim=start=${num(c.start)}:end=${num(c.end)},asetpts=PTS-STARTPTS[a${i}]`);
  });

  let v = '[v0]';
  let a = keepOrig ? '[a0]' : null;
  if (clips.length > 1 && xd) {
    // Animated transitions: chain xfade (video) and acrossfade (audio).
    let len = clips[0].end - clips[0].start;
    for (let i = 1; i < clips.length; i += 1) {
      let type = fx.transition.type;
      if (type === 'random') type = RANDOM_POOL[(i - 1) % RANDOM_POOL.length];
      const out = i === clips.length - 1 ? '[vj]' : `[vx${i}]`;
      f.push(`${v}[v${i}]xfade=transition=${type}:duration=${num(xd)}:offset=${num(len - xd)}${out}`);
      v = out;
      if (keepOrig) {
        const aout = i === clips.length - 1 ? '[aj]' : `[ax${i}]`;
        f.push(`${a}[a${i}]acrossfade=d=${num(xd)}:c1=tri:c2=tri${aout}`);
        a = aout;
      }
      len += (clips[i].end - clips[i].start) - xd;
    }
  } else if (clips.length > 1) {
    const pairs = clips.map((_, i) => `[v${i}]${keepOrig ? `[a${i}]` : ''}`).join('');
    f.push(`${pairs}concat=n=${clips.length}:v=1:a=${keepOrig ? 1 : 0}[vj]${keepOrig ? '[aj]' : ''}`);
    v = '[vj]';
    if (keepOrig) a = '[aj]';
  }

  // Speed, frame rate, look, fades and text all work in final-video time.
  const vChain = [];
  if (speed !== 1) vChain.push(`setpts=PTS/${num(speed)}`);
  vChain.push(`fps=${fps}`, 'format=yuv420p', ...lookFilters(fx.look));
  if (fx.transition?.fadeEnds) {
    const d = Math.min(0.6, total / 4);
    vChain.push(`fade=t=in:st=0:d=${num(d)}`, `fade=t=out:st=${num(total - d)}:d=${num(d)}`);
  }
  for (const t of fx.texts || []) {
    if (t.textFile && String(t.text || '').trim()) {
      vChain.push(textFilter(t, { height: H, fontDir: o.fontDir || 'C:/Windows/Fonts', platform: o.platform || 'win32' }));
    }
  }
  f.push(`${v}${vChain.join(',')}[vs]`);
  v = '[vs]';

  if (logo) {
    const scale = Math.max(0.03, Math.min(0.6, (Number(logo.scale) || 15) / 100));
    const opacity = Math.max(0.05, Math.min(1, Number(logo.opacity ?? 1)));
    const pos = logo.position || 'top-right';
    const lx = pos.endsWith('left') ? 'W*0.03' : pos.endsWith('right') ? 'W-w-W*0.03' : '(W-w)/2';
    const ly = pos.startsWith('top') ? 'H*0.04' : pos === 'center' ? '(H-h)/2' : 'H-h-H*0.05';
    f.push(`[${logoIdx}:v]scale=${even(W * scale)}:-2,format=rgba,colorchannelmixer=aa=${num(opacity)}[lg]`);
    f.push(`${v}[lg]overlay=x='${lx}':y='${ly}':shortest=1:format=auto[vl]`);
    v = '[vl]';
  }

  if (fx.border && fx.border.style !== 'none') {
    const b = even(H * Math.max(0.5, Math.min(10, Number(fx.border.size) || 3)) / 100);
    f.push(`${borderSource(fx.border, W, H, fps)}[bg]`);
    f.push(`${v}scale=${W - 2 * b}:${H - 2 * b}:force_original_aspect_ratio=decrease,setsar=1[inner]`);
    f.push(`[bg][inner]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1[vb]`);
    v = '[vb]';
  }

  const pixFmt = encoder === 'h264_qsv' ? 'nv12' : 'yuv420p';
  f.push(`${v}format=${pixFmt}[vout]`);

  const stereo = 'aformat=sample_rates=48000:channel_layouts=stereo';
  if (a) {
    const aChain = [];
    if (speed !== 1) aChain.push(atempoChain(speed));
    aChain.push(`volume=${num(origVol)}`, stereo);
    if (fx.transition?.fadeEnds) {
      const d = Math.min(0.6, total / 4);
      aChain.push(`afade=t=in:st=0:d=${num(d)}`, `afade=t=out:st=${num(total - d)}:d=${num(d)}`);
    }
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
    f.push(`[${musicIdx}:a]${mChain.join(',')}[mus]`);
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

module.exports = {
  buildExportArgs, atempoChain, normalizeClips, transitionLength, lookFilters, filterPath, SPEED_MIN, SPEED_MAX,
};

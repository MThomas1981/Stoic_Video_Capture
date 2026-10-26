const test = require('node:test');
const assert = require('node:assert');
const { resolveOutput, describe, MiB } = require('../src/main/output-profiles');
const { buildExportArgs } = require('../src/main/edit-args');

const src = { width: 2560, height: 1440, fps: 60 };
const caps = { encoders: ['h264_nvenc', 'libx264'], hevcEncoders: ['libx265'] };
const after = (args, flag) => args[args.indexOf(flag) + 1];

test('YouTube keeps resolution and uses recommended bitrate', () => {
  const o = resolveOutput({ target: { kind: 'platform', id: 'youtube' }, source: src, duration: 60, caps });
  assert.equal(o.height, null);
  assert.equal(o.mode.kbps, 24000);
  assert.equal(o.encoder, 'h264_nvenc');
});

test('Steam caps at 1080p', () => {
  const o = resolveOutput({ target: { kind: 'platform', id: 'steam' }, source: src, duration: 60, caps });
  assert.equal(o.height, 1080);
  assert.equal(o.mode.kbps, 10000);
});

test('Discord 10 MB budgets bitrate and downsizes long clips', () => {
  const short = resolveOutput({ target: { kind: 'platform', id: 'discord10' }, source: src, duration: 20, caps });
  assert.equal(short.targetBytes, 10 * MiB);
  assert.ok(short.mode.kbps > 3500 && short.mode.kbps < 4000, String(short.mode.kbps));
  const long = resolveOutput({ target: { kind: 'platform', id: 'discord10' }, source: src, duration: 90, caps });
  assert.equal(long.height, 480);
  assert.equal(long.fps, 30);
  assert.throws(() => resolveOutput({ target: { kind: 'platform', id: 'discord10' }, source: src, duration: 1200, caps }), /too long/);
});

test('custom size needs a number', () => {
  assert.throws(() => resolveOutput({ target: { kind: 'platform', id: 'custom' }, source: src, duration: 10, caps }), /MB/);
  const o = resolveOutput({ target: { kind: 'platform', id: 'custom', sizeMB: 25 }, source: src, duration: 10, caps });
  assert.equal(o.targetBytes, 25 * MiB);
});

test('formats pick the right codecs', () => {
  const pick = (id) => resolveOutput({ target: { kind: 'format', id, quality: 'high' }, source: src, duration: 10, caps });
  assert.equal(pick('mp4hevc').encoder, 'libx265');
  assert.equal(pick('webm').encoder, 'libvpx-vp9');
  assert.equal(pick('prores').ext, 'mov');
  assert.equal(pick('gif').height, 360);
  assert.equal(pick('gif').fps, 15);
  assert.equal(pick('mp3').encoder, null);
});

test('vertical preset builds blurred fill layout', () => {
  const { args, ext, description } = buildExportArgs({
    input: 'in.mp4', probe: { duration: 30, fps: 60, hasAudio: true, width: 1920, height: 1080 },
    clips: [], speed: 1, encoders: ['libx264'], outPath: 'o.mp4', target: { kind: 'platform', id: 'vertical' },
  });
  assert.equal(ext, 'mp4');
  assert.match(after(args, '-filter_complex'), /crop=1080:1920,boxblur/);
  assert.match(description, /1080×1920 vertical/);
});

test('gif uses a palette and drops audio; mp3 drops video', () => {
  const base = { input: 'in.mp4', probe: { duration: 8, fps: 60, hasAudio: true, width: 1280, height: 720 }, clips: [], speed: 1, encoders: [], outPath: 'o' };
  const gif = buildExportArgs({ ...base, target: { kind: 'format', id: 'gif' } });
  assert.match(after(gif.args, '-filter_complex'), /palettegen.*paletteuse/);
  assert.ok(gif.args.includes('-an'));
  const mp3 = buildExportArgs({ ...base, target: { kind: 'format', id: 'mp3' } });
  assert.ok(mp3.args.includes('-vn'));
  assert.match(after(mp3.args, '-filter_complex'), /nullsink/);
  assert.equal(after(mp3.args, '-c:a'), 'libmp3lame');
  assert.throws(() => buildExportArgs({ ...base, probe: { ...base.probe, hasAudio: false }, target: { kind: 'format', id: 'mp3' } }), /no sound/);
});

test('describe reads naturally', () => {
  const o = resolveOutput({ target: { kind: 'platform', id: 'discord10' }, source: src, duration: 20, caps });
  assert.match(describe(o, src), /^1080p · 30 fps · H\.264 · ~\d\.\d Mbps · under 10 MB · \.mp4$/);
});

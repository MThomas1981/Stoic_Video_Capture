const test = require('node:test');
const assert = require('node:assert');
const { buildRecordArgs, buildMuxArgs, pickEncoder } = require('../src/main/ffmpeg-args');
const { parseDshowDevices } = require('../src/main/ffmpeg');
const { DEFAULT_SETTINGS, MODES } = require('../src/main/presets');

const display = { index: 1, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 };
const allEncoders = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'];
const settings = (over) => ({ ...DEFAULT_SETTINGS, ...over });
const after = (args, flag) => args[args.indexOf(flag) + 1];

test('auto encoder prefers GPU, falls back to CPU', () => {
  assert.equal(pickEncoder('auto', allEncoders), 'h264_nvenc');
  assert.equal(pickEncoder('auto', ['h264_qsv', 'libx264']), 'h264_qsv');
  assert.equal(pickEncoder('auto', []), 'libx264');
  assert.equal(pickEncoder('h264_amf', ['libx264']), 'libx264');
});

test('gaming mode on NVIDIA uses ddagrab zero-copy', () => {
  const { args, encoder, captureMethod } = buildRecordArgs({
    settings: settings(MODES.gaming.settings),
    caps: { ddagrab: true, encoders: allEncoders },
    display, outPath: 'out.mkv',
  });
  assert.equal(encoder, 'h264_nvenc');
  assert.equal(captureMethod, 'ddagrab');
  assert.equal(after(args, '-i'), 'ddagrab=output_idx=1:framerate=60:draw_mouse=0');
  assert.ok(!args.includes('-vf'), 'no CPU download needed');
  assert.equal(after(args, '-cq'), '21');
  assert.equal(args.at(-1), 'out.mkv');
});

test('region + scaling on ddagrab downloads frames and scales', () => {
  const { args } = buildRecordArgs({
    settings: settings({ source: 'region', region: { x: 101, y: 50, width: 801, height: 451 }, resolution: '720p', encoder: 'h264_qsv' }),
    caps: { ddagrab: true, encoders: allEncoders },
    display, outPath: 'o.mkv',
  });
  assert.match(after(args, '-i'), /offset_x=101:offset_y=50:video_size=800x450$/);
  assert.equal(after(args, '-vf'), 'hwdownload,format=bgra,scale=-2:720:flags=bicubic,format=nv12');
});

test('gdigrab fallback offsets by display position on the virtual desktop', () => {
  const { args, captureMethod, encoder } = buildRecordArgs({
    settings: settings({ source: 'region', region: { x: 10, y: 20, width: 300, height: 200 }, cursor: true }),
    caps: { ddagrab: false, encoders: ['libx264'] },
    display, virtualOrigin: { x: 0, y: 0 }, outPath: 'o.mkv',
  });
  assert.equal(captureMethod, 'gdigrab');
  assert.equal(encoder, 'libx264');
  assert.equal(after(args, '-offset_x'), String(1920 * 1.5 + 10));
  assert.equal(after(args, '-offset_y'), '20');
  assert.equal(after(args, '-video_size'), '300x200');
  assert.equal(after(args, '-draw_mouse'), '1');
  assert.equal(after(args, '-pix_fmt'), 'yuv420p');
});

test('camera uses dshow and requires a device', () => {
  assert.throws(() => buildRecordArgs({ settings: settings({ source: 'camera' }), caps: { encoders: [] }, outPath: 'o' }));
  const { args } = buildRecordArgs({
    settings: settings({ source: 'camera', cameraDevice: 'Elgato HD60 X', fps: 30 }),
    caps: { ddagrab: true, encoders: ['libx264'] }, outPath: 'o.mkv',
  });
  assert.equal(after(args, '-f'), 'dshow');
  assert.equal(after(args, '-i'), 'video=Elgato HD60 X');
  assert.equal(after(args, '-preset'), 'veryfast');
});

test('mux trims audio that started before video', () => {
  const args = buildMuxArgs({ videoPath: 'v.mkv', audioPath: 'a.webm', outPath: 'o.mp4', audioOffsetMs: 250 });
  assert.equal(after(args, '-ss'), '0.250');
  assert.ok(args.indexOf('-ss') < args.indexOf('a.webm'));
  assert.equal(after(args, '-c:v'), 'copy');
  const late = buildMuxArgs({ videoPath: 'v.mkv', audioPath: 'a.webm', outPath: 'o.mp4', audioOffsetMs: -100 });
  assert.equal(after(late, '-itsoffset'), '0.100');
  const silent = buildMuxArgs({ videoPath: 'v.mkv', audioPath: null, outPath: 'o.mp4' });
  assert.ok(!silent.includes('-c:a'));
});

test('parses both dshow device list formats', () => {
  const modern = `[dshow @ 0] "HD Pro Webcam C920" (video)
[dshow @ 0]   Alternative name "@device_pnp_\\\\?\\usb#vid"
[dshow @ 0] "Microphone (Realtek Audio)" (audio)`;
  assert.deepEqual(parseDshowDevices(modern), { video: ['HD Pro Webcam C920'], audio: ['Microphone (Realtek Audio)'] });
  const legacy = `[dshow @ 0] DirectShow video devices
[dshow @ 0]  "Cam Link 4K"
[dshow @ 0] DirectShow audio devices
[dshow @ 0]  "Line In"`;
  assert.deepEqual(parseDshowDevices(legacy), { video: ['Cam Link 4K'], audio: ['Line In'] });
});

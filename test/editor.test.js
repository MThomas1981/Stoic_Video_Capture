const test = require('node:test');
const assert = require('node:assert');
const TM = require('../src/renderer/timeline-math');
const { buildExportArgs, atempoChain } = require('../src/main/edit-args');

const after = (args, flag) => args[args.indexOf(flag) + 1];

test('frame stepping lands inside the intended frame', () => {
  for (const fps of [30, 60, 59.94, 120]) {
    for (const f of [0, 1, 59, 1234]) assert.equal(TM.frameAt(TM.timeOfFrame(f, fps), fps), f);
  }
});

test('timecode and parsing round-trip', () => {
  assert.equal(TM.timecode(TM.timeOfFrame(3, 60), 60), '0:00:00:03');
  assert.equal(TM.timecode(3723.5, 60), '1:02:03:30');
  assert.equal(TM.frameAt(TM.parseTime('0:00:06:30', 60), 60), 390);
  assert.equal(TM.frameAt(TM.parseTime('f540', 60), 60), 540);
  assert.equal(TM.parseTime('2:30', 60), 150);
  assert.equal(TM.parseTime('1:00:00', 60), 3600);
  assert.equal(TM.parseTime('12.5', 60), 12.5);
  assert.equal(TM.parseTime('abc', 60), null);
});

test('source/output mapping follows clips and speed', () => {
  const clips = [{ start: 10, end: 20 }, { start: 40, end: 50 }];
  assert.equal(TM.sourceToOutput(15, clips, 1, 60), 5);
  assert.equal(TM.sourceToOutput(45, clips, 2, 60), 7.5);
  assert.equal(TM.sourceToOutput(30, clips, 1, 60), null);
  assert.equal(TM.outputToSource(12, clips, 1, 60), 42);
  assert.equal(TM.outputDuration(clips, 2, 60), 10);
  assert.equal(TM.outputDuration([], 1, 60), 60);
});

test('YouTube chapters start at 0:00 and use output time', () => {
  const text = TM.chaptersText([{ time: 45, label: 'Boss' }, { time: 12, label: 'Spawn' }, { time: 30, label: 'Cut' }],
    [{ start: 10, end: 20 }, { start: 40, end: 50 }], 1, 60);
  assert.equal(text, '0:00 Start\n0:02 Spawn\n0:15 Boss');
});

test('atempo chains stay within 0.5–2 per stage', () => {
  assert.equal(atempoChain(4), 'atempo=2,atempo=2');
  assert.equal(atempoChain(0.25), 'atempo=0.5,atempo=0.5');
  assert.equal(atempoChain(1.5), 'atempo=1.5');
  assert.equal(atempoChain(3), 'atempo=2,atempo=1.5');
});

test('export joins clips, applies speed and mixes music', () => {
  const { args, outputDuration } = buildExportArgs({
    input: 'in.mp4', probe: { duration: 60, fps: 60, hasAudio: true },
    clips: [{ start: 1, end: 3 }, { start: 6, end: 9 }], speed: 2, originalVolume: 0.5,
    music: { path: 'song.mp3', volume: 0.8, startAt: 1, fadeIn: 1, fadeOut: 1, loop: true },
    encoders: ['h264_nvenc', 'libx264'], quality: 'high', outPath: 'out.mp4',
  });
  assert.equal(outputDuration, 2.5);
  const fc = after(args, '-filter_complex');
  assert.match(fc, /concat=n=2:v=1:a=1\[vcat\]\[acat\]/);
  assert.match(fc, /setpts=PTS\/2,fps=60/);
  assert.match(fc, /atempo=2,volume=0.5/);
  assert.match(fc, /adelay=delays=1000:all=1/);
  assert.match(fc, /amix=inputs=2/);
  assert.ok(args.indexOf('-stream_loop') < args.indexOf('song.mp3'));
  assert.equal(after(args, '-c:v'), 'h264_nvenc');
  assert.equal(after(args, '-t'), '2.5');
});

test('muted recording without music exports video only', () => {
  const { args } = buildExportArgs({
    input: 'in.mp4', probe: { duration: 10, fps: 30, hasAudio: true }, clips: [], speed: 1,
    originalVolume: 0, music: null, encoders: [], outPath: 'o.mp4',
  });
  assert.ok(args.includes('-an'));
  assert.equal(after(args, '-c:v'), 'libx264');
});

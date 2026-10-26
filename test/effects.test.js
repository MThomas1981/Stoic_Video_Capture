const test = require('node:test');
const assert = require('node:assert');
const { buildExportArgs, transitionLength, filterPath, lookFilters } = require('../src/main/edit-args');
const Flavors = require('../src/renderer/flavors');
const TM = require('../src/renderer/timeline-math');

const after = (args, flag) => args[args.indexOf(flag) + 1];
const base = {
  input: 'in.mp4', probe: { duration: 30, fps: 60, hasAudio: true, width: 1920, height: 1080 },
  speed: 1, encoders: ['libx264'], outPath: 'o.mp4', fontDir: 'C:\\Windows\\Fonts', platform: 'win32',
};

test('windows paths are escaped for filter options', () => {
  assert.equal(filterPath('C:\\Users\\Matt\\AppData\\Local\\Temp\\t1.txt'), "'C\\:/Users/Matt/AppData/Local/Temp/t1.txt'");
});

test('transitions use xfade with correct offsets and shorten the video', () => {
  const clips = [{ start: 0, end: 4 }, { start: 10, end: 13 }, { start: 20, end: 25 }];
  const effects = Flavors.applyFlavor(Flavors.DEFAULT_EFFECTS, 'clean');
  effects.transition = { type: 'wipeleft', duration: 1, fadeEnds: false };
  const { args, outputDuration } = buildExportArgs({ ...base, clips, effects });
  const fc = after(args, '-filter_complex');
  assert.match(fc, /\[v0\]\[v1\]xfade=transition=wipeleft:duration=1:offset=3\[vx1\]/);
  assert.match(fc, /\[vx1\]\[v2\]xfade=transition=wipeleft:duration=1:offset=5\[vj\]/);
  assert.match(fc, /acrossfade=d=1/);
  assert.equal(outputDuration, 10);
  assert.equal(TM.outputDuration(clips, 1, 30, TM.transitionLength(clips, effects.transition)), 10);
  assert.equal(TM.sourceToOutput(11, clips, 1, 30, 1), 4);
});

test('transition length is capped by the shortest clip', () => {
  assert.equal(transitionLength([{ start: 0, end: 1 }, { start: 5, end: 10 }], { type: 'fade', duration: 2 }), 0.45);
  assert.equal(transitionLength([{ start: 0, end: 5 }], { type: 'fade', duration: 2 }), 0);
});

test('random transitions rotate through the pool', () => {
  const clips = [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }];
  const effects = { ...Flavors.DEFAULT_EFFECTS, transition: { type: 'random', duration: 0.5 } };
  const fc = after(buildExportArgs({ ...base, clips, effects }).args, '-filter_complex');
  assert.match(fc, new RegExp(`transition=${Flavors.RANDOM_POOL[0]}:`));
  assert.match(fc, new RegExp(`transition=${Flavors.RANDOM_POOL[1]}:`));
});

test('every flavor builds a valid-looking graph', () => {
  for (const key of Object.keys(Flavors.FLAVORS)) {
    const effects = Flavors.applyFlavor({
      ...Flavors.DEFAULT_EFFECTS,
      texts: [{ text: 'GG', textFile: 'C:\\tmp\\t0.txt', start: 1, end: 4, position: 'bottom', size: 'l' }],
    }, key);
    const fc = after(buildExportArgs({ ...base, clips: [{ start: 0, end: 5 }, { start: 8, end: 12 }], effects }).args, '-filter_complex');
    assert.match(fc, /drawtext=fontfile='C\\:\/Windows\/Fonts\/[a-z]+\.ttf':textfile='C\\:\/tmp\/t0.txt'/, key);
    if (Flavors.FLAVORS[key].border.style !== 'none') assert.match(fc, /\[bg\]\[inner\]overlay/, key);
    assert.ok(!/undefined|NaN/.test(fc), `${key}: ${fc}`);
  }
});

test('look filters only include what is switched on', () => {
  assert.deepEqual(lookFilters(Flavors.DEFAULT_LOOK), []);
  const f = lookFilters({ ...Flavors.DEFAULT_LOOK, letterbox: true, vignette: true });
  assert.equal(f.length, 3);
});

test('logo overlay is added as a looped image input', () => {
  const effects = { ...Flavors.DEFAULT_EFFECTS, logo: { path: 'logo.png', position: 'top-right', scale: 12, opacity: 0.8 } };
  const { args } = buildExportArgs({ ...base, clips: [], effects });
  assert.equal(args[args.indexOf('logo.png') - 3], '-loop');
  assert.match(after(args, '-filter_complex'), /\[1:v\]scale=230:-2,format=rgba,colorchannelmixer=aa=0.8\[lg\]/);
});

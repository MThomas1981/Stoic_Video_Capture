// Runs real FFmpeg exports. Skipped when FFmpeg isn't installed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../src/main/ffmpeg');
const media = require('../src/main/media');

test('export pipeline produces the expected length', async (t) => {
  const probeFf = await run(['-version']);
  if (probeFf.code !== 0) { t.skip('FFmpeg not available'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoic-it-'));
  const src = path.join(dir, 'src.mp4');
  const song = path.join(dir, 'song.m4a');
  await run(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=60', '-f', 'lavfi', '-i', 'sine=f=300:sample_rate=48000',
    '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
  await run(['-y', '-f', 'lavfi', '-i', 'sine=f=800:d=2', '-c:a', 'aac', song]);

  const info = await media.probe(src);
  assert.equal(Math.round(info.fps), 60);
  assert.ok(info.hasAudio);

  const thumbs = await media.thumbnails(src, info.duration, 4, 40);
  assert.equal(thumbs.filter((x) => x.src).length, 4);

  const out = path.join(dir, 'out.mp4');
  const res = await media.exportEdit({
    input: src, probe: info, clips: [{ start: 0.5, end: 2 }, { start: 3, end: 5 }], speed: 1.5,
    originalVolume: 0.7, music: { path: song, volume: 0.6, startAt: 0.5, fadeIn: 0.5, fadeOut: 0.5, loop: true },
    encoders: ['libx264'], quality: 'medium', outPath: out,
  });
  assert.equal(res.path, out);
  const outInfo = await media.probe(out);
  assert.ok(Math.abs(outInfo.duration - 3.5 / 1.5) < 0.1, `duration ${outInfo.duration}`);
  assert.ok(outInfo.hasAudio);

  // Every flavor, with captions (tricky characters) and a logo, through real FFmpeg.
  const Flavors = require('../src/renderer/flavors');
  const logo = path.join(dir, 'logo.png');
  await run(['-y', '-f', 'lavfi', '-i', 'color=c=0x4ade80:s=200x80', '-frames:v', '1', logo]);
  for (const key of Object.keys(Flavors.FLAVORS)) {
    const effects = Flavors.applyFlavor({
      ...Flavors.DEFAULT_EFFECTS,
      texts: [{ text: "It's 100%: GG, wp!", start: 0.2, end: 2, position: 'bottom', size: 'l' }],
      logo: { path: logo, position: 'top-right', scale: 15, opacity: 0.8 },
    }, key);
    const fxOut = path.join(dir, `fx-${key}.mp4`);
    await media.exportEdit({
      input: src, probe: info, clips: [{ start: 0, end: 2 }, { start: 3, end: 5 }], speed: 1,
      originalVolume: 1, music: null, effects, encoders: ['libx264'], quality: 'low', outPath: fxOut,
    });
    const fxInfo = await media.probe(fxOut);
    const xd = require('../src/main/edit-args').transitionLength([{ start: 0, end: 2 }, { start: 3, end: 5 }], effects.transition);
    assert.ok(Math.abs(fxInfo.duration - (4 - xd)) < 0.1, `${key} duration ${fxInfo.duration}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

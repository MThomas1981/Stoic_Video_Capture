// Every export target through real FFmpeg. Skipped when FFmpeg isn't installed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../src/main/ffmpeg');
const media = require('../src/main/media');
const { FORMATS, PLATFORMS, MiB } = require('../src/main/output-profiles');

test('every format and platform exports a playable file', async (t) => {
  if ((await run(['-version'])).code !== 0) { t.skip('FFmpeg not available'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoic-targets-'));
  const src = path.join(dir, 'src.mp4');
  await run(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=60', '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000',
    '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
  const info = await media.probe(src);
  const caps = await require('../src/main/ffmpeg').probeCapabilities();

  const targets = [
    ...Object.keys(FORMATS).map((id) => ({ kind: 'format', id, quality: 'medium' })),
    ...Object.keys(PLATFORMS).map((id) => ({ kind: 'platform', id, sizeMB: 2 })),
  ];
  for (const target of targets) {
    const plan = media.planExport({ input: src, probe: info, clips: [], speed: 1, target, encoders: caps.encoders, hevcEncoders: caps.hevcEncoders });
    const out = path.join(dir, `${target.kind}-${target.id}.${plan.ext}`);
    const res = await media.exportEdit({
      input: src, probe: info, clips: [], speed: 1, originalVolume: 1, music: null, target,
      encoders: caps.encoders.filter((e) => e === 'libx264'), hevcEncoders: caps.hevcEncoders.filter((e) => e === 'libx265'), outPath: out,
    });
    assert.ok(fs.statSync(res.path).size > 0, target.id);
    if (target.id !== 'mp3' && target.id !== 'wav') {
      const o = await media.probe(res.path);
      if (target.id === 'vertical') assert.deepEqual([o.width, o.height], [1080, 1920]);
      if (target.id === 'gif') assert.equal(o.height, 360);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('size-limited export stays under the limit', async (t) => {
  if ((await run(['-version'])).code !== 0) { t.skip('FFmpeg not available'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoic-size-'));
  const src = path.join(dir, 'busy.mp4');
  // Noisy, high-detail footage is the hardest case for a size cap.
  await run(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=60,noise=alls=40:allf=t', '-f', 'lavfi', '-i', 'anoisesrc=d=20',
    '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src], { timeoutMs: 300000 });
  const info = await media.probe(src);
  const out = path.join(dir, 'discord.mp4');
  const res = await media.exportEdit({
    input: src, probe: info, clips: [], speed: 1, originalVolume: 1, music: null,
    target: { kind: 'platform', id: 'custom', sizeMB: 4 }, encoders: ['libx264'], outPath: out,
  });
  assert.ok(res.size <= 4 * MiB, `size ${res.size}`);
  assert.ok(res.size > 2 * MiB, `wasted budget: ${res.size}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

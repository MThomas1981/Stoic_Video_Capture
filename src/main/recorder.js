// One recording session: FFmpeg captures video to a temp file while the
// renderer streams audio chunks to us. On stop the two are muxed into an MP4.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpegPath, run } = require('./ffmpeg');
const { buildRecordArgs, buildMuxArgs } = require('./ffmpeg-args');

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

class Recorder {
  constructor() {
    this.session = null;
  }

  get active() {
    return !!this.session;
  }

  async start({ settings, caps, display, virtualOrigin, outputDir, audioStartedAt, onStats }) {
    if (this.session) throw new Error('Already recording');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stoic-capture-'));
    const videoPath = path.join(tmpDir, 'video.mkv');
    const audioPath = audioStartedAt ? path.join(tmpDir, 'audio.webm') : null;
    const { args, encoder, captureMethod } = buildRecordArgs({
      settings, caps, display, virtualOrigin, outPath: videoPath,
    });

    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    const s = {
      proc, tmpDir, videoPath, audioPath, audioStartedAt, settings, outputDir,
      encoder, captureMethod, videoStartedAt: null, log: '', startedAt: Date.now(),
      audioStream: audioPath ? fs.createWriteStream(audioPath) : null,
    };
    s.exited = new Promise((resolve) => proc.on('close', resolve));
    proc.on('error', (e) => { s.log += String(e); });
    proc.stderr.on('data', (d) => {
      const text = String(d);
      s.log = (s.log + text).slice(-8000);
      const m = text.match(/frame=\s*(\d+)/);
      if (m) {
        const frames = Number(m[1]);
        // First progress line tells us when frame 0 was really captured.
        if (s.videoStartedAt === null && frames > 0) {
          s.videoStartedAt = Date.now() - (frames / Number(settings.fps || 60)) * 1000;
        }
        onStats?.({ frames, elapsedMs: Date.now() - s.startedAt });
      }
    });
    this.session = s;

    // If FFmpeg dies in the first second, surface its error instead of "recording".
    const early = await Promise.race([
      s.exited.then((code) => ({ code })),
      new Promise((r) => setTimeout(() => r(null), 1200)),
    ]);
    if (early) {
      this.session = null;
      s.audioStream?.end();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw new Error(`Capture failed to start (${captureMethod}, ${encoder}):\n${s.log.trim()}`);
    }
    return { encoder, captureMethod };
  }

  appendAudio(chunk) {
    this.session?.audioStream?.write(Buffer.from(chunk));
  }

  async stop() {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    try { s.proc.stdin.write('q'); } catch { /* already gone */ }
    const killer = setTimeout(() => s.proc.kill(), 8000);
    await s.exited;
    clearTimeout(killer);
    if (s.audioStream) await new Promise((r) => s.audioStream.end(r));

    if (!fs.existsSync(s.videoPath) || fs.statSync(s.videoPath).size === 0) {
      fs.rmSync(s.tmpDir, { recursive: true, force: true });
      throw new Error(`Recording produced no video:\n${s.log.trim()}`);
    }

    fs.mkdirSync(s.outputDir, { recursive: true });
    const outPath = path.join(s.outputDir, `${timestampName()}.mp4`);
    const hasAudio = s.audioPath && fs.existsSync(s.audioPath) && fs.statSync(s.audioPath).size > 0;
    let offset = Number(s.settings.audioOffsetMs) || 0;
    if (hasAudio && s.videoStartedAt) offset += Math.round(s.videoStartedAt - s.audioStartedAt);

    const res = await run(buildMuxArgs({
      videoPath: s.videoPath, audioPath: hasAudio ? s.audioPath : null, outPath, audioOffsetMs: offset,
    }), { timeoutMs: 10 * 60 * 1000 });
    if (res.code !== 0) {
      // Keep the raw capture so nothing is lost.
      const rescue = path.join(s.outputDir, `${timestampName()} (raw).mkv`);
      fs.copyFileSync(s.videoPath, rescue);
      fs.rmSync(s.tmpDir, { recursive: true, force: true });
      throw new Error(`Saving failed, raw video kept at ${rescue}:\n${res.err.trim()}`);
    }
    fs.rmSync(s.tmpDir, { recursive: true, force: true });
    return { path: outPath, encoder: s.encoder, captureMethod: s.captureMethod };
  }
}

module.exports = { Recorder, timestampName };

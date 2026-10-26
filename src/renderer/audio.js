// Records game/system audio (Windows loopback) and the microphone, mixes them
// with separate volumes, and streams Opus/WebM chunks to the main process.

class AudioCapture {
  constructor() {
    this.ctx = null;
    this.streams = [];
    this.recorder = null;
    this.warnings = [];
  }

  static async listMics() {
    try {
      // Labels are only filled in after mic permission has been granted once.
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
    } catch { /* no mic or denied */ }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Microphone' }));
  }

  /** @returns {Promise<number|null>} wall-clock ms when audio started, or null if no audio */
  async start({ systemAudio, mic, micDeviceId, systemVolume, micVolume, onChunk }) {
    this.warnings = [];
    if (!systemAudio && !mic) return null;
    this.ctx = new AudioContext({ sampleRate: 48000 });
    const dest = this.ctx.createMediaStreamDestination();
    let sources = 0;

    if (systemAudio) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        display.getVideoTracks().forEach((t) => t.stop()); // FFmpeg handles video
        if (display.getAudioTracks().length) {
          this.connect(display, systemVolume, dest);
          sources += 1;
        } else {
          this.warnings.push('Game/system audio was not available');
        }
      } catch (e) {
        this.warnings.push(`Game/system audio failed: ${e.message}`);
      }
    }

    if (mic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: micDeviceId && micDeviceId !== 'default' ? { exact: micDeviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: false,
          },
        });
        this.connect(stream, micVolume, dest);
        sources += 1;
      } catch (e) {
        this.warnings.push(`Microphone failed: ${e.message}`);
      }
    }

    if (!sources) { await this.cleanup(); return null; }

    this.recorder = new MediaRecorder(dest.stream, {
      mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000,
    });
    this.recorder.ondataavailable = async (e) => {
      if (e.data.size) onChunk(await e.data.arrayBuffer());
    };
    this.stopped = new Promise((r) => { this.recorder.onstop = r; });
    this.recorder.start(500);
    return Date.now();
  }

  connect(stream, volume, dest) {
    this.streams.push(stream);
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = Number(volume ?? 1);
    src.connect(gain).connect(dest);
  }

  async stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
      await this.stopped;
      // Let the final ondataavailable's arrayBuffer() resolve and send.
      await new Promise((r) => setTimeout(r, 150));
    }
    await this.cleanup();
  }

  async cleanup() {
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.streams = [];
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.recorder = null;
  }
}

window.AudioCapture = AudioCapture;

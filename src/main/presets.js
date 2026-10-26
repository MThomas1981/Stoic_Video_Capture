// Recording modes and quality levels. Pure data plus helpers, so it can be
// shared with tests and the renderer (via IPC).

const RESOLUTIONS = {
  native: null,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160,
};

// Lower number = better quality / bigger file. Each encoder family reads the
// value its own way (CRF, CQ or QP), but the scales are close enough.
const QUALITY = {
  low: 30,
  medium: 25,
  high: 21,
  ultra: 17,
};

const MODES = {
  gaming: {
    label: 'Gaming',
    description: 'Full screen at 60 fps with your GPU encoder, game audio and mic.',
    settings: {
      source: 'screen',
      fps: 60,
      resolution: 'native',
      quality: 'high',
      encoder: 'auto',
      systemAudio: true,
      mic: true,
      cursor: false,
    },
  },
  video: {
    label: 'Video',
    description: 'Screen recording for tutorials and walkthroughs at 30 fps with cursor.',
    settings: {
      source: 'screen',
      fps: 30,
      resolution: '1080p',
      quality: 'high',
      encoder: 'auto',
      systemAudio: true,
      mic: true,
      cursor: true,
    },
  },
  liveAction: {
    label: 'Live action',
    description: 'Record from a webcam or capture card with your mic.',
    settings: {
      source: 'camera',
      fps: 30,
      resolution: 'native',
      quality: 'high',
      encoder: 'auto',
      systemAudio: false,
      mic: true,
      cursor: false,
    },
  },
  diy: {
    label: 'DIY',
    description: 'Pick every setting yourself.',
    settings: null, // keeps whatever the user has set
  },
};

const DEFAULT_SETTINGS = {
  mode: 'gaming',
  ...MODES.gaming.settings,
  displayId: null,
  region: null, // { x, y, width, height } in physical pixels, relative to the display
  cameraDevice: null,
  micDeviceId: 'default',
  systemVolume: 1,
  micVolume: 1,
  audioOffsetMs: 0,
  hotkey: 'F9',
  outputDir: null,
};

module.exports = { RESOLUTIONS, QUALITY, MODES, DEFAULT_SETTINGS };

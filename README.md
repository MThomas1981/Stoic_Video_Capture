# Stoic Video Capture

Gameplay and screen capture for Windows, built with Electron and FFmpeg.

## What works (Step 1)

- **Modes:** Gaming, Video, Live action and DIY. Picking a mode fills in the settings; changing any setting by hand switches to DIY.
- **Capture sources:** full screen (choose the monitor), a dragged region of the screen, or a webcam / capture card.
- **Quality:** resolution (native, 720p, 1080p, 1440p, 4K), 30/60/120 fps, four quality levels.
- **Encoders:** NVIDIA NVENC, AMD AMF, Intel Quick Sync or CPU (x264). "Automatic" tests what your PC supports at startup and picks the fastest.
- **Audio:** game/system audio and microphone, each with its own volume, mixed into one track.
- **Hotkey:** F9 by default starts and stops recording, even while a game has focus.
- **Output:** MP4 files (H.264 + AAC) in `Videos\Stoic Video Capture`. If saving fails, the raw `.mkv` is kept.
- **Installer:** Windows setup `.exe` that adds desktop and Start menu shortcuts.

## Editor (Step 2)

Open the **Edit** tab, or click **Edit** next to a recent recording.

- **Frame-by-frame scrubbing:** step one frame with ←/→ (or `,` `.`), 1 second with Shift, 10 seconds with Ctrl.
  Drag on the timeline to scrub; zoom in until each frame has its own tick. Type a time (`1:23`, `0:01:23:15`)
  or a frame (`f2000`) into the timecode box to jump straight there.
- **Clips:** mark In (I) and Out (O), then add the clip (C). Add as many as you like, reorder them, and use
  "Play clips only" to preview the cut. With no clips, the whole video is exported.
- **Markers:** press M to timestamp a moment and name it. **Chapters…** saves them as YouTube chapters,
  with times adjusted for your clips and speed.
- **Speed:** 0.25× to 4× with the slider or the preset buttons. Audio keeps its pitch.
- **Music:** add an MP3/M4A/WAV/OGG/FLAC track, set its volume, start point, fade in/out and looping,
  and turn the recording's own audio up, down or off.
- **Export:** renders an MP4 using your GPU encoder when available, with a progress bar and cancel.

## Style and effects

The editor's side panel has **Cut**, **Style**, **Text** and **Audio** tabs.

- **Flavor packs:** one click sets a whole look. Clean, Neon Arcade, Cinematic, Retro VHS, Esports and Chill.
  Change anything afterwards to make it your own.
- **Transitions** between clips: crossfade, dissolve, dip to black, flash, wipes, slides, circle, radial, zoom,
  pixelize, blur, squeeze, diagonal, or "mix it up". Optional fade in/out at the start and end.
- **Animated borders:** solid, rainbow cycle, pulse, or a drifting two-color gradient.
- **Look:** saturation, contrast, brightness, warmth, film grain, vignette, letterbox, sharpen and VHS bleed.
- **Text:** titles and captions with font, size, color, position, background box and fade/slide/drop animations.
- **Logo / image:** PNG/JPG/WebP overlay with position, size and opacity.

The player shows a live approximation; the export renders the exact result with FFmpeg.

## Getting the installer

Every push to `main` builds the installer on GitHub Actions. Open the latest run under
**Actions → Build Windows installer** and download the `Stoic-Video-Capture-Setup` artifact.
Pushing a tag like `v0.1.0` also attaches it to a GitHub Release.

The installer is not code-signed yet, so Windows SmartScreen will say "Windows protected your PC".
Click **More info → Run anyway**.

## Developing

```bash
npm install
npm run fetch-ffmpeg   # downloads ffmpeg.exe into resources/ffmpeg (Windows)
npm start
npm test
npm run dist:win       # builds dist/Stoic-Video-Capture-Setup-<version>.exe
```

## How capture works

- Video: FFmpeg's `ddagrab` (Windows Desktop Duplication API) captures the screen on the GPU and
  hands frames straight to NVENC/AMF when possible. If `ddagrab` is unavailable it falls back to `gdigrab`.
  Cameras use DirectShow.
- Audio: recorded in the app window via Chromium's Windows loopback capture plus the microphone,
  then muxed with the video when recording stops. Sync is measured automatically; the
  **Audio sync adjust** setting fine-tunes it.

## Known limits

- Multi-monitor: the monitor order assumes Windows numbers the main display first. Tell us if the wrong screen is recorded.
- Some games running in exclusive full screen may record black; borderless/windowed full screen always works.

FFmpeg is © the FFmpeg developers and is bundled under the GPL; see `resources/ffmpeg/LICENSE.txt` in the installed app.

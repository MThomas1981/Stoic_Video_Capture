// Downloads a Windows FFmpeg build (with ddagrab + NVENC/AMF/QSV) into
// resources/ffmpeg so electron-builder can bundle it. Run on the build machine.
//
// Override the source with FFMPEG_ZIP_URL if needed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', 'resources', 'ffmpeg');
const RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest';

async function pickUrl() {
  if (process.env.FFMPEG_ZIP_URL) return process.env.FFMPEG_ZIP_URL;
  const headers = { 'User-Agent': 'stoic-video-capture-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(RELEASE_API, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const assets = (await res.json()).assets || [];
  // Prefer the newest stable release branch (e.g. n7.1) over nightly master.
  const stable = assets
    .map((a) => ({ a, m: a.name.match(/^ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-\d+\.\d+\.zip$/) }))
    .filter((x) => x.m)
    .sort((x, y) => (y.m[1] - x.m[1]) || (y.m[2] - x.m[2]));
  const chosen = stable[0]?.a || assets.find((a) => a.name === 'ffmpeg-master-latest-win64-gpl.zip');
  if (!chosen) throw new Error('No Windows FFmpeg build found in latest release');
  return chosen.browser_download_url;
}

async function main() {
  const exe = path.join(OUT_DIR, 'ffmpeg.exe');
  if (fs.existsSync(exe) && fs.existsSync(path.join(OUT_DIR, 'ffprobe.exe')) && !process.env.FFMPEG_FORCE) {
    console.log('ffmpeg.exe already present, skipping download');
    return;
  }
  const url = await pickUrl();
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-'));
  const zip = path.join(tmp, 'ffmpeg.zip');
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

  // Windows 10+ ships bsdtar, which reads zip files.
  if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', tmp]);
  else execFileSync('unzip', ['-q', zip, '-d', tmp]);

  const found = findFile(tmp, 'ffmpeg.exe');
  if (!found) throw new Error('ffmpeg.exe not found in archive');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(found, exe);
  const probe = findFile(tmp, 'ffprobe.exe');
  if (!probe) throw new Error('ffprobe.exe not found in archive');
  fs.copyFileSync(probe, path.join(OUT_DIR, 'ffprobe.exe'));
  const license = findFile(tmp, 'LICENSE.txt');
  if (license) fs.copyFileSync(license, path.join(OUT_DIR, 'LICENSE.txt'));
  fs.writeFileSync(path.join(OUT_DIR, 'SOURCE.txt'), `FFmpeg binary from ${url}\nSource: https://ffmpeg.org/download.html\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Saved ${exe}`);
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return p;
    }
  }
  return null;
}

main().catch((e) => { console.error(e.message); process.exit(1); });

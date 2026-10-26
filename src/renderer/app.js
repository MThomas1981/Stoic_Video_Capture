const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  modes: {},
  caps: null,
  displays: [],
  recording: false,
  busy: false,
  startedAt: 0,
  timerHandle: null,
};
const audio = new window.AudioCapture();

// Settings that belong to a mode preset. Changing one by hand switches to DIY.
const PRESET_KEYS = ['source', 'fps', 'resolution', 'quality', 'encoder', 'systemAudio', 'mic', 'cursor'];

// ---------- helpers ----------

function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), isError ? 9000 : 3500);
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function fmtSize(bytes) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

const ENCODER_NAMES = {
  h264_nvenc: 'NVIDIA NVENC', h264_amf: 'AMD AMF', h264_qsv: 'Intel Quick Sync', libx264: 'CPU (x264)',
};

async function save(patch) {
  state.settings = await window.api.saveSettings(patch);
  render();
}

// ---------- rendering ----------

function renderModes() {
  const nav = $('modes');
  nav.innerHTML = '';
  for (const [key, mode] of Object.entries(state.modes)) {
    const b = document.createElement('button');
    b.className = `mode${state.settings.mode === key ? ' active' : ''}`;
    b.innerHTML = '<div class="mode-title"></div><div class="mode-desc"></div>';
    b.querySelector('.mode-title').textContent = mode.label;
    b.querySelector('.mode-desc').textContent = mode.description;
    b.disabled = state.recording;
    b.onclick = () => {
      const preset = mode.settings || {};
      save({ mode: key, ...preset });
    };
    nav.appendChild(b);
  }
}

function render() {
  const s = state.settings;
  renderModes();

  document.querySelectorAll('#sourceGroup button').forEach((b) => {
    b.classList.toggle('active', b.dataset.source === s.source);
  });
  $('displayField').classList.toggle('hidden', s.source === 'camera');
  $('regionField').classList.toggle('hidden', s.source !== 'region');
  $('cameraField').classList.toggle('hidden', s.source !== 'camera');
  $('cursorField').classList.toggle('hidden', s.source === 'camera');
  $('regionText').textContent = s.region
    ? `${s.region.width} × ${s.region.height} at (${s.region.x}, ${s.region.y})`
    : 'No area selected';

  $('display').value = String(s.displayId ?? state.displays[0]?.id ?? '');
  if (s.cameraDevice) $('camera').value = s.cameraDevice;
  $('resolution').value = s.resolution;
  $('fps').value = String(s.fps);
  $('quality').value = s.quality;
  $('encoder').value = s.encoder;
  $('cursor').checked = !!s.cursor;
  $('systemAudio').checked = !!s.systemAudio;
  $('mic').checked = !!s.mic;
  $('micDeviceId').value = s.micDeviceId || 'default';
  $('systemVolume').value = s.systemVolume;
  $('micVolume').value = s.micVolume;
  $('systemVolumeOut').textContent = `${Math.round(s.systemVolume * 100)}%`;
  $('micVolumeOut').textContent = `${Math.round(s.micVolume * 100)}%`;
  $('audioOffsetMs').value = s.audioOffsetMs;
  $('outputDir').textContent = s.outputDir;
  $('outputDir').title = s.outputDir;
  $('hotkey').value = s.hotkey || '';
  $('hotkeyHint').textContent = s.hotkey || 'none';

  // Encoder options the PC can't use are greyed out.
  const avail = state.caps?.encoders || [];
  [...$('encoder').options].forEach((o) => {
    if (o.value !== 'auto') o.disabled = !avail.includes(o.value);
  });

  document.querySelectorAll('.grid .card').forEach((c) => c.classList.toggle('locked', state.recording));

  const btn = $('recordBtn');
  btn.classList.toggle('recording', state.recording);
  $('recordLabel').textContent = state.busy
    ? (state.recording ? 'Saving…' : 'Starting…')
    : (state.recording ? 'Stop recording' : 'Start recording');
  btn.disabled = state.busy || !state.caps?.ok;
}

function renderCaps() {
  const c = state.caps;
  if (!c.ok) {
    $('caps').innerHTML = '<b>FFmpeg not found.</b> Reinstall the app.';
    $('status').textContent = 'Recording is unavailable.';
    return;
  }
  const best = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'].find((e) => c.encoders.includes(e));
  $('caps').innerHTML = `Encoder: <b>${ENCODER_NAMES[best] || 'none'}</b><br>`
    + `Capture: <b>${c.ddagrab ? 'Desktop Duplication' : 'GDI (compatibility)'}</b>`;
  $('status').textContent = 'Ready';
}

async function renderRecordings() {
  const list = await window.api.listRecordings();
  const ul = $('recordings');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li class="empty">No recordings yet. Press record or your hotkey to start.</li>';
    return;
  }
  for (const r of list) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="name"></span><span class="meta"></span>'
      + '<button class="btn play">Play</button><button class="btn show">Show</button>';
    li.querySelector('.name').textContent = r.name;
    li.querySelector('.meta').textContent = `${fmtSize(r.size)} · ${new Date(r.mtime).toLocaleString()}`;
    li.querySelector('.play').onclick = () => window.api.openFile(r.path);
    li.querySelector('.show').onclick = () => window.api.showFile(r.path);
    ul.appendChild(li);
  }
}

function fillSelect(el, items, getValue, getLabel, emptyLabel) {
  el.innerHTML = '';
  if (!items.length && emptyLabel) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = emptyLabel;
    el.appendChild(o);
  }
  for (const it of items) {
    const o = document.createElement('option');
    o.value = getValue(it);
    o.textContent = getLabel(it);
    el.appendChild(o);
  }
}

// ---------- recording ----------

async function startRecording() {
  const s = state.settings;
  if (s.source === 'region' && !s.region) {
    toast('Select an area to record first.', true);
    return;
  }
  if (s.source === 'camera' && !s.cameraDevice) {
    toast('No camera selected.', true);
    return;
  }
  state.busy = true;
  render();
  let audioStartedAt = null;
  try {
    audioStartedAt = await audio.start({
      systemAudio: s.systemAudio,
      mic: s.mic,
      micDeviceId: s.micDeviceId,
      systemVolume: s.systemVolume,
      micVolume: s.micVolume,
      onChunk: (buf) => window.api.sendAudioChunk(buf),
    });
    const info = await window.api.startRecording({ audioStartedAt });
    state.recording = true;
    state.startedAt = Date.now();
    state.timerHandle = setInterval(() => { $('timer').textContent = fmtTime(Date.now() - state.startedAt); }, 250);
    $('status').textContent = `Recording with ${ENCODER_NAMES[info.encoder] || info.encoder}`;
    if (audio.warnings.length) toast(audio.warnings.join('\n'), true);
  } catch (e) {
    await audio.stop();
    toast(cleanError(e), true);
    $('status').textContent = 'Ready';
  } finally {
    state.busy = false;
    render();
  }
}

async function stopRecording() {
  state.busy = true;
  render();
  clearInterval(state.timerHandle);
  try {
    await audio.stop();
    const res = await window.api.stopRecording();
    if (res) {
      toast(`Saved: ${res.path.split(/[\\/]/).pop()}`);
      $('status').textContent = 'Saved. Ready for the next one.';
    }
  } catch (e) {
    toast(cleanError(e), true);
    $('status').textContent = 'Ready';
  } finally {
    state.recording = false;
    state.busy = false;
    $('timer').textContent = '00:00:00';
    render();
    renderRecordings();
  }
}

function toggleRecording() {
  if (state.busy) return;
  if (state.recording) stopRecording(); else startRecording();
}

function cleanError(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- hotkey capture ----------

function acceleratorFromEvent(e) {
  const key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = key.length === 1 ? key.toUpperCase() : key;
  if (k === ' ') k = 'Space';
  if (k.startsWith('Arrow')) k = k.slice(5);
  parts.push(k);
  // Bare letters would fire while typing in games/chat; require a modifier.
  if (parts.length === 1 && !/^F\d{1,2}$/.test(k)) return null;
  return parts.join('+');
}

// ---------- wiring ----------

function bind() {
  $('recordBtn').onclick = toggleRecording;
  window.api.onHotkey(toggleRecording);

  document.querySelectorAll('#sourceGroup button').forEach((b) => {
    b.onclick = () => save({ source: b.dataset.source, mode: 'diy' });
  });

  const presetField = (id, parse = (v) => v) => {
    $(id).onchange = (e) => {
      const el = e.target;
      const v = el.type === 'checkbox' ? el.checked : parse(el.value);
      save({ [id]: v, ...(PRESET_KEYS.includes(id) ? { mode: 'diy' } : {}) });
    };
  };
  presetField('resolution');
  presetField('fps', Number);
  presetField('quality');
  presetField('encoder');
  presetField('cursor');
  presetField('systemAudio');
  presetField('mic');
  presetField('micDeviceId');
  $('camera').onchange = (e) => save({ cameraDevice: e.target.value });
  $('display').onchange = (e) => save({ displayId: Number(e.target.value), region: null });
  $('audioOffsetMs').onchange = (e) => save({ audioOffsetMs: Number(e.target.value) || 0 });
  for (const id of ['systemVolume', 'micVolume']) {
    $(id).oninput = (e) => { $(`${id}Out`).textContent = `${Math.round(e.target.value * 100)}%`; };
    $(id).onchange = (e) => save({ [id]: Number(e.target.value) });
  }

  $('pickRegion').onclick = async () => {
    const displayId = state.settings.displayId ?? state.displays[0]?.id;
    const region = await window.api.selectRegion(displayId);
    if (region) save({ region, source: 'region' });
  };
  $('refreshCameras').onclick = loadCameras;
  $('chooseFolder').onclick = async () => { state.settings = await window.api.chooseFolder(); render(); renderRecordings(); };
  $('openFolder').onclick = () => window.api.openFolder();
  $('refreshRecordings').onclick = renderRecordings;

  $('hotkey').onkeydown = (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { $('hotkey').blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { save({ hotkey: '' }); return; }
    const acc = acceleratorFromEvent(e);
    if (acc) { save({ hotkey: acc }); $('hotkey').blur(); }
  };
}

async function loadCameras() {
  const cams = await window.api.listCameras();
  fillSelect($('camera'), cams, (c) => c, (c) => c, 'No cameras found');
  if (!state.settings.cameraDevice && cams[0]) await save({ cameraDevice: cams[0] });
  else render();
}

async function boot() {
  bind();
  const init = await window.api.init();
  Object.assign(state, {
    settings: init.settings, modes: init.modes, caps: init.caps, displays: init.displays,
  });
  $('version').textContent = `v${init.version}`;
  fillSelect($('display'), init.displays, (d) => d.id, (d) => d.label);
  fillSelect($('camera'), init.cameras, (c) => c, (c) => c, 'No cameras found');
  if (!state.settings.cameraDevice && init.cameras[0]) state.settings.cameraDevice = init.cameras[0];
  const mics = await window.AudioCapture.listMics();
  if (!mics.some((m) => m.id === 'default')) mics.unshift({ id: 'default', label: 'Default microphone' });
  fillSelect($('micDeviceId'), mics, (m) => m.id, (m) => m.label);
  renderCaps();
  render();
  renderRecordings();
}

boot().catch((e) => toast(cleanError(e), true));

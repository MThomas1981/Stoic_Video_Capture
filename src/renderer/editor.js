// Editor tab: frame-accurate player, zoomable timeline, clips, markers,
// speed, music and export.

(() => {
  const $ = (id) => document.getElementById(id);
  const TM = window.TimelineMath;
  const video = $('video');
  const music = $('musicPreview');

  const ed = {
    file: null, // probe result
    clips: [],
    markers: [],
    inPoint: null,
    outPoint: null,
    speed: 1,
    originalVolume: 1,
    music: null, // { path, name, volume, startAt, fadeIn, fadeOut, loop }
    zoom: 1,
    thumbs: [],
    exporting: false,
    effects: JSON.parse(JSON.stringify(window.Flavors.DEFAULT_EFFECTS)),
  };
  const ov = () => TM.transitionLength(ed.clips, ed.effects.transition);

  const mediaUrl = (p) => `media://local/${encodeURIComponent(p)}`;
  const fps = () => ed.file?.fps || 30;
  const dur = () => ed.file?.duration || 0;
  const currentFrame = () => TM.frameAt(video.currentTime, fps());
  const lastFrame = () => Math.max(0, Math.round(dur() * fps()) - 1);

  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), isError ? 9000 : 3500);
  }
  const cleanError = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ---------- tabs ----------

  function showView(view) {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('recordView').classList.toggle('hidden', view !== 'record');
    $('editView').classList.toggle('hidden', view !== 'edit');
    if (view !== 'edit') { video.pause(); music.pause(); }
    if (view === 'edit') requestAnimationFrame(layoutTimeline);
  }
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });

  // ---------- loading ----------

  async function open(filePath) {
    if (!filePath) return;
    if (ed.exporting) { toast('Wait for the export to finish first.', true); return; }
    showView('edit');
    try {
      const info = await window.api.edit.probe(filePath);
      Object.assign(ed, {
        file: info, clips: [], markers: [], inPoint: null, outPoint: null, speed: 1, thumbs: [], zoom: 1,
      });
      ed.effects.texts = [];
      $('zoom').value = 0;
      $('editorEmpty').classList.add('hidden');
      $('editor').classList.remove('hidden');
      $('edFileName').textContent = info.name;
      $('edFileMeta').textContent = `${info.width}×${info.height} · ${Math.round(info.fps * 100) / 100} fps · `
        + `${TM.short(info.duration)} · ${info.frames.toLocaleString()} frames${info.hasAudio ? '' : ' · no audio'}`;
      video.src = mediaUrl(filePath);
      video.load();
      setSpeed(1);
      renderAll();
      document.dispatchEvent(new Event('editor-file'));
      requestAnimationFrame(layoutTimeline);
      const count = Math.min(60, Math.max(12, Math.round(info.duration / 5)));
      ed.thumbs = await window.api.edit.thumbs(filePath, info.duration, count);
      if (ed.file?.path === filePath) renderFilmstrip();
    } catch (e) {
      toast(cleanError(e), true);
    }
  }
  window.openInEditor = open;

  const pickAndOpen = async () => open(await window.api.edit.pickVideo());
  $('openVideo').onclick = pickAndOpen;
  $('openVideo2').onclick = pickAndOpen;

  // ---------- seeking ----------

  function seekFrame(frame) {
    const f = Math.max(0, Math.min(lastFrame(), frame));
    video.currentTime = TM.timeOfFrame(f, fps());
    renderPlayhead();
  }
  const seekTime = (t) => seekFrame(TM.frameAt(Math.max(0, Math.min(dur(), t)), fps()));
  const stepFrames = (n) => { video.pause(); seekFrame(currentFrame() + n); };
  const stepSeconds = (s) => seekFrame(currentFrame() + Math.round(s * fps()));

  function togglePlay() {
    if (!ed.file) return;
    if (video.paused) {
      if (currentFrame() >= lastFrame()) seekFrame(0);
      video.play();
    } else {
      video.pause();
    }
  }

  $('tPlay').onclick = togglePlay;
  $('tPrevFrame').onclick = () => stepFrames(-1);
  $('tNextFrame').onclick = () => stepFrames(1);
  $('tBack1').onclick = () => stepSeconds(-1);
  $('tFwd1').onclick = () => stepSeconds(1);
  $('tBack10').onclick = () => stepSeconds(-10);
  $('tFwd10').onclick = () => stepSeconds(10);
  $('tStart').onclick = () => seekFrame(0);
  $('tEnd').onclick = () => seekFrame(lastFrame());

  $('timecode').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const t = TM.parseTime(e.target.value, fps());
    if (t === null) { toast('Type a time like 1:23, 0:01:23:15 or a frame like f2000.', true); return; }
    seekTime(t);
    e.target.blur();
  };
  $('timecode').onblur = () => renderPlayhead();

  // ---------- clips and markers ----------

  function setIn() { ed.inPoint = TM.frameAt(video.currentTime, fps()) / fps(); if (ed.outPoint !== null && ed.outPoint <= ed.inPoint) ed.outPoint = null; renderClips(); }
  function setOut() {
    ed.outPoint = (currentFrame() + 1) / fps(); // include the frame under the playhead
    if (ed.inPoint !== null && ed.inPoint >= ed.outPoint) ed.inPoint = null;
    renderClips();
  }
  function addClip() {
    const start = ed.inPoint ?? 0;
    const end = ed.outPoint ?? dur();
    if (end - start < 1 / fps()) { toast('Set an In point before the Out point.', true); return; }
    ed.clips.push({ start, end });
    ed.inPoint = null;
    ed.outPoint = null;
    renderClips();
    toast(`Clip ${ed.clips.length} added (${TM.short(end - start)})`);
  }
  function addMarker() {
    const time = TM.frameAt(video.currentTime, fps()) / fps();
    ed.markers.push({ time, label: `Marker ${ed.markers.length + 1}` });
    ed.markers.sort((a, b) => a.time - b.time);
    renderMarkers();
  }

  $('setIn').onclick = setIn;
  $('setOut').onclick = setOut;
  $('addClip').onclick = addClip;
  $('addMarker').onclick = addMarker;

  $('exportChapters').onclick = async () => {
    if (!ed.markers.length) { toast('Add some markers first.', true); return; }
    const text = TM.chaptersText(ed.markers, ed.clips, ed.speed, dur(), ov());
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard optional */ }
    const saved = await window.api.edit.saveText({
      suggestedName: `${ed.file.name.replace(/\.[^.]+$/, '')} chapters.txt`, text,
    });
    toast(saved ? 'Chapters copied and saved. Paste them into your YouTube description.' : 'Chapters copied to clipboard.');
  };

  // ---------- speed ----------

  function setSpeed(s) {
    ed.speed = Math.min(4, Math.max(0.25, Math.round(Number(s) * 100) / 100));
    $('speed').value = ed.speed;
    $('speedOut').textContent = `${ed.speed.toFixed(2)}×`;
    document.querySelectorAll('#speedChips button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === ed.speed));
    video.playbackRate = ed.speed;
    renderSummary();
    renderMarkersHint();
  }
  $('speed').oninput = (e) => setSpeed(e.target.value);
  document.querySelectorAll('#speedChips button').forEach((b) => { b.onclick = () => setSpeed(b.dataset.speed); });

  // ---------- music ----------

  $('pickMusic').onclick = async () => {
    const p = await window.api.edit.pickMusic();
    if (!p) return;
    ed.music = {
      path: p, name: p.split(/[\\/]/).pop(), volume: Number($('musicVol').value),
      startAt: 0, fadeIn: Number($('musicFadeIn').value), fadeOut: Number($('musicFadeOut').value), loop: $('musicLoop').checked,
    };
    music.src = mediaUrl(p);
    music.loop = ed.music.loop;
    renderMusic();
  };
  $('removeMusic').onclick = () => { ed.music = null; music.pause(); music.removeAttribute('src'); renderMusic(); };
  $('musicVol').oninput = (e) => {
    if (ed.music) ed.music.volume = Number(e.target.value);
    $('musicVolOut').textContent = `${Math.round(e.target.value * 100)}%`;
    syncVolumes();
  };
  $('origVol').oninput = (e) => {
    ed.originalVolume = Number(e.target.value);
    $('origVolOut').textContent = `${Math.round(e.target.value * 100)}%`;
    syncVolumes();
  };
  $('musicStart').onchange = (e) => {
    const t = TM.parseTime(e.target.value, fps());
    if (ed.music && t !== null) ed.music.startAt = Math.max(0, t);
    renderMusic();
  };
  $('musicAtPlayhead').onclick = () => {
    if (!ed.music) return;
    const t = TM.sourceToOutput(video.currentTime, ed.clips, ed.speed, dur(), ov());
    if (t === null) { toast('The playhead is outside your clips.', true); return; }
    ed.music.startAt = t;
    renderMusic();
  };
  $('musicFadeIn').onchange = (e) => { if (ed.music) ed.music.fadeIn = Math.max(0, Number(e.target.value) || 0); };
  $('musicFadeOut').onchange = (e) => { if (ed.music) ed.music.fadeOut = Math.max(0, Number(e.target.value) || 0); };
  $('musicLoop').onchange = (e) => { if (ed.music) ed.music.loop = e.target.checked; music.loop = e.target.checked; };

  function syncVolumes() {
    // <video>.volume caps at 1; the export applies boosts above 100%.
    video.volume = Math.min(1, ed.originalVolume);
    music.volume = Math.min(1, ed.music?.volume ?? 0);
  }

  /** Keep the music preview roughly in step with the edited timeline. */
  function syncMusic() {
    if (!ed.music || !music.src) return;
    const outT = TM.sourceToOutput(video.currentTime, ed.clips, ed.speed, dur(), ov());
    const mt = outT === null ? -1 : outT - ed.music.startAt;
    const playing = !video.paused && mt >= 0 && (ed.music.loop || mt < (music.duration || Infinity));
    if (!playing) { if (!music.paused) music.pause(); return; }
    const target = ed.music.loop && music.duration ? mt % music.duration : mt;
    if (Math.abs(music.currentTime - target) > 0.25) music.currentTime = target;
    if (music.paused) music.play().catch(() => {});
  }

  // ---------- timeline ----------

  const inner = $('timelineInner');
  const timeline = $('timeline');
  const xOf = (t) => (dur() ? (t / dur()) * inner.clientWidth : 0);

  function layoutTimeline() {
    if (!ed.file) return;
    inner.style.width = `${Math.max(1, ed.zoom) * timeline.clientWidth}px`;
    renderRuler();
    renderFilmstrip();
    renderClips();
    renderMarkers();
    renderPlayhead();
  }

  // Fully zoomed in shows about one second, so single frames are easy to grab.
  const maxZoom = () => Math.max(1, dur());
  const sliderToZoom = (v) => maxZoom() ** (v / 1000);
  const zoomToSlider = (z) => (maxZoom() > 1 ? (Math.log(z) / Math.log(maxZoom())) * 1000 : 0);

  function setZoom(z, anchorTime = video.currentTime) {
    const anchorX = xOf(anchorTime) - timeline.scrollLeft;
    ed.zoom = Math.max(1, Math.min(maxZoom(), z));
    $('zoom').value = zoomToSlider(ed.zoom);
    layoutTimeline();
    timeline.scrollLeft = xOf(anchorTime) - anchorX;
    const visible = dur() / ed.zoom;
    $('zoomLabel').textContent = ed.zoom === 1 ? 'Whole video' : `${TM.short(visible)} visible`;
  }
  $('zoom').oninput = (e) => setZoom(sliderToZoom(Number(e.target.value)));
  timeline.addEventListener('wheel', (e) => {
    if (!ed.file) return;
    if (e.ctrlKey) {
      // Ctrl+wheel zooms around the mouse; plain wheel scrolls.
      e.preventDefault();
      const rect = inner.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / inner.clientWidth) * dur();
      setZoom(ed.zoom * (e.deltaY < 0 ? 1.25 : 0.8), t);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      timeline.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  function niceStep(secondsPerPx) {
    const target = secondsPerPx * 90; // aim for a label every ~90px
    const steps = [1 / fps(), 5 / fps(), 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    return steps.find((s) => s >= target) || 3600;
  }

  function renderRuler() {
    const ruler = $('ruler');
    ruler.innerHTML = '';
    const w = inner.clientWidth;
    if (!w || !dur()) return;
    const step = niceStep(dur() / w);
    const frag = document.createDocumentFragment();
    const showFrames = step < 1;
    for (let t = 0, i = 0; t <= dur() + 1e-9 && i < 4000; t = ++i * step) {
      const tick = document.createElement('div');
      tick.className = 'tick major';
      tick.style.left = `${xOf(t)}px`;
      const label = document.createElement('span');
      label.textContent = showFrames ? TM.timecode(t, fps()) : TM.short(t).replace(/\.00$/, '');
      tick.appendChild(label);
      frag.appendChild(tick);
    }
    // One small tick per frame once frames are wide enough to see.
    const pxPerFrame = w / (dur() * fps());
    if (pxPerFrame >= 6) {
      const first = Math.floor((timeline.scrollLeft / w) * dur() * fps());
      const last = Math.ceil(((timeline.scrollLeft + timeline.clientWidth) / w) * dur() * fps());
      for (let f = Math.max(0, first - 60); f <= last + 60; f += 1) {
        const tick = document.createElement('div');
        tick.className = 'tick minor';
        tick.style.left = `${(f / fps() / dur()) * w}px`;
        frag.appendChild(tick);
      }
    }
    ruler.appendChild(frag);
  }
  timeline.addEventListener('scroll', () => { if (ed.zoom > 1) renderRuler(); });

  function renderFilmstrip() {
    const strip = $('filmstrip');
    strip.innerHTML = '';
    if (!ed.thumbs.length) return;
    const w = inner.clientWidth / ed.thumbs.length;
    ed.thumbs.forEach((th, i) => {
      if (!th.src) return;
      const img = document.createElement('img');
      img.src = th.src;
      img.style.left = `${i * w}px`;
      img.style.width = `${w}px`;
      strip.appendChild(img);
    });
  }

  function renderPlayhead() {
    if (!ed.file) return;
    const x = xOf(video.currentTime);
    $('playhead').style.left = `${x}px`;
    if (document.activeElement !== $('timecode')) $('timecode').value = TM.timecode(video.currentTime, fps());
    $('frameInfo').textContent = `Frame ${currentFrame().toLocaleString()} / ${lastFrame().toLocaleString()}`;
    $('tPlay').textContent = video.paused ? '▶' : '❚❚';
    // Keep the playhead in view while playing or stepping when zoomed in.
    if (ed.zoom > 1 && !dragging) {
      const left = timeline.scrollLeft;
      const right = left + timeline.clientWidth;
      if (x < left + 20 || x > right - 20) timeline.scrollLeft = x - timeline.clientWidth / 3;
    }
  }

  let dragging = false;
  function timeFromEvent(e) {
    const rect = inner.getBoundingClientRect();
    return Math.max(0, Math.min(dur(), ((e.clientX - rect.left) / inner.clientWidth) * dur()));
  }
  inner.addEventListener('pointerdown', (e) => {
    if (!ed.file) return;
    dragging = true;
    inner.setPointerCapture(e.pointerId);
    video.pause();
    seekTime(timeFromEvent(e));
  });
  inner.addEventListener('pointermove', (e) => { if (dragging) seekTime(timeFromEvent(e)); });
  inner.addEventListener('pointerup', () => { dragging = false; });

  // ---------- rendering ----------

  function li(html) {
    const el = document.createElement('li');
    el.innerHTML = html;
    return el;
  }

  function renderClips() {
    const layer = $('clipLayer');
    layer.innerHTML = '';
    ed.clips.forEach((c, i) => {
      const b = document.createElement('div');
      b.className = 'clip-block';
      b.style.left = `${xOf(c.start)}px`;
      b.style.width = `${Math.max(2, xOf(c.end) - xOf(c.start))}px`;
      b.innerHTML = `<span>${i + 1}</span>`;
      layer.appendChild(b);
    });
    const io = $('inoutRange');
    if (ed.inPoint !== null || ed.outPoint !== null) {
      const s = ed.inPoint ?? 0;
      const e = ed.outPoint ?? video.currentTime;
      io.style.display = 'block';
      io.style.left = `${xOf(Math.min(s, e))}px`;
      io.style.width = `${Math.max(2, Math.abs(xOf(e) - xOf(s)))}px`;
    } else {
      io.style.display = 'none';
    }
    $('inoutText').textContent = `In: ${ed.inPoint === null ? '–' : TM.timecode(ed.inPoint, fps())} · `
      + `Out: ${ed.outPoint === null ? '–' : TM.timecode(ed.outPoint, fps())}`;

    const list = $('clipList');
    list.innerHTML = '';
    ed.clips.forEach((c, i) => {
      const row = li(`<span class="grow" title="Jump to clip"></span>
        <button class="btn" data-a="up" title="Move up">▲</button>
        <button class="btn" data-a="down" title="Move down">▼</button>
        <button class="btn" data-a="del" title="Remove">✕</button>`);
      row.querySelector('.grow').textContent = `${i + 1}. ${TM.short(c.start)} – ${TM.short(c.end)}`;
      row.querySelector('.grow').title = `Length ${TM.short(c.end - c.start)}. Click to jump.`;
      row.querySelector('.grow').onclick = () => seekTime(c.start);
      row.querySelector('[data-a=up]').onclick = () => { if (i > 0) { [ed.clips[i - 1], ed.clips[i]] = [ed.clips[i], ed.clips[i - 1]]; renderClips(); } };
      row.querySelector('[data-a=down]').onclick = () => { if (i < ed.clips.length - 1) { [ed.clips[i + 1], ed.clips[i]] = [ed.clips[i], ed.clips[i + 1]]; renderClips(); } };
      row.querySelector('[data-a=del]').onclick = () => { ed.clips.splice(i, 1); renderClips(); };
      list.appendChild(row);
    });
    $('clipsHint').classList.toggle('hidden', ed.clips.length > 0);
    $('clipsTotal').textContent = ed.clips.length ? `${ed.clips.length} clip${ed.clips.length > 1 ? 's' : ''}` : '';
    renderSummary();
    renderMarkersHint();
  }

  function renderMarkers() {
    const layer = $('markerLayer');
    layer.innerHTML = '';
    ed.markers.forEach((m) => {
      const d = document.createElement('div');
      d.className = 'marker';
      d.style.left = `${xOf(m.time)}px`;
      d.title = m.label;
      layer.appendChild(d);
    });
    const list = $('markerList');
    list.innerHTML = '';
    ed.markers.forEach((m, i) => {
      const row = li(`<span class="grow" title="Jump to marker"></span>
        <input type="text" style="flex:1.4;min-width:0"><button class="btn" title="Remove">✕</button>`);
      row.querySelector('.grow').textContent = TM.timecode(m.time, fps());
      row.querySelector('.grow').onclick = () => seekTime(m.time);
      const input = row.querySelector('input');
      input.value = m.label;
      input.onchange = () => { m.label = input.value.trim() || `Marker ${i + 1}`; };
      row.querySelector('.btn').onclick = () => { ed.markers.splice(i, 1); renderMarkers(); };
      list.appendChild(row);
    });
    renderMarkersHint();
  }

  function renderMarkersHint() {
    const outside = ed.markers.filter((m) => TM.sourceToOutput(m.time, ed.clips, ed.speed, dur(), ov()) === null).length;
    $('markersHint').textContent = !ed.markers.length
      ? 'Press M or ◆ Marker to timestamp a moment.'
      : outside ? `${outside} marker${outside > 1 ? 's are' : ' is'} outside your clips and won't appear in chapters.`
        : 'Chapter times follow your clips and speed.';
  }

  function renderMusic() {
    $('musicBox').classList.toggle('hidden', !ed.music);
    $('pickMusic').textContent = ed.music ? 'Replace…' : 'Add music…';
    if (ed.music) {
      $('musicName').textContent = ed.music.name;
      $('musicName').title = ed.music.path;
      $('musicStart').value = TM.short(ed.music.startAt);
    }
    syncVolumes();
  }

  function renderSummary() {
    if (!ed.file) return;
    const out = TM.outputDuration(ed.clips, ed.speed, dur(), ov());
    $('exportSummary').textContent = `Final length ${TM.short(out)}`
      + `${ed.clips.length ? ` from ${ed.clips.length} clip${ed.clips.length > 1 ? 's' : ''}` : ''}`
      + `${ed.speed !== 1 ? ` at ${ed.speed}×` : ''}${ed.music ? ' with music' : ''}.`;
  }

  function renderAll() {
    renderClips();
    renderMarkers();
    renderMusic();
    renderSummary();
    renderPlayhead();
  }

  // ---------- playback loop ----------

  function tick() {
    if (ed.file && !video.paused) {
      // "Play clips only" skips the gaps between clips, like the export will.
      if ($('previewClips').checked && ed.clips.length) {
        const t = video.currentTime;
        const inClip = ed.clips.some((c) => t >= c.start && t < c.end);
        if (!inClip) {
          const next = ed.clips.map((c) => c.start).filter((s) => s > t).sort((a, b) => a - b)[0];
          if (next === undefined) video.pause(); else video.currentTime = next;
        }
      }
      renderPlayhead();
      if (ed.inPoint !== null && ed.outPoint === null) renderClips();
    }
    syncMusic();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  video.addEventListener('seeked', renderPlayhead);
  video.addEventListener('pause', () => { renderPlayhead(); music.pause(); });
  video.addEventListener('play', renderPlayhead);
  video.addEventListener('loadedmetadata', () => { video.playbackRate = ed.speed; syncVolumes(); seekFrame(0); });
  video.addEventListener('error', () => { if (ed.file) toast('This video could not be played in the preview.', true); });
  video.addEventListener('click', togglePlay);
  window.addEventListener('resize', () => { if (!$('editView').classList.contains('hidden')) layoutTimeline(); });

  // ---------- keyboard ----------

  window.addEventListener('keydown', (e) => {
    if ($('editView').classList.contains('hidden') || !ed.file) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox') return;
    if (tag === 'SELECT') return;
    const step = e.ctrlKey ? 10 : e.shiftKey ? 1 : 0;
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); if (step) stepSeconds(-step); else stepFrames(-1); break;
      case 'ArrowRight': e.preventDefault(); if (step) stepSeconds(step); else stepFrames(1); break;
      case 'Home': e.preventDefault(); seekFrame(0); break;
      case 'End': e.preventDefault(); seekFrame(lastFrame()); break;
      case 'i': case 'I': setIn(); break;
      case 'o': case 'O': setOut(); break;
      case 'c': case 'C': addClip(); break;
      case 'm': case 'M': addMarker(); break;
      case ',': stepFrames(-1); break;
      case '.': stepFrames(1); break;
      default:
    }
  });

  // ---------- export ----------

  window.api.edit.onProgress((p) => {
    $('exportBar').style.width = `${Math.round(p * 100)}%`;
    $('exportPct').textContent = `Exporting… ${Math.round(p * 100)}%`;
  });

  $('exportBtn').onclick = async () => {
    if (!ed.file || ed.exporting) return;
    video.pause();
    ed.exporting = true;
    $('exportBtn').disabled = true;
    $('exportBar').style.width = '0%';
    $('exportPct').textContent = 'Exporting… 0%';
    $('exportProgress').classList.remove('hidden');
    $('exportRow').classList.remove('hidden');
    try {
      const res = await window.api.edit.export({
        input: ed.file.path,
        probe: {
          duration: ed.file.duration, fps: ed.file.fps, hasAudio: ed.file.hasAudio, width: ed.file.width, height: ed.file.height,
        },
        clips: ed.clips,
        speed: ed.speed,
        originalVolume: ed.originalVolume,
        music: ed.music,
        effects: ed.effects,
        quality: $('exportQuality').value,
      });
      if (res) {
        toast(`Exported ${res.path.split(/[\\/]/).pop()}`);
        window.api.showFile(res.path);
      }
    } catch (e) {
      toast(cleanError(e), true);
    } finally {
      ed.exporting = false;
      $('exportBtn').disabled = false;
      $('exportProgress').classList.add('hidden');
      $('exportRow').classList.add('hidden');
    }
  };
  $('cancelExport').onclick = () => window.api.edit.cancel();

  // Shared with editor-fx.js (style, text and logo panels).
  window.EditorBridge = {
    ed,
    video,
    toast,
    outputNow: () => TM.sourceToOutput(video.currentTime, ed.clips, ed.speed, dur(), ov()),
    outputDuration: () => TM.outputDuration(ed.clips, ed.speed, dur(), ov()),
    refresh: () => { renderSummary(); renderMarkersHint(); renderClips(); },
  };
  document.dispatchEvent(new Event('editor-ready'));
})();

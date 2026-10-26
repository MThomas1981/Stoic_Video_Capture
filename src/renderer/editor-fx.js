// Style, Text & logo panels of the editor, plus the live preview overlay.
// The preview is a close approximation; the export renders the exact look.

document.addEventListener('editor-ready', () => {
  const $ = (id) => document.getElementById(id);
  const F = window.Flavors;
  const B = window.EditorBridge;
  const { ed, video } = B;
  const fx = () => ed.effects;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
  const fmt = (t) => window.TimelineMath.short(t);

  function fillOptions(sel, pairs) {
    sel.innerHTML = '';
    for (const [value, label] of pairs) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    }
  }

  // ---------- panel tabs ----------

  document.querySelectorAll('#panelTabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#panelTabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.side-col .panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.panel));
    };
  });

  // ---------- flavors ----------

  function renderFlavors() {
    const box = $('flavors');
    box.innerHTML = '';
    for (const [key, f] of Object.entries(F.FLAVORS)) {
      const b = document.createElement('button');
      b.className = `flavor${fx().flavor === key ? ' active' : ''}`;
      b.innerHTML = '<div class="swatch"></div><div class="flavor-name"></div><div class="flavor-blurb"></div>';
      b.querySelector('.swatch').style.background = `linear-gradient(135deg, ${f.swatch[0]}, ${f.swatch[1]})`;
      b.querySelector('.flavor-name').textContent = f.label;
      b.querySelector('.flavor-blurb').textContent = f.blurb;
      b.onclick = () => {
        ed.effects = F.applyFlavor(fx(), key);
        renderAll();
        B.toast(`${f.label} applied. Fine-tune it below.`);
      };
      box.appendChild(b);
    }
  }

  // Any manual change makes the style custom.
  const touched = () => { fx().flavor = 'custom'; renderFlavors(); };

  // ---------- transitions ----------

  fillOptions($('trType'), F.TRANSITIONS);
  $('trType').onchange = (e) => { fx().transition.type = e.target.value; touched(); renderStyle(); B.refresh(); };
  $('trDur').oninput = (e) => {
    fx().transition.duration = Number(e.target.value);
    $('trDurOut').textContent = `${Number(e.target.value).toFixed(2)} s`;
  };
  $('trDur').onchange = () => { touched(); renderStyle(); B.refresh(); };
  $('trFadeEnds').onchange = (e) => { fx().transition.fadeEnds = e.target.checked; touched(); };

  // ---------- border ----------

  fillOptions($('bdStyle'), F.BORDERS);
  $('bdStyle').onchange = (e) => { fx().border.style = e.target.value; touched(); renderStyle(); };
  $('bdColor').oninput = (e) => { fx().border.color = e.target.value; renderPreview(); };
  $('bdColor2').oninput = (e) => { fx().border.color2 = e.target.value; renderPreview(); };
  $('bdColor').onchange = touched;
  $('bdColor2').onchange = touched;
  $('bdSize').oninput = (e) => { fx().border.size = Number(e.target.value); $('bdSizeOut').textContent = `${e.target.value}%`; renderPreview(); };
  $('bdSize').onchange = touched;

  // ---------- look ----------

  const LOOK_SLIDERS = [
    ['lkSat', 'saturation', pct], ['lkCon', 'contrast', pct], ['lkBri', 'brightness', signed],
    ['lkWarm', 'warmth', signed], ['lkGrain', 'grain', pct],
  ];
  for (const [id, key, show] of LOOK_SLIDERS) {
    $(id).oninput = (e) => { fx().look[key] = Number(e.target.value); $(`${id}Out`).textContent = show(Number(e.target.value)); renderPreview(); };
    $(id).onchange = touched;
  }
  for (const [id, key] of [['lkVignette', 'vignette'], ['lkLetterbox', 'letterbox'], ['lkSharpen', 'sharpen'], ['lkVhs', 'vhs']]) {
    $(id).onchange = (e) => { fx().look[key] = e.target.checked; touched(); renderPreview(); };
  }
  $('lookReset').onclick = () => { fx().look = { ...F.DEFAULT_LOOK }; touched(); renderStyle(); };

  function renderStyle() {
    const e = fx();
    $('trType').value = e.transition.type;
    $('trDur').value = e.transition.duration;
    $('trDurOut').textContent = `${Number(e.transition.duration).toFixed(2)} s`;
    $('trFadeEnds').checked = !!e.transition.fadeEnds;
    const n = ed.clips.length;
    const used = window.TimelineMath.transitionLength(ed.clips, e.transition);
    $('trHint').textContent = e.transition.type === 'none'
      ? 'Clips are joined with straight cuts.'
      : n < 2 ? 'Add two or more clips on the Cut tab to see transitions between them.'
        : `${n - 1} transition${n > 2 ? 's' : ''} of ${used.toFixed(2)} s${used < e.transition.duration - 0.01 ? ' (shortened to fit your shortest clip)' : ''}.`;
    $('bdStyle').value = e.border.style;
    $('bdColor').value = e.border.color;
    $('bdColor2').value = e.border.color2;
    $('bdSize').value = e.border.size;
    $('bdSizeOut').textContent = `${e.border.size}%`;
    $('bdColors').classList.toggle('hidden', ['none', 'rainbow'].includes(e.border.style));
    $('bdColor2Field').classList.toggle('hidden', e.border.style !== 'gradient');
    for (const [id, key, show] of LOOK_SLIDERS) {
      $(id).value = e.look[key];
      $(`${id}Out`).textContent = show(e.look[key]);
    }
    $('lkVignette').checked = !!e.look.vignette;
    $('lkLetterbox').checked = !!e.look.letterbox;
    $('lkSharpen').checked = !!e.look.sharpen;
    $('lkVhs').checked = !!e.look.vhs;
    renderPreview();
  }

  // ---------- text ----------

  let textSeq = 0;
  $('addText').onclick = () => {
    if (!ed.file) return;
    const now = B.outputNow();
    const total = B.outputDuration();
    if (now === null) { B.toast('Move the playhead inside one of your clips first.', true); return; }
    const start = Math.max(0, Math.min(now, total - 0.5));
    fx().texts.push({
      id: ++textSeq, text: 'Your text', start, end: Math.min(total, start + 4),
      position: 'bottom', size: 'l', ...fx().textStyle,
    });
    renderTexts();
    const inputs = document.querySelectorAll('#textItems textarea');
    inputs[inputs.length - 1]?.select();
  };

  function textRow(t, i) {
    const el = document.createElement('div');
    el.className = 'text-item';
    el.innerHTML = `
      <div class="row"><textarea rows="2"></textarea><button class="btn icon" data-a="del" title="Remove">✕</button></div>
      <div class="row two">
        <label class="field"><span>Show from</span><div class="row"><input type="text" data-k="start"><button class="btn icon" data-a="start" title="Use playhead">⌖</button></div></label>
        <label class="field"><span>Until</span><div class="row"><input type="text" data-k="end"><button class="btn icon" data-a="end" title="Use playhead">⌖</button></div></label>
      </div>
      <div class="row two">
        <label class="field"><span>Position</span><select data-k="position"></select></label>
        <label class="field"><span>Size</span><select data-k="size"></select></label>
      </div>
      <div class="row two">
        <label class="field"><span>Font</span><select data-k="font"></select></label>
        <label class="field"><span>Animation</span><select data-k="animation"></select></label>
      </div>
      <div class="row">
        <input type="color" data-k="color" title="Text color">
        <label class="check small"><input type="checkbox" data-k="box"> Background box</label>
      </div>`;
    const ta = el.querySelector('textarea');
    ta.value = t.text;
    ta.oninput = () => { t.text = ta.value; renderPreview(); };
    fillOptions(el.querySelector('[data-k=position]'), F.POSITIONS);
    fillOptions(el.querySelector('[data-k=size]'), [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Huge']]);
    fillOptions(el.querySelector('[data-k=font]'), Object.entries(F.FONTS).map(([k, v]) => [k, v.label]));
    fillOptions(el.querySelector('[data-k=animation]'), F.TEXT_ANIMATIONS);
    for (const k of ['position', 'size', 'font', 'animation']) {
      const sel = el.querySelector(`[data-k=${k}]`);
      sel.value = t[k];
      sel.onchange = () => { t[k] = sel.value; renderPreview(); };
    }
    const color = el.querySelector('[data-k=color]');
    color.value = t.color;
    color.oninput = () => { t.color = color.value; renderPreview(); };
    const box = el.querySelector('[data-k=box]');
    box.checked = !!t.box;
    box.onchange = () => { t.box = box.checked; renderPreview(); };
    for (const k of ['start', 'end']) {
      const input = el.querySelector(`[data-k=${k}]`);
      input.value = fmt(t[k]);
      input.onchange = () => {
        const v = window.TimelineMath.parseTime(input.value, ed.file?.fps || 30);
        if (v !== null) t[k] = Math.max(0, v);
        if (t.end <= t.start) t.end = t.start + 1;
        renderTexts();
      };
      el.querySelector(`[data-a=${k}]`).onclick = () => {
        const now = B.outputNow();
        if (now === null) { B.toast('The playhead is outside your clips.', true); return; }
        t[k] = now;
        if (t.end <= t.start) { if (k === 'start') t.end = t.start + 2; else t.start = Math.max(0, t.end - 2); }
        renderTexts();
      };
    }
    el.querySelector('[data-a=del]').onclick = () => { fx().texts.splice(i, 1); renderTexts(); };
    return el;
  }

  function renderTexts() {
    const box = $('textItems');
    box.innerHTML = '';
    fx().texts.forEach((t, i) => box.appendChild(textRow(t, i)));
    renderPreview();
  }

  // ---------- logo ----------

  fillOptions($('logoPos'), F.POSITIONS);
  $('pickLogo').onclick = async () => {
    const p = await window.api.edit.pickImage();
    if (!p) return;
    fx().logo = { path: p, name: p.split(/[\\/]/).pop(), position: 'top-right', scale: 15, opacity: 0.9 };
    renderLogo();
  };
  $('removeLogo').onclick = () => { fx().logo = null; renderLogo(); };
  $('logoPos').onchange = (e) => { fx().logo.position = e.target.value; renderPreview(); };
  $('logoScale').oninput = (e) => { fx().logo.scale = Number(e.target.value); $('logoScaleOut').textContent = `${e.target.value}%`; renderPreview(); };
  $('logoOpacity').oninput = (e) => { fx().logo.opacity = Number(e.target.value); $('logoOpacityOut').textContent = pct(e.target.value); renderPreview(); };

  function renderLogo() {
    const l = fx().logo;
    $('logoBox').classList.toggle('hidden', !l);
    $('pickLogo').textContent = l ? 'Replace…' : 'Add image…';
    if (l) {
      $('logoName').textContent = l.name;
      $('logoPos').value = l.position;
      $('logoScale').value = l.scale;
      $('logoScaleOut').textContent = `${l.scale}%`;
      $('logoOpacity').value = l.opacity;
      $('logoOpacityOut').textContent = pct(l.opacity);
      $('fxLogo').src = `media://local/${encodeURIComponent(l.path)}`;
    }
    renderPreview();
  }

  // ---------- live preview ----------

  /** The rectangle the video actually occupies inside the player (object-fit: contain). */
  function contentRect() {
    const pw = $('player').clientWidth;
    const ph = $('player').clientHeight;
    const vw = ed.file?.width || 16;
    const vh = ed.file?.height || 9;
    const scale = Math.min(pw / vw, ph / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { x: (pw - w) / 2, y: (ph - h) / 2, w, h };
  }

  function placeAt(el, pos, marginX, marginY) {
    el.style.left = el.style.right = el.style.top = el.style.bottom = '';
    el.style.transform = '';
    if (pos.endsWith('left')) el.style.left = marginX;
    else if (pos.endsWith('right')) el.style.right = marginX;
    else { el.style.left = '50%'; el.style.transform = 'translateX(-50%)'; }
    if (pos.startsWith('top')) el.style.top = marginY.top;
    else if (pos === 'center') { el.style.top = '50%'; el.style.transform += ' translateY(-50%)'; }
    else el.style.bottom = marginY.bottom;
  }

  function renderPreview() {
    const e = fx();
    const l = e.look;
    const r = contentRect();
    const ov = $('fxOverlay');
    Object.assign(ov.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });

    const filters = [`saturate(${l.saturation})`, `contrast(${l.contrast})`, `brightness(${1 + l.brightness})`];
    if (l.warmth > 0) filters.push(`sepia(${l.warmth * 0.3})`);
    if (l.warmth < 0) filters.push(`hue-rotate(${l.warmth * 12}deg)`);
    if (l.vhs) filters.push('blur(0.6px)');
    video.style.filter = filters.join(' ');

    $('fxVignette').style.display = l.vignette ? 'block' : 'none';
    $('fxLbTop').style.display = $('fxLbBottom').style.display = l.letterbox ? 'block' : 'none';
    ov.classList.toggle('vhs', !!l.vhs);
    ov.classList.toggle('grain', l.grain > 0);
    ov.style.setProperty('--grain', String(Math.min(1, l.grain) * 0.35));

    const bd = $('fxBorder');
    bd.className = `fx-border ${e.border.style}`;
    const px = (r.h * e.border.size) / 100;
    bd.style.borderWidth = `${px}px`;
    bd.style.setProperty('--c1', e.border.color);
    bd.style.setProperty('--c2', e.border.color2);
    bd.style.display = e.border.style === 'none' ? 'none' : 'block';

    const logo = $('fxLogo');
    if (e.logo) {
      logo.style.display = 'block';
      logo.style.width = `${(r.w * e.logo.scale) / 100}px`;
      logo.style.opacity = e.logo.opacity;
      placeAt(logo, e.logo.position, '3%', { top: '4%', bottom: '5%' });
    } else {
      logo.style.display = 'none';
    }
    renderTextPreview();
  }

  function renderTextPreview() {
    const box = $('fxTexts');
    const r = contentRect();
    const now = B.outputNow();
    box.innerHTML = '';
    for (const t of fx().texts) {
      if (now === null || now < t.start || now > t.end || !t.text.trim()) continue;
      const d = document.createElement('div');
      d.className = `fx-text${t.box ? ' boxed' : ''}`;
      d.textContent = t.text;
      const size = r.h * (F.TEXT_SIZES[t.size] || F.TEXT_SIZES.m);
      d.style.fontSize = `${size}px`;
      d.style.fontFamily = F.FONTS[t.font]?.css || 'sans-serif';
      d.style.color = t.color;
      d.style.padding = t.box ? `${size * 0.2}px ${size * 0.35}px` : '0';
      const ramp = Math.min(0.4, (t.end - t.start) / 3);
      let alpha = 1;
      let shift = 0;
      if (t.animation !== 'none') alpha = Math.max(0, Math.min(1, (now - t.start) / ramp, (t.end - now) / ramp));
      if (t.animation === 'slide') shift = r.h * 0.06 * Math.max(0, 1 - (now - t.start) / 0.5);
      if (t.animation === 'drop') shift = -r.h * 0.12 * Math.max(0, 1 - (now - t.start) / 0.45);
      d.style.opacity = alpha;
      placeAt(d, t.position || 'bottom', '5%', { top: '8%', bottom: '9%' });
      d.style.marginTop = `${shift}px`;
      d.style.marginBottom = `${-shift}px`;
      box.appendChild(d);
    }
  }

  function renderAll() {
    renderFlavors();
    renderStyle();
    renderTexts();
    renderLogo();
    B.refresh();
  }

  // Keep text in step with playback and the overlay sized with the player.
  (function loop() {
    if (ed.file && fx().texts.length) renderTextPreview();
    requestAnimationFrame(loop);
  }());
  new ResizeObserver(renderPreview).observe($('player'));
  video.addEventListener('loadedmetadata', renderPreview);
  document.addEventListener('editor-file', renderAll);
  renderAll();
});

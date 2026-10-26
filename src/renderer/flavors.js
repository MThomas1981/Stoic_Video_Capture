// Style presets ("flavor packs") and option lists shared by the editor UI and
// the export builder. Loaded as window.Flavors in the browser.

(function (root) {
  const DEFAULT_LOOK = {
    saturation: 1, contrast: 1, brightness: 0, warmth: 0,
    vignette: false, grain: 0, letterbox: false, sharpen: false, vhs: false,
  };

  const DEFAULT_EFFECTS = {
    flavor: 'clean',
    look: { ...DEFAULT_LOOK },
    border: { style: 'none', color: '#4ade80', color2: '#3b82f6', size: 3 },
    transition: { type: 'none', duration: 0.6, fadeEnds: false },
    textStyle: { font: 'bold', color: '#ffffff', box: true, animation: 'fade' },
    texts: [],
    logo: null,
  };

  const TRANSITIONS = [
    ['none', 'Cut (no transition)'], ['fade', 'Crossfade'], ['dissolve', 'Dissolve'],
    ['fadeblack', 'Dip to black'], ['fadewhite', 'Flash to white'], ['wipeleft', 'Wipe left'],
    ['wiperight', 'Wipe right'], ['slideleft', 'Slide left'], ['slideright', 'Slide right'],
    ['slideup', 'Slide up'], ['smoothleft', 'Smooth slide'], ['circleopen', 'Circle open'],
    ['circleclose', 'Circle close'], ['radial', 'Radial sweep'], ['zoomin', 'Zoom in'],
    ['pixelize', 'Pixelize'], ['hblur', 'Blur'], ['squeezev', 'Squeeze'], ['diagtl', 'Diagonal'],
    ['random', 'Mix it up (random)'],
  ];
  const RANDOM_POOL = ['fade', 'wipeleft', 'slideleft', 'circleopen', 'zoomin', 'pixelize', 'radial', 'smoothleft'];

  const BORDERS = [
    ['none', 'None'], ['solid', 'Solid color'], ['rainbow', 'Rainbow cycle'],
    ['pulse', 'Pulse'], ['gradient', 'Gradient flow'],
  ];

  const FONTS = {
    bold: { label: 'Bold', css: '"Arial Black", Arial, sans-serif', win: 'arialbd.ttf', linux: 'DejaVuSans-Bold.ttf' },
    impact: { label: 'Impact', css: 'Impact, "Arial Black", sans-serif', win: 'impact.ttf', linux: 'DejaVuSansCondensed-Bold.ttf' },
    serif: { label: 'Serif', css: 'Georgia, serif', win: 'georgiab.ttf', linux: 'DejaVuSerif-Bold.ttf' },
    mono: { label: 'Mono', css: 'Consolas, monospace', win: 'consolab.ttf', linux: 'DejaVuSansMono-Bold.ttf' },
  };

  const TEXT_SIZES = { s: 0.045, m: 0.065, l: 0.09, xl: 0.13 };
  const POSITIONS = [
    ['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom'], ['top-left', 'Top left'],
    ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'],
  ];
  const TEXT_ANIMATIONS = [['none', 'None'], ['fade', 'Fade'], ['slide', 'Slide up'], ['drop', 'Drop in']];

  const FLAVORS = {
    clean: {
      label: 'Clean', blurb: 'No styling, just your footage.',
      look: {}, border: { style: 'none' }, transition: { type: 'none', fadeEnds: false },
      textStyle: { font: 'bold', color: '#ffffff', box: true, animation: 'fade' },
      swatch: ['#2a2f3a', '#8b93a3'],
    },
    neon: {
      label: 'Neon Arcade', blurb: 'Punchy colors, rainbow frame, pixel transitions.',
      look: { saturation: 1.35, contrast: 1.12, brightness: 0.02, sharpen: true },
      border: { style: 'rainbow', size: 2.5 }, transition: { type: 'pixelize', duration: 0.5, fadeEnds: false },
      textStyle: { font: 'impact', color: '#4ade80', box: false, animation: 'drop' },
      swatch: ['#f0abfc', '#22d3ee'],
    },
    cinematic: {
      label: 'Cinematic', blurb: 'Warm grade, letterbox, grain, slow fades.',
      look: { saturation: 0.95, contrast: 1.08, warmth: 0.35, vignette: true, letterbox: true, grain: 0.15 },
      border: { style: 'none' }, transition: { type: 'fadeblack', duration: 0.8, fadeEnds: true },
      textStyle: { font: 'serif', color: '#f5f0e6', box: false, animation: 'fade' },
      swatch: ['#f59e0b', '#1f2937'],
    },
    vhs: {
      label: 'Retro VHS', blurb: 'Washed tape look with color bleed and noise.',
      look: { saturation: 0.85, contrast: 1.05, vhs: true, grain: 0.4 },
      border: { style: 'none' }, transition: { type: 'hblur', duration: 0.4, fadeEnds: true },
      textStyle: { font: 'mono', color: '#ffffff', box: true, animation: 'none' },
      swatch: ['#fb7185', '#38bdf8'],
    },
    esports: {
      label: 'Esports', blurb: 'High contrast, red pulse frame, fast slides.',
      look: { saturation: 1.25, contrast: 1.15, sharpen: true },
      border: { style: 'pulse', color: '#ef4444', size: 2 }, transition: { type: 'slideleft', duration: 0.35, fadeEnds: false },
      textStyle: { font: 'impact', color: '#ffffff', box: true, animation: 'slide' },
      swatch: ['#ef4444', '#111827'],
    },
    chill: {
      label: 'Chill', blurb: 'Soft and warm with a drifting gradient frame.',
      look: { saturation: 0.9, contrast: 0.95, brightness: 0.03, warmth: 0.25 },
      border: { style: 'gradient', color: '#a78bfa', color2: '#60a5fa', size: 3 },
      transition: { type: 'dissolve', duration: 1, fadeEnds: true },
      textStyle: { font: 'serif', color: '#ffffff', box: false, animation: 'fade' },
      swatch: ['#a78bfa', '#60a5fa'],
    },
  };

  /** Returns new effects with a flavor applied; texts and logo are kept. */
  function applyFlavor(effects, key) {
    const f = FLAVORS[key] || FLAVORS.clean;
    const textStyle = { ...DEFAULT_EFFECTS.textStyle, ...f.textStyle };
    return {
      ...effects,
      flavor: key,
      look: { ...DEFAULT_LOOK, ...f.look },
      border: { ...DEFAULT_EFFECTS.border, ...f.border },
      transition: { ...DEFAULT_EFFECTS.transition, ...f.transition },
      textStyle,
      texts: (effects.texts || []).map((t) => ({ ...t, ...textStyle })),
    };
  }

  const api = {
    DEFAULT_LOOK, DEFAULT_EFFECTS, TRANSITIONS, RANDOM_POOL, BORDERS, FONTS, TEXT_SIZES,
    POSITIONS, TEXT_ANIMATIONS, FLAVORS, applyFlavor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Flavors = api;
})(typeof window !== 'undefined' ? window : globalThis);

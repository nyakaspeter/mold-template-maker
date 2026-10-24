// The settings: their definitions, the sidebar controls, and which values the browser remembers.
import { $ } from './dom.js';
import { S } from './state.js';
import { t } from './i18n.js';

// Grouped by what you decide: how the picture is read, what the object is, the mold template; the rarely needed
// sliders are under Fine-tuning. fresh: starts from its default with every new file (the rest is remembered).
// hide: picture types or methods it means nothing for (its preset value there is 0).
// only: 'file' = once any file is loaded; before that only what applies to every file and is kept shows.
export const PARAMS = [
  { g: 'picture', storageKey: 'Picture', only: 'image' },
  { id: 'picType', label: 'pictureType', type: 'select', val: 'auto', only: 'image', fresh: true,
    options: [['auto', 'auto'], ['photo', 'photo'], ['render', 'render3d'], ['painting', 'painting'], ['flat', 'flatCartoon'],
      ['lineart', 'lineArt'], ['heightmap', 'heightMap']],
    hint: 'pictureTypeHelp' },
  // 4 also estimates the surface: pictures are then sculpted ('sculpt' instead of 'ai' or 'cartoon', see app.js)
  { id: 'depthModel', label: 'depthModel', type: 'select', val: 'auto', only: 'image', modes: 'ai cartoon sculpt',
    options: [['auto', 'auto'], ['1', 'depthSmall'], ['4', 'mogeSmall']],
    hint: 'depthModelHelp' },

  { g: 'object', storageKey: 'Object' },
  { id: 'stlUp', label: 'orientation', type: 'orient', val: 'auto', only: 'stl', fresh: true,
    hint: 'orientationHelp' },
  { id: 'width', label: 'objectWidth', unit: 'mm', min: 10, max: 250, step: 1, val: 80, only: 'image' },
  { id: 'scale', label: 'scale', unit: '%', min: 10, max: 400, step: 5, val: 100, only: 'stl' },
  { id: 'split', label: 'split', type: 'select', val: 'auto', only: 'stl', fresh: true,
    options: [['auto', 'auto'], ['yes', 'yes'], ['no', 'no']],
    hint: 'splitHelp' },
  { id: 'splitAt', label: 'cutHeight', unit: '%', min: 5, max: 95, step: 1, val: 50, only: 'stl', modes: 'split split-pins', fresh: true,
    hint: 'cutHeightHelp' },
  { id: 'pins', label: 'pins', unit: '', min: 0, max: 10, step: 1, val: 0, only: 'stl', modes: 'split split-pins',
    hint: 'pinsHelp' },
  { id: 'pinD', label: 'pinDiameter', unit: 'mm', min: 1.5, max: 8, step: 0.5, val: 3, only: 'stl', modes: 'split-pins',
    hint: 'pinDiameterHelp' },
  { id: 'reliefH', label: 'depthRange', unit: 'mm', min: 0, max: 25, step: 0.5, val: 3, only: 'image', fresh: true,
    hint: 'depthRangeHelp' },
  { id: 'flatten', label: 'flattening', unit: '', min: 0, max: 1, step: 0.05, val: 0.6, only: 'image', modes: 'sculpt', fresh: true,
    hint: 'flatteningHelp' },
  { id: 'stepH', label: 'overlapSteps', unit: 'mm', min: 0, max: 3, step: 0.1, val: 0.6, only: 'image', modes: 'sculpt', fresh: true,
    hint: 'overlapStepsHelp' },
  // the finest detail needs the graphics card (depth.js)
  { id: 'fineDetail', label: 'fineDetail', unit: '', min: 0, max: 3, step: 0.1, val: 1, only: 'image', modes: 'sculpt-gpu', fresh: true,
    hint: 'fineDetailHelp' },
  // each colour area's cushion; for shaded pictures the rim's roundness follows Edge rounding (see app.js)
  { id: 'puff', label: 'roundness', unit: 'mm', min: 0, max: 10, step: 0.25, val: 2, only: 'image', modes: 'cartoon', fresh: true,
    hint: 'roundnessHelp' },
  // a photo has no drawn lines, and in a height map the dark parts are deep, not strokes
  { id: 'lineDepth', label: 'lineGrooves', unit: 'mm', min: 0, max: 3, step: 0.1, val: 0.5, only: 'image', hide: 'photo heightmap', fresh: true,
    hint: 'lineGroovesHelp' },
  // not for STLs cut in two: the halves are glued back to back, so a plate or rim would end up in the seam
  { id: 'backT', label: 'backThickness', unit: 'mm', min: 0, max: 20, step: 0.5, val: 2, only: 'file', modes: 'ai sculpt cartoon bright whole',
    hint: 'backThicknessHelp' },
  { id: 'border', label: 'flatBorder', unit: 'mm', min: 0, max: 20, step: 0.5, val: 0, only: 'file', modes: 'ai sculpt cartoon bright whole',
    hint: 'flatBorderHelp' },

  { g: 'moldTemplate', storageKey: 'Mold template' },
  { id: 'gap', label: 'siliconeRim', unit: 'mm', min: 1, max: 25, step: 0.5, val: 3, hint: 'siliconeRimHelp' },
  { id: 'over', label: 'siliconeAbove', unit: 'mm', min: 1, max: 15, step: 0.5, val: 4, hint: 'siliconeAboveHelp' },
  { id: 'wallT', label: 'wallThickness', unit: 'mm', min: 0.8, max: 6, step: 0.2, val: 2, hint: 'wallThicknessHelp' },
  { id: 'baseT', label: 'baseThickness', unit: 'mm', min: 0.8, max: 6, step: 0.2, val: 2, hint: 'baseThicknessHelp' },

  { g: 'fineTuning', storageKey: 'Fine-tuning' },
  // reversed: the value is the cell size, so the slider runs from coarse (left) to fine (right)
  { id: 'res', label: 'detail', unit: 'mm', min: 0.1, max: 1, step: 0.05, val: 0.2, reverse: true,
    hint: 'detailHelp' },
  // colour: only for the colour outline (not for an AI cut-out or a picture with its own transparency, see app.js)
  { id: 'gapClose', label: 'closeGaps', colour: true, unit: 'mm', min: 0, max: 5, step: 0.1, val: 0.5, only: 'image', fresh: true,
    hint: 'closeGapsHelp' },
  { id: 'maskSmooth', label: 'outlineSmoothing', unit: 'mm', min: 0, max: 3, step: 0.1, val: 0.2, only: 'file', fresh: true,
    hint: 'outlineSmoothingHelp' },
  // how finely a drawing splits into colour areas: colour tolerance and texture smoothing together (see app.js)
  { id: 'areaDetail', label: 'colourAreas', unit: '', min: 0, max: 10, step: 0.5, val: 8, only: 'image', modes: 'cartoon', fresh: true,
    hint: 'colourAreasHelp' },
  // a photo's colour edges are light and surface colour; a height map has none; in line art they are the strokes'
  // sides, which Line grooves already carves
  { id: 'edgeDepth', label: 'colourGrooves', unit: 'mm', min: 0, max: 2, step: 0.1, val: 0, only: 'image', hide: 'photo heightmap lineart', fresh: true,
    hint: 'colourGroovesHelp' },
  // brightness copied as texture: in a height map brightness is the height already, and MoGe's Fine detail adds the
  // real shape detail instead
  { id: 'detail', label: 'surfaceDetail', unit: 'mm', min: 0, max: 2, step: 0.1, val: 0, only: 'image', hide: 'heightmap sculpt', fresh: true,
    hint: 'surfaceDetailHelp' },
  { id: 'gamma', label: 'reliefCurve', unit: '', min: 0.3, max: 3, step: 0.05, val: 1, only: 'image', modes: 'ai bright', fresh: true,
    hint: 'reliefCurveHelp' },
  // cut STL halves are the model itself, not a height map, so there is no relief to smooth
  { id: 'reliefSmooth', label: 'reliefSmoothing', unit: 'mm', min: 0, max: 3, step: 0.05, val: 0.1, only: 'file', modes: 'ai sculpt cartoon bright whole', fresh: true,
    hint: 'reliefSmoothingHelp' },
  { id: 'edgeSoft', label: 'edgeRounding', unit: 'mm', min: 0, max: 6, step: 0.1, val: 1, only: 'image', modes: 'ai sculpt bright', fresh: true,
    hint: 'edgeRoundingHelp' },
];
export const GEOMETRY_MODELS = ['4']; // the Depth model choices that estimate the surface (js/depth.js GEOMETRY)
export const DEFAULTS = {
  image: { backT: 2, border: 0 },
  stl: { backT: 0, border: 0, reliefSmooth: 0, maskSmooth: 0.4 },
};

// Remembered in this browser: settings that don't start fresh with each file (sizes, the mold template, the pins,
// the depth model) and which sections are open. Settings whose default differs between images and STLs are kept per
// file type.
export const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: not remembered */ } },
};
export const kept = (d) => d.id && !d.fresh;
export const perKind = (d) => d.id in DEFAULTS.image || d.id in DEFAULTS.stl;
export function savedValue(d, kind) {
  const saved = store.get('settings', {}), v = perKind(d) ? saved[kind]?.[d.id] : saved[d.id];
  // nothing remembered, or a value that no longer fits the setting (it has changed since): the default
  const fits = d.options ? d.options.some(([o]) => o === v) : typeof v === (d.type === 'check' ? 'boolean' : 'number');
  return fits ? v : DEFAULTS[kind]?.[d.id] ?? d.val;
}
export function saveSetting(d) {
  if (!kept(d)) return;
  const saved = store.get('settings', {}), v = readParams()[d.id];
  if (perKind(d)) (saved[shownKind] ||= {})[d.id] = v; else saved[d.id] = v;
  store.set('settings', saved);
}

// onChange runs after any setting is changed or reset
export function buildControls(onChange) {
  const root = $('#controls');
  root.innerHTML = '';
  let sec = null;
  for (const d of PARAMS) {
    if (d.g) {
      const det = document.createElement('details');
      det.open = store.get('sections', {})[d.storageKey] ?? true; // all sections start open
      if (d.only) det.dataset.only = d.only;
      det.innerHTML = `<summary>${t(d.g)}</summary><div class="body"></div>`;
      // remember only what you open or close yourself (summary clicks, also from the keyboard)
      det.querySelector('summary').addEventListener('click', () => setTimeout(() => {
        const o = store.get('sections', {}); o[d.storageKey] = det.open; store.set('sections', o);
      }));
      root.appendChild(det);
      sec = det.querySelector('.body');
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctl' + (d.type === 'check' ? ' check' : '');
    if (d.only) el.dataset.only = d.only;
    if (d.modes) el.dataset.modes = d.modes;
    if (d.colour) el.dataset.colour = '';
    if (d.hide) el.dataset.hide = d.hide;
    // the description sits behind an ⓘ after the name and shows as a tooltip
    const info = d.hint ? `<span class="info" tabindex="0" aria-label="${t(d.hint).replace(/"/g, '&quot;')}">i</span>` : '';
    if (d.type === 'check') {
      el.innerHTML = `<label><input type="checkbox" id="p-${d.id}" ${d.val ? 'checked' : ''}> ${t(d.label)}</label>${info}`;
    } else if (d.type === 'orient') { // a small 3D view of the model (js/orient.js); the value sits in a hidden input
      el.innerHTML = `<div class="lab"><span>${t(d.label)}${info}</span><span class="val">
        <button class="reset" title="${t('resetAuto')}" aria-label="${t('resetAuto')}">↺</button></span></div>
        <div class="orientBox" id="box-${d.id}"></div><input type="hidden" id="p-${d.id}" value="${d.val}">`;
      el.querySelector('.reset').onclick = () => { setParam(d.id, 'auto'); onChange(d.id); };
    } else if (d.type === 'select') {
      el.innerHTML = `<div class="lab"><span>${t(d.label)}${info}</span></div><select id="p-${d.id}" autocomplete="off">` +
        d.options.map(([v, text]) => `<option value="${v}" ${v === d.val ? 'selected' : ''}>${t(text)}</option>`).join('') + `</select>`;
    } else {
      el.innerHTML = `<div class="lab"><span>${t(d.label)}${info}</span><span class="val">
        <button class="reset" title="${t('resetDefault')}" aria-label="${t('resetSetting', { label: t(d.label) })}">↺</button><output id="o-${d.id}"></output></span></div>
        <input type="range" id="p-${d.id}" min="${d.min}" max="${d.max}" step="${d.step}" value="${slider(d, d.val)}" autocomplete="off">`;
      el.querySelector('.reset').onclick = () => { setParam(d.id, defaultOf(d)); saveSetting(d); onChange(d.id); };
    }
    if (d.hint) {
      const tip = document.createElement('div');
      tip.className = 'tip'; tip.textContent = t(d.hint);
      el.appendChild(tip);
    }
    sec.appendChild(el);
    const input = el.querySelector('input,select');
    if (input.type === 'range') {
      let keyboard = false, dirty = false;
      const commit = () => {
        if (!dirty) return;
        dirty = false; saveSetting(d); onChange(d.id);
      };
      input.addEventListener('input', () => { dirty = true; showValue(d); });
      input.addEventListener('change', () => { if (!keyboard) commit(); });
      input.addEventListener('keydown', (e) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) keyboard = true;
      });
      input.addEventListener('keyup', () => { if (keyboard) { keyboard = false; commit(); } });
      input.addEventListener('blur', () => { keyboard = false; commit(); });
    } else input.addEventListener('input', () => { showValue(d); saveSetting(d); onChange(d.id); });
    showValue(d);
  }
}
// a reversed slider's position for a value, and its value for a position (the same mirror both ways)
const slider = (d, v) => (d.reverse ? Math.round((d.min + d.max - v) * 1e6) / 1e6 : v);
export const defaultOf = (d) => (S.auto && d.id in S.auto ? S.auto[d.id] : DEFAULTS[shownKind]?.[d.id] ?? d.val);
// the Reset all button shows while any setting is away from its default
function showResetAll() {
  const btn = $('#resetAll');
  if (!btn || PARAMS.some((d) => d.id && !$('#p-' + d.id))) return; // the panel is still being built
  const p = readParams();
  btn.classList.toggle('on', PARAMS.some((d) => d.id && (d.type === 'select' || d.type === 'orient' ? p[d.id] !== d.val : Math.abs(p[d.id] - defaultOf(d)) > 1e-9)));
}
export function showValue(d) {
  showResetAll();
  if (d.type === 'orient') { // only the reset button, when turned away from Auto
    $('#p-' + d.id).closest('.ctl').classList.toggle('changed', $('#p-' + d.id).value !== 'auto');
    return;
  }
  const o = $('#o-' + d.id);
  if (!o) return;
  const v = slider(d, parseFloat($('#p-' + d.id).value));
  o.textContent = `${v}${d.unit ? ' ' + d.unit : ''}`;
  o.closest('.ctl').classList.toggle('changed', Math.abs(v - defaultOf(d)) > 1e-9);
}
export function setParam(id, v) {
  const el = $('#p-' + id), d = PARAMS.find((x) => x.id === id);
  if (el.type === 'checkbox') el.checked = v; else el.value = el.type === 'range' ? slider(d, v) : v;
  showValue(d);
}
export function readParams() {
  const p = {};
  for (const d of PARAMS) {
    if (!d.id) continue;
    const el = $('#p-' + d.id);
    p[d.id] = d.type === 'check' ? el.checked : d.type === 'select' || d.type === 'orient' ? el.value : slider(d, parseFloat(el.value));
  }
  return p;
}
export let shownKind = 'image';
export function showFor(kind = shownKind) {
  shownKind = kind;
  for (const d of PARAMS) if (d.id) showValue(d); // defaults differ per kind
  // until a file is loaded, only settings that apply to every file show (only: 'file' = any loaded file)
  // a mode can also be named with the processor it runs on, e.g. 'sculpt-gpu'
  const modes = [S.method, `${S.method}-${S.gpu ? 'gpu' : 'cpu'}`], loaded = S.kind ? kind : null;
  const hidden = [S.method, S.kind === 'image' ? S.type : null];
  document.querySelectorAll('[data-only], [data-modes]').forEach((el) => {
    const only = el.dataset.only;
    const ok = (!only || only === loaded || (only === 'file' && loaded)) && (!el.dataset.modes || el.dataset.modes.split(' ').some((m) => modes.includes(m))) &&
      !(el.dataset.colour !== undefined && (S.aiCutout || S.transparent)) &&
      !(el.dataset.hide && el.dataset.hide.split(' ').some((h) => hidden.includes(h)));
    el.style.display = ok ? '' : 'none';
  });
  // a section whose settings are all hidden is hidden too
  document.querySelectorAll('#controls details').forEach((det) => {
    if (det.dataset.only && det.style.display === 'none') return; // hidden for this kind of file
    det.style.display = [...det.querySelectorAll('.ctl')].some((c) => c.style.display !== 'none') ? '' : 'none';
  });
}

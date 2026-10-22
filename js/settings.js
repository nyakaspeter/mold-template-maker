// The settings: their definitions, the sidebar controls, and which values the browser remembers.
import { $ } from './dom.js';
import { S } from './state.js';
import { t } from './i18n.js';

export const PARAMS = [
  { g: 'Size', open: true },
  { id: 'width', label: 'Object width', unit: 'mm', min: 10, max: 250, step: 1, val: 80, only: 'image' },
  { id: 'scale', label: 'Scale', unit: '%', min: 10, max: 400, step: 5, val: 100, only: 'stl' },
  { id: 'stlUp', label: 'Which side faces up', type: 'select', val: 'z', only: 'stl',
    options: [['z', '+Z (normal)'], ['-z', '−Z (upside down)'], ['y', '+Y'], ['-y', '−Y'], ['x', '+X'], ['-x', '−X']] },
  { id: 'res', label: 'Detail (cell size)', unit: 'mm', min: 0.1, max: 1, step: 0.05, val: 0.2,
    hint: 'Smaller = finer detail, slower.' },

  { g: 'Outline', only: 'image' },
  { id: 'tol', label: 'Background tolerance', min: 5, max: 200, step: 1, val: 55,
    hint: 'Raise it if bits of background stay attached, lower it if pale parts of the figure disappear.' },
  { id: 'gapClose', label: 'Close outline gaps', unit: 'mm', min: 0, max: 5, step: 0.1, val: 0.5,
    hint: 'Bridges small breaks in an outline so the background can\'t leak in.' },
  { id: 'reopen', label: 'Open gaps between parts', unit: '', min: 0, max: 1, step: 0.05, val: 0.5, only: 'image', modes: 'ai',
    hint: 'Removes enclosed background, like the space between legs. Higher opens more, 0 keeps everything filled.' },
  { id: 'maskSmooth', label: 'Outline smoothing', unit: 'mm', min: 0, max: 3, step: 0.1, val: 0.2 },

  { g: 'Relief', open: true },
  { id: 'colorTol', label: 'Colour area tolerance', min: 4, max: 60, step: 1, val: 16, only: 'image', modes: 'cartoon',
    hint: 'Lower = more, smaller areas (more detail). Higher = merges shading.' },
  { id: 'simplify', label: 'Smooth out texture', unit: '', min: 0, max: 4, step: 1, val: 0, only: 'image', modes: 'cartoon',
    hint: 'Evens out paint texture and pencil shading before splitting into areas.' },
  { id: 'reliefH', label: 'Depth range', unit: 'mm', min: 0, max: 25, step: 0.5, val: 3, only: 'image' },
  { id: 'puff', label: 'Puff (roundness)', unit: 'mm', min: 0, max: 10, step: 0.25, val: 2, only: 'image',
    hint: 'How much each part bulges, like a cushion.' },
  { id: 'lineDepth', label: 'Line grooves', unit: 'mm', min: 0, max: 3, step: 0.1, val: 0.5, only: 'image',
    hint: 'Presses dark outlines of a drawing in as grooves.' },
  { id: 'lineDark', label: 'Line darkness', unit: '', min: 0.2, max: 0.8, step: 0.02, val: 0.38, only: 'image',
    hint: 'How dark a stroke must be to count as a line. Raise it for pencil sketches.' },
  { id: 'edgeDepth', label: 'Colour edge grooves', unit: 'mm', min: 0, max: 2, step: 0.1, val: 0, only: 'image',
    hint: 'Grooves where colours meet: eyes, mouth, stripes. For images without outlines.' },
  { id: 'detail', label: 'Surface detail', unit: 'mm', min: 0, max: 2, step: 0.1, val: 0, only: 'image',
    hint: 'Light parts slightly raised, dark parts slightly lowered.' },
  { id: 'gamma', label: 'Relief curve', unit: '', min: 0.3, max: 3, step: 0.05, val: 1, only: 'image', modes: 'ai bright',
    hint: '<1 puffs it up, >1 flattens the low parts.' },
  { id: 'reliefSmooth', label: 'Relief smoothing', unit: 'mm', min: 0, max: 3, step: 0.05, val: 0.1 },
  { id: 'edgeSoft', label: 'Edge rounding', unit: 'mm', min: 0, max: 6, step: 0.1, val: 1, only: 'image', modes: 'ai bright' },

  { g: 'Final object', open: true },
  { id: 'backT', label: 'Back thickness', unit: 'mm', min: 0, max: 20, step: 0.5, val: 2,
    hint: 'Flat-sided base under the relief.' },
  { id: 'border', label: 'Flat border around shape', unit: 'mm', min: 0, max: 20, step: 0.5, val: 0,
    hint: 'Adds a flat plaque rim around the outline.' },

  { g: 'Mold template' },
  { id: 'gap', label: 'Gap (= silicone rim width)', unit: 'mm', min: 1, max: 25, step: 0.5, val: 3 },
  { id: 'over', label: 'Silicone above highest point', unit: 'mm', min: 1, max: 15, step: 0.5, val: 4 },
  { id: 'wallT', label: 'Wall thickness', unit: 'mm', min: 0.8, max: 6, step: 0.2, val: 2 },
  { id: 'baseT', label: 'Base thickness', unit: 'mm', min: 0.8, max: 6, step: 0.2, val: 2 },
];
{ let g = ''; for (const d of PARAMS) if (d.g) g = d.g; else d.group = g; }
export const DEFAULTS = {
  image: { backT: 2, border: 0 },
  stl: { backT: 0, border: 0, reliefSmooth: 0, maskSmooth: 0.4 },
};

// Remembered in this browser: settings that don't start fresh with each file (Size, Final object, Mold template)
// and which sections are open. Settings whose default differs between images and STLs are kept per file type.
export const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: not remembered */ } },
};
export const kept = (d) => d.id && d.group !== 'Outline' && d.group !== 'Relief';
export const perKind = (d) => d.id in DEFAULTS.image || d.id in DEFAULTS.stl;
export function savedValue(d, kind) {
  const saved = store.get('settings', {}), v = perKind(d) ? saved[kind]?.[d.id] : saved[d.id];
  return v ?? DEFAULTS[kind]?.[d.id] ?? d.val;
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
      det.open = store.get('sections', {})[d.g] ?? !!d.open;
      det.addEventListener('toggle', () => { const o = store.get('sections', {}); o[d.g] = det.open; store.set('sections', o); });
      if (d.only) det.dataset.only = d.only;
      det.innerHTML = `<summary>${t(d.g)}</summary><div class="body"></div>`;
      root.appendChild(det);
      sec = det.querySelector('.body');
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctl' + (d.type === 'check' ? ' check' : '');
    if (d.only) el.dataset.only = d.only;
    if (d.modes) el.dataset.modes = d.modes;
    // the description sits behind an ⓘ after the name and shows as a tooltip
    const info = d.hint ? `<span class="info" tabindex="0" aria-label="${t(d.hint).replace(/"/g, '&quot;')}">i</span>` : '';
    if (d.type === 'check') {
      el.innerHTML = `<label><input type="checkbox" id="p-${d.id}" ${d.val ? 'checked' : ''}> ${t(d.label)}</label>`;
    } else if (d.type === 'select') {
      el.innerHTML = `<div class="lab"><span>${t(d.label)}${info}</span></div><select id="p-${d.id}" autocomplete="off">` +
        d.options.map(([v, text]) => `<option value="${v}" ${v === d.val ? 'selected' : ''}>${t(text)}</option>`).join('') + `</select>`;
    } else {
      el.innerHTML = `<div class="lab"><span>${t(d.label)}${info}</span><span class="val">
        <button class="reset" title="${t('Reset to default')}" aria-label="${t('Reset {label}', { label: t(d.label) })}">↺</button><output id="o-${d.id}"></output></span></div>
        <input type="range" id="p-${d.id}" min="${d.min}" max="${d.max}" step="${d.step}" value="${d.val}" autocomplete="off">`;
      el.querySelector('.reset').onclick = () => { setParam(d.id, defaultOf(d)); saveSetting(d); onChange(); };
    }
    if (d.hint) {
      const tip = document.createElement('div');
      tip.className = 'tip'; tip.textContent = t(d.hint);
      el.appendChild(tip);
    }
    sec.appendChild(el);
    const input = el.querySelector('input,select');
    input.addEventListener('input', () => { showValue(d); saveSetting(d); onChange(); });
    showValue(d);
  }
}
export const defaultOf = (d) => (shownKind === 'image' && S.auto && d.id in S.auto ? S.auto[d.id] : DEFAULTS[shownKind]?.[d.id] ?? d.val);
export function showValue(d) {
  const o = $('#o-' + d.id);
  if (!o) return;
  const v = parseFloat($('#p-' + d.id).value);
  o.textContent = `${v}${d.unit ? ' ' + d.unit : ''}`;
  o.closest('.ctl').classList.toggle('changed', Math.abs(v - defaultOf(d)) > 1e-9);
}
export function setParam(id, v) {
  const el = $('#p-' + id);
  if (el.type === 'checkbox') el.checked = v; else el.value = v;
  showValue(PARAMS.find((d) => d.id === id));
}
export function readParams() {
  const p = {};
  for (const d of PARAMS) {
    if (!d.id) continue;
    const el = $('#p-' + d.id);
    p[d.id] = d.type === 'check' ? el.checked : d.type === 'select' ? el.value : parseFloat(el.value);
  }
  return p;
}
export let shownKind = 'image';
export function showFor(kind = shownKind) {
  shownKind = kind;
  for (const d of PARAMS) if (d.id) showValue(d); // defaults differ per kind
  const mode = S.method;
  document.querySelectorAll('[data-only], [data-modes]').forEach((el) => {
    const ok = (!el.dataset.only || el.dataset.only === kind) && (!el.dataset.modes || el.dataset.modes.split(' ').includes(mode));
    el.style.display = ok ? '' : 'none';
  });
}

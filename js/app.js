// The app: loading files, the stages and bottom bar, rebuilding the model, and the page's languages.
import { parse3MF } from './three-mf.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { $ } from './dom.js';
import { S } from './state.js';
import { t, getLang, setLang, LANGS, FLAGS } from './i18n.js';
import { PARAMS, DEFAULTS, GEOMETRY_MODELS, store, defaultOf, kept, perKind, savedValue, buildControls, setParam, readParams, showFor } from './settings.js';
import { STYLE_PRESETS, SHADED, analyzeImage } from './style.js';
import { detectSTL } from './stl.js';
import { buildInWorker } from './build-client.js?v=3';
import { M, showModel, clearModel, fitView, requestFit, showStage, setPainted, setUpsideDown, exportStage, camera, controls } from './viewer.js';
import { initEditor, resetEditor, setEditorOutline, drawEditor } from './editor.js';
import { attachOrient, setOrientModel, showOrient, dropOrient } from './orient.js';

const view = $('#view');
let sourceId = 0;
let step = 1; // 0 image, 1 object, 2 template, 3 mold

// ---------------------------------------------------------------- stages and bottom bar
function setStep(n) {
  step = n;
  document.querySelectorAll('#steps button').forEach((b) => b.classList.toggle('on', +b.dataset.step === n));
  $('#editor').hidden = n !== 0;
  view.classList.toggle('image-stage', n === 0);
  $('#tools').hidden = n !== 0;
  $('#fit').hidden = n === 0;
  if (n !== 0 && S.editDirty) { S.editDirty = false; schedule(0); } // painting only takes effect in 3D
  if (n === 0) drawEditor();
  if (!M) { updateCaption(); return; }
  showStage(n);
  $('#paintWrap').hidden = !(n === 1 && M.colors);
  $('#flipWrap').hidden = !(n === 1 && M.notFlat); // turning it over shows the underside of a model that isn't flat-backed
  updateCaption();
}
const f1 = (x) => (Math.round(x * 10) / 10).toString();
const size3 = (d, h) => `${f1(d[0])} × ${f1(d[1])} × ${f1(h)} mm`;
function updateCaption() {
  const dl = $('#dl');
  if (step === 0 && S.kind === 'image') {
    const why = t('outlineHelp',
      { shift: `<strong>${t('shiftKey')}</strong>` });
    $('#caption').innerHTML = `<span class="why">${why}</span>`;
    dl.hidden = true; return;
  }
  if (!M) { $('#caption').innerHTML = ''; dl.hidden = true; return; }
  const s = M.stats, parts = M.parts || [{ ...s, B: M.B }]; // two halves: both sizes
  const sizes = (f) => parts.map(f).join(' + ');
  const [spec, label] = { // the stage's name is already on its tab
    1: [t('castingStats', { size: sizes((q) => size3(q.obj, q.objH)), ml: f1(s.castMl) }), 'downloadObject'],
    2: [t('templateStats', { size: sizes((q) => size3(q.tpl, q.tplH)), ml: Math.ceil(s.silMl), g: Math.ceil(s.silMl * 1.1) }), 'downloadTemplate'],
    3: [t('moldStats', { size: sizes((q) => size3(q.sil, q.tplH - q.B)), ml: f1(s.castMl) }), 'downloadMold'],
  }[step];
  $('#caption').innerHTML = `<span class="spec">${spec}</span>`;
  dl.textContent = t(label); dl.hidden = false;
}

// ---------------------------------------------------------------- picture type
// The type decides the 3D method and the starting settings. Auto uses the detected type. With a depth model that
// estimates the surface (MoGe-2) every picture but a height map is sculpted from it. All but photos keep their line
// and colour grooves (drawn or painted features such as pupils or polka dots are no shape); drawings and paintings
// open no gaps (eye whites in deep sockets look like background).
// The Depth model's Auto: MoGe-2 Small sculpts photos, renders, paintings and softly shaded cartoons; line art and
// cartoons in pure flat colour (icons) keep the colour-area method with Depth Anything V2 Small, which keeps their
// shapes crisp where MoGe finds no 3D, while shaded cartoons would split into many small cushions there.
const modelFor = (type, depthModel) => (depthModel !== 'auto' ? depthModel
  : SHADED.includes(type) || (type === 'flat' && S.shading >= 0.15) ? '4' : '1');
const methodFor = (type, depthModel) => {
  const m = type === 'heightmap' ? 'bright' : SHADED.includes(type) ? 'ai' : 'cartoon';
  return m !== 'bright' && GEOMETRY_MODELS.includes(modelFor(type, depthModel)) ? 'sculpt' : m;
};
// The subject is cut out by AI in photos and wherever the picture's edge isn't a plain backdrop; on a plain backdrop
// the colour outline is exact, and the AI loses the thin strokes of line art and has no subject in a height map.
const cutoutFor = (type) => !S.transparent && (type === 'photo' || (S.scene > 25 && type !== 'lineart' && type !== 'heightmap'));
function applyStyle(type) {
  S.method = methodFor(type, readParams().depthModel);
  S.type = type; S.aiCutout = cutoutFor(type);
  const drawn = !SHADED.includes(type) || type === 'painting';
  S.auto = S.method === 'sculpt' ? { ...STYLE_PRESETS[type], ...STYLE_PRESETS.sculpt, ...(drawn && { reopen: 0 }),
    ...(type !== 'photo' && { lineDepth: STYLE_PRESETS[type].lineDepth, edgeDepth: STYLE_PRESETS[type].edgeDepth }) } : STYLE_PRESETS[type];
  for (const [k, v] of Object.entries(S.auto)) if ($('#p-' + k)) setParam(k, v); // the rest are set automatically (regen)
}
// the Auto choices name what was detected, e.g. "Auto (Flat cartoon)", "Auto (Yes)" (Orientation shows a reset button)
function autoLabel() {
  const o = $('#p-picType option[value="auto"]'), d = PARAMS.find((x) => x.id === 'picType');
  if (o && S.detected) o.textContent = t('autoDetected', { type: t(d.options.find(([v]) => v === S.detected)[1]) });
  const m = $('#p-depthModel option[value="auto"]'), dm = PARAMS.find((x) => x.id === 'depthModel'), p = readParams();
  if (m && S.detected) {
    const used = modelFor(p.picType === 'auto' ? S.detected : p.picType, 'auto');
    m.textContent = t('autoDetected', { type: t(dm.options.find(([v]) => v === used)[1]) });
  }
  const c = $('#p-split option[value="auto"]');
  if (c && S.stlAuto) c.textContent = t('autoDetected', { type: t(stlChoice({ ...readParams(), split: 'auto' }).split ? 'yes' : 'no') });
}
// an orientation picked in the 3D view of the Orientation setting: Auto's own position is Auto again, and the
// position already in use changes nothing
function pickSide(up) {
  const e = $('#p-stlUp'), value = up === S.stlAuto.up ? 'auto' : up;
  if (value === e.value) return;
  e.value = value; e.dispatchEvent(new Event('input'));
}
// The STL's up side and whether it is cut, with Auto worked out: cut when there's no flat back facing down
function stlChoice(p) {
  const up = p.stlUp === 'auto' ? S.stlAuto.up : p.stlUp; // a side, maybe with quarter turns: 'y:1'
  return { up, split: p.split === 'auto' ? !S.stlAuto.flats.includes(up.split(':')[0]) : p.split === 'yes' };
}
// for STLs the "method" is whether it is cut into halves, with or without pins: it decides which settings show
const stlMethod = (p) => (stlChoice(p).split ? (p.pins ? 'split-pins' : 'split') : 'whole');
// any setting changed: a new picture type first applies its method and settings
function settingChanged(id) {
  const p = readParams();
  const type = p.picType === 'auto' ? S.detected : p.picType;
  if (S.kind === 'image' && (p.picType !== S.picType || methodFor(type, p.depthModel) !== S.method)) {
    S.picType = p.picType;
    applyStyle(type);
    autoLabel(); // Auto's depth model follows the type
    showFor();
  }
  if (S.kind === 'stl') {
    // A manual cut chosen during the first background build takes precedence over Auto.
    if (id === 'splitAt') S.splitKey = `${p.scale}|${stlChoice(p).up}`;
    autoLabel(); // "Auto (Yes)" can change with the up side
    showOrient(stlChoice(p).up); // e.g. back to Auto's side after the reset
    if (stlMethod(p) !== S.method) { S.method = stlMethod(p); showFor(); }
  }
  schedule();
}

// Every setting back to its default, remembered ones too: Auto for the picture type and depth model (so the detected
// type's starting settings), Auto for an STL's side and cut. Painted outline edits stay.
function resetAll() {
  store.set('settings', {});
  for (const d of PARAMS) if (d.id && (d.type === 'select' || d.type === 'orient')) setParam(d.id, d.val);
  if (S.kind === 'image') { S.picType = 'auto'; applyStyle(S.detected); }
  if (S.kind === 'stl') { S.splitKey = null; S.auto = null; }
  for (const d of PARAMS) if (d.id && d.type !== 'select' && d.type !== 'orient') setParam(d.id, defaultOf(d));
  autoLabel();
  showFor();
  settingChanged('reset');
}

// ---------------------------------------------------------------- loading files
function loadSource(kind, data, name) {
  sourceId++;
  const prevKind = S.kind;
  S.kind = kind; S.name = name;
  if (kind === 'image') { S.img = data; S.geom = null; } else { S.geom = data; S.img = null; }
  // every new file starts with fresh settings where marked (how it is read and shaped); others keep your values,
  // except where images and STLs need different ones and the file type changed
  const kindChanged = kind !== prevKind;
  for (const d of PARAMS) {
    if (!d.id) continue;
    if (d.fresh) setParam(d.id, DEFAULTS[kind][d.id] ?? d.val);
    else if (kindChanged && perKind(d)) setParam(d.id, savedValue(d, kind));
  }
  if (kind === 'image') {
    dropOrient(); // the Orientation view is for STLs only
    ({ type: S.detected, scene: S.scene, transparent: S.transparent, shading: S.shading } = analyzeImage(data)); S.picType = 'auto';
    applyStyle(S.detected);
    autoLabel();
  } else {
    // which side goes down, and whether to cut it, are worked out from the shape (both can be changed)
    S.auto = null; S.splitKey = null; S.stlAuto = detectSTL(data, readParams());
    setOrientModel(data); showOrient(S.stlAuto.up, true);
    S.method = stlMethod(readParams());
    autoLabel();
  }
  showFor(kind);
  $('#srcName').textContent = name;
  S.edit = null; S.editUsed = false; S.editDirty = false; resetEditor();
  S.building = true;
  $('#empty').hidden = true; $('.toolbar').hidden = false; $('#status').hidden = false; $('.caption').hidden = false;
  $('#step0').hidden = kind !== 'image'; // the Image stage (outline editing) is for images only
  step = kind === 'image' ? 0 : step === 0 ? 1 : step;
  setStep(step);
  requestFit();
  schedule(0);
}
// Browsers don't decode SVG files straight into bitmaps: draw it as an <img>, 2048 px on its long side (it has no
// resolution of its own, and a finer drawing gives a finer outline).
async function svgBitmap(file) {
  const url = URL.createObjectURL(file), img = new Image();
  try {
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 1024, h0 = img.naturalHeight || 1024, s = 2048 / Math.max(w0, h0);
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await createImageBitmap(c);
  } finally { URL.revokeObjectURL(url); }
}
async function loadFile(file) {
  if (!file) return;
  const type = /\.3mf$/i.test(file.name) ? '3mf' : /\.stl$/i.test(file.name) ? 'stl' : 'image';
  try {
    if (type !== 'image') {
      const data = await file.arrayBuffer();
      const geom = type === '3mf' ? parse3MF(data) : new STLLoader().parse(data);
      const pos = geom.attributes.position?.array;
      if (!pos?.length || !pos.every(Number.isFinite)) throw new Error('No valid triangles');
      loadSource('stl', geom.index ? geom.toNonIndexed() : geom, file.name);
    } else {
      const bmp = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml' ? await svgBitmap(file) : await createImageBitmap(file);
      loadSource('image', bmp, file.name);
    }
  } catch (e) {
    // the reason in the person's language; the technical detail is for the console
    console.error(e);
    status(e.key ? t(e.key, e.params) : t({ '3mf': 'badThreeMF', stl: 'badSTL', image: 'badImage' }[type]), true);
  }
}

// ---------------------------------------------------------------- building
function status(msg, err = false) {
  const s = $('#status'); s.hidden = false; s.textContent = msg; s.classList.toggle('err', err);
}
let timer = null, gen = 0, workerRetried = false;
function schedule(delay = 220) {
  clearTimeout(timer);
  const my = ++gen; // invalidate older results as soon as a committed setting changes
  if (!S.kind) return;
  status(t('buildingModel')); S.building = true;
  if (step === 0) drawEditor();
  const p = readParams(); // snapshot committed settings; later slider drags are only previews
  timer = setTimeout(() => regen(my, p), delay);
}
async function regen(my, p) {
  if (my !== gen || !S.kind) return;
  const kind = S.kind, source = sourceId;
  p.depthMode = S.method;
  if (kind === 'image') {
    const type = p.picType === 'auto' ? S.detected : p.picType, preset = S.auto || {};
    // a setting hidden for this type or method has no say (settings.js hide)
    for (const d of PARAMS) if (d.hide && d.hide.split(' ').some((h) => h === type || h === S.method)) p[d.id] = 0;
    p.aiCutout = cutoutFor(type);
    p.depthModel = modelFor(type, p.depthModel);
    // settings without a control of their own: from the picture type's preset
    p.lineDark = preset.lineDark ?? 0.38; // how dark a stroke must be to count as a line
    p.reopen = preset.reopen ?? 0.5; // how readily enclosed background is opened up by depth
    // Colour areas: fewer, merged areas to the left (higher colour tolerance, smoothing out texture first), more and
    // smaller to the right
    p.colorTol = 60 - 5.6 * p.areaDetail;
    p.simplify = Math.max(0, Math.min(4, Math.round((8 - p.areaDetail) * 1.2)));
    // shaded pictures: the rounded rim rises with Edge rounding, in the proportion the preset gives them
    if (S.method !== 'cartoon') p.puff = (preset.puff ?? 0) * (preset.edgeSoft ? p.edgeSoft / preset.edgeSoft : 1);
  }
  const split = kind === 'stl' && stlChoice(p).split;
  if (kind === 'stl') p.stlUp = stlChoice(p).up;
  if (split) { p.backT = 0; p.border = 0; }
  const splitKey = `${p.scale}|${p.stlUp}`;
  const autoCut = split && S.splitKey !== splitKey;
  const notFlat = kind === 'stl' && (split || !S.stlAuto.flats.includes(p.stlUp.split(':')[0]));
  let img = null, edit = null;
  const bitmaps = [];
  const snapshot = async (canvas) => {
    const bitmap = await createImageBitmap(canvas);
    bitmaps.push(bitmap); return bitmap;
  };
  try {
    // Canvas edit layers cannot be cloned to a worker; take immutable bitmap snapshots.
    if (kind === 'image') {
      img = await snapshot(S.img);
      if (S.editUsed && S.edit) {
        edit = { add: await snapshot(S.edit.add), cut: await snapshot(S.edit.cut) };
      }
    }
    if (my !== gen) return;
    const result = await buildInWorker({ source, kind, img, edit, p, split, notFlat, autoCut, lang: getLang(),
      positions: kind === 'stl' ? S.geom.attributes.position.array : null },
    (message) => { if (my === gen) status(message); });
    if (!result || my !== gen) return;
    S.building = false; workerRetried = false;
    if (result.splitAt !== null) {
      S.splitKey = splitKey; S.auto = { splitAt: result.splitAt };
      if (+$('#p-splitAt').value === p.splitAt) setParam('splitAt', result.splitAt);
    }
    if (result.outline) setEditorOutline(result.outline);
    const model = result.model;
    showModel(model, $('#paint').checked, model.notFlat && $('#flipObj').checked);
    S.shownSource = source;
    setStep(step);
    status(result.warning || t('buildTime', { ms: result.elapsed }), !!result.warning);
  } catch (e) {
    if (my !== gen) return;
    console.error(e);
    // the background worker failed: once, quietly start a fresh one and build again (from new snapshots)
    if (e.worker && !workerRetried) { workerRetried = true; schedule(0); return; }
    status(e.worker ? t('buildFailed') : e.message, true); S.building = false;
    // a new file that failed: don't leave the previous file's model on show under its name
    if (S.shownSource !== source) { clearModel(); setStep(step); }
    if (step === 0) drawEditor();
  } finally {
    // Transferred bitmaps are detached here; close any snapshots that never reached the worker.
    for (const bitmap of bitmaps) bitmap.close();
  }
}

// ---------------------------------------------------------------- languages
// Everything with text is (re)labelled here; the settings panel is rebuilt with its current values.
function applyLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  $('#flag').innerHTML = FLAGS[lang];
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll('[data-t-title]').forEach((el) => {
    el.title = t(el.dataset.tTitle);
    if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', t(el.dataset.tTitle));
  });
  document.querySelectorAll('[data-t-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tAria)));
  view.dataset.drop = t('dropToLoad');
  if (!$('#status').classList.contains('err')) $('#status').textContent = ''; // last message was in the old language
  if (!S.kind) $('#srcName').textContent = t('noFile');
  const built = !!$('#p-width'), values = built ? readParams() : null;
  buildControls(settingChanged);
  attachOrient($('#box-stlUp'), pickSide);
  if (values) for (const d of PARAMS) if (d.id) setParam(d.id, values[d.id]);
  autoLabel(); // after the values are back: "Auto (Yes)" depends on them
  showFor();
  updateCaption();
}

// ---------------------------------------------------------------- wiring
$('#lang').innerHTML = LANGS.map(([v, name]) => `<option value="${v}">${name}</option>`).join('');
$('#lang').value = getLang();
$('#lang').onchange = (e) => {
  setLang(e.target.value);
  try { localStorage.setItem('lang', e.target.value); } catch (err) { /* storage blocked: still switch for this visit */ }
  applyLang();
};
applyLang();
for (const d of PARAMS) if (d.id) setParam(d.id, kept(d) ? savedValue(d, 'image') : d.val);
showFor('image');
// some settings only apply when AI runs on the graphics card (WebGPU)
(async () => {
  try { S.gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { S.gpu = false; }
  showFor();
})();
updateCaption();
initEditor(() => schedule(0));

const file = $('#file');
$('#drop').onclick = (e) => { if (!e.target.closest('button')) file.click(); };
$('#openBtn').onclick = () => file.click();
$('#resetAll').onclick = resetAll;
file.onchange = () => { loadFile(file.files[0]); file.value = ''; };
{
  const el = $('main');
  el.addEventListener('dragover', (e) => { e.preventDefault(); view.classList.add('over'); });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) view.classList.remove('over'); });
  el.addEventListener('drop', (e) => { e.preventDefault(); view.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });
}
// the demos are ordinary files next to the page, loaded like a dropped file
const loadDemo = async (name) => loadFile(new File([await (await fetch(name)).blob()], name));
// (height map, drawing, flat-backed STL, round STL that gets cut in two)
document.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = () => loadDemo(b.dataset.demo)));
document.querySelectorAll('#steps button').forEach((b) => (b.onclick = () => setStep(+b.dataset.step)));
$('#fit').onclick = fitView;
$('#paint').onchange = () => setPainted($('#paint').checked);
$('#flipObj').onchange = () => setUpsideDown(!!M?.notFlat && $('#flipObj').checked);
$('#dl').onclick = () => exportStage(step, (S.name || 'model').replace(/\.[^.]+$/, ''));

// hook for checking the app from the browser console
window.__mold = { loadSource, loadFile, setStep, camera, controls, S, get M() { return M; } };

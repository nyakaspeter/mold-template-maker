// The app: loading files, the stages and bottom bar, rebuilding the model, and the page's languages.
import { parse3MF } from './three-mf.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { $ } from './dom.js';
import { S } from './state.js';
import { t, getLang, setLang, LANGS, FLAGS } from './i18n.js';
import { PARAMS, DEFAULTS, kept, perKind, savedValue, buildControls, setParam, readParams, showFor } from './settings.js';
import { STYLE_PRESETS, analyzeImage } from './style.js';
import { hfFromImage } from './relief.js';
import { hfFromSTL, halvesFromSTL, bestCut, detectSTL, originalMesh } from './stl.js';
import { buildModel, buildHalves } from './model.js';
import { exactHalves } from './exact.js';
import { aiDepth } from './depth.js';
import { M, showModel, fitView, requestFit, showStage, setPainted, setUpsideDown, exportStage, camera, controls } from './viewer.js';
import { initEditor, resetEditor, setEditorOutline, drawEditor } from './editor.js';
import { attachOrient, setOrientModel, showOrient, dropOrient } from './orient.js';

const view = $('#view');
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
    const why = t('Darkened parts are left out. Paint to light up what belongs to the object; hold {shift} while painting to darken what doesn\'t. Applied when you switch stage.',
      { shift: `<strong>${t('Shift')}</strong>` });
    $('#caption').innerHTML = `<span class="why">${why}</span>`;
    dl.hidden = true; return;
  }
  if (!M) { $('#caption').innerHTML = ''; dl.hidden = true; return; }
  const s = M.stats, parts = M.parts || [{ ...s, B: M.B }]; // two halves: both sizes
  const sizes = (f) => parts.map(f).join(' + ');
  const [spec, label] = { // the stage's name is already on its tab
    1: [t('{size} · about {ml} ml of casting material', { size: sizes((q) => size3(q.obj, q.objH)), ml: f1(s.castMl) }), 'Download object STL'],
    2: [t('{size} · needs about {ml} ml (≈ {g} g) of silicone', { size: sizes((q) => size3(q.tpl, q.tplH)), ml: Math.ceil(s.silMl), g: Math.ceil(s.silMl * 1.1) }), 'Download template STL'],
    3: [t('{size} · holds about {ml} ml', { size: sizes((q) => size3(q.sil, q.tplH - q.B)), ml: f1(s.castMl) }), 'Download mold STL'],
  }[step];
  $('#caption').innerHTML = `<span class="spec">${spec}</span>`;
  dl.textContent = t(label); dl.hidden = false;
}

// ---------------------------------------------------------------- picture type
// The type decides the 3D method and the starting settings. Auto uses the detected type.
function applyStyle(type) {
  S.auto = STYLE_PRESETS[type]; S.method = { shaded: 'ai', heightmap: 'bright' }[type] || 'cartoon';
  for (const [k, v] of Object.entries(S.auto)) setParam(k, v);
}
// the Auto choices name what was detected, e.g. "Auto (Flat cartoon)", "Auto (Yes)" (Orientation shows a reset button)
function autoLabel() {
  const o = $('#p-picType option[value="auto"]'), d = PARAMS.find((x) => x.id === 'picType');
  if (o && S.detected) o.textContent = t('Auto ({type})', { type: t(d.options.find(([v]) => v === S.detected)[1]) });
  const c = $('#p-split option[value="auto"]');
  if (c && S.stlAuto) c.textContent = t('Auto ({type})', { type: t(stlChoice({ ...readParams(), split: 'auto' }).split ? 'Yes' : 'No') });
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
function settingChanged() {
  const p = readParams();
  if (S.kind === 'image' && p.picType !== S.picType) {
    S.picType = p.picType;
    applyStyle(p.picType === 'auto' ? S.detected : p.picType);
    showFor();
  }
  if (S.kind === 'stl') {
    autoLabel(); // "Auto (Yes)" can change with the up side
    showOrient(stlChoice(p).up); // e.g. back to Auto's side after the reset
    if (stlMethod(p) !== S.method) { S.method = stlMethod(p); showFor(); }
  }
  schedule();
}

// ---------------------------------------------------------------- loading files
function loadSource(kind, data, name) {
  const prevKind = S.kind;
  S.kind = kind; S.name = name; S.ai = null; S.aiFailed = false;
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
    S.detected = analyzeImage(data); S.picType = 'auto';
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
async function loadFile(file) {
  if (!file) return;
  try {
    if (/\.(stl|3mf)$/i.test(file.name)) {
      const data = await file.arrayBuffer();
      const geom = /\.3mf$/i.test(file.name) ? parse3MF(data) : new STLLoader().parse(data);
      loadSource('stl', geom.index ? geom.toNonIndexed() : geom, file.name);
    } else {
      const bmp = await createImageBitmap(file);
      loadSource('image', bmp, file.name);
    }
  } catch (e) { status(t('Could not read that file: ') + e.message, true); }
}

// ---------------------------------------------------------------- building
function status(msg, err = false) {
  const s = $('#status'); s.hidden = false; s.textContent = msg; s.classList.toggle('err', err);
}
let timer = null, gen = 0;
function schedule(delay = 220) {
  clearTimeout(timer);
  if (S.kind) { status(t('Updating…')); S.building = true; if (step === 0) drawEditor(); }
  timer = setTimeout(regen, delay);
}
async function regen() {
  if (!S.kind) return;
  const my = ++gen, p = readParams();
  p.depthMode = S.method;
  try {
    const wantAI = S.kind === 'image' && S.method !== 'bright'; // the depth model is downloaded once, then cached
    if (wantAI && (!S.ai || S.aiModel !== p.depthModel) && !S.aiFailed) {
      try { S.ai = await aiDepth(S.img, status, p.depthModel); S.aiModel = p.depthModel; }
      catch (e) { S.aiFailed = true; console.error(e); status(t('AI depth failed — continuing without it. ') + e.message, true); }
      if (my !== gen) return;
    }
    await new Promise((r) => setTimeout(r, 30)); // let the status text paint first
    if (my !== gen) return;
    const t0 = performance.now();
    const split = S.kind === 'stl' && stlChoice(p).split;
    if (S.kind === 'stl') p.stlUp = stlChoice(p).up;
    if (split) { p.backT = 0; p.border = 0; } // hidden for halves: they'd end up in the glued seam
    // the cut starts where each half stays in one piece and the object is widest; worked out again when the file
    // or its up direction changes
    if (split && S.splitKey !== `${p.scale}|${p.stlUp}`) {
      S.splitKey = `${p.scale}|${p.stlUp}`;
      p.splitAt = bestCut(S.geom, p); S.auto = { splitAt: p.splitAt }; setParam('splitAt', p.splitAt);
    }
    const hf = S.kind === 'image' ? hfFromImage(S.img, wantAI ? S.ai : null, p, S.editUsed ? S.edit : null)
      : split ? halvesFromSTL(S.geom, p) : hfFromSTL(S.geom, p);
    S.building = false;
    if (S.kind === 'image') setEditorOutline(hf);
    let model;
    if (split) {
      const halves = hf.map((h) => buildModel(h, p));
      await exactHalves(S.geom, p, halves); // the model itself cut in two, rather than height maps
      if (my !== gen) return;
      model = buildHalves(halves, p);
    } else model = buildModel(hf, p);
    model.notFlat = S.kind === 'stl' && (split || !S.stlAuto.flats.includes(p.stlUp.split(':')[0]));
    // an STL without a flat back that isn't cut: the Object stage shows the model as it is
    if (model.notFlat && !split) model.geo.object = originalMesh(S.geom, p);
    showModel(model, $('#paint').checked, model.notFlat && $('#flipObj').checked);
    setStep(step);
    if (!(S.aiFailed && wantAI)) status(t('Built in {ms} ms', { ms: Math.round(performance.now() - t0) }));
  } catch (e) { console.error(e); status(e.message, true); S.building = false; if (step === 0) drawEditor(); }
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
  view.dataset.drop = t('Drop to load');
  if (!$('#status').classList.contains('err')) $('#status').textContent = ''; // last message was in the old language
  if (!S.kind) $('#srcName').textContent = t('No file loaded');
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
updateCaption();
initEditor(() => schedule(0));

const file = $('#file');
$('#drop').onclick = (e) => { if (!e.target.closest('button')) file.click(); };
$('#openBtn').onclick = () => file.click();
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

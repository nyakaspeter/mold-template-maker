// The app: loading files, the stages and bottom bar, rebuilding the model, and the page's languages.
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { $ } from './dom.js';
import { S } from './state.js';
import { t, getLang, setLang, LANGS, FLAGS } from './i18n.js';
import { PARAMS, DEFAULTS, kept, perKind, savedValue, buildControls, setParam, readParams, showFor } from './settings.js';
import { STYLE_PRESETS, analyzeImage } from './style.js';
import { hfFromImage } from './relief.js';
import { hfFromSTL } from './stl.js';
import { buildModel } from './model.js';
import { aiDepth } from './depth.js';
import { M, showModel, fitView, requestFit, showStage, setPainted, exportStage, camera, controls } from './viewer.js';
import { initEditor, resetEditor, setEditorOutline, drawEditor } from './editor.js';

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
  updateCaption();
}
const f1 = (x) => (Math.round(x * 10) / 10).toString();
const size3 = (d, h) => `${f1(d[0])} × ${f1(d[1])} × ${f1(h)} mm`;
function updateCaption() {
  const dl = $('#dl');
  if (step === 0 && S.kind === 'image') {
    const why = t('Darkened parts are left out. Paint to light up what belongs to the object; hold {shift} while painting to darken what doesn\'t. Applied when you switch stage.',
      { shift: `<strong>${t('Shift')}</strong>` });
    $('#caption').innerHTML = `<b>${t('Image')}</b><span class="why">${why}</span>`;
    dl.hidden = true; return;
  }
  if (!M) { $('#caption').innerHTML = ''; dl.hidden = true; return; }
  const s = M.stats;
  const [title, spec, label] = {
    1: ['Object', t('{size} · about {ml} ml of casting material', { size: size3(s.obj, s.objH), ml: f1(s.castMl) }), 'Download object STL'],
    2: ['Template', t('{size} · needs about {ml} ml (≈ {g} g) of silicone', { size: size3(s.tpl, s.tplH), ml: Math.ceil(s.silMl), g: Math.ceil(s.silMl * 1.1) }), 'Download template STL'],
    3: ['Mold', t('{size} · holds about {ml} ml', { size: size3(s.sil, s.tplH - M.B), ml: f1(s.castMl) }), 'Download mold STL'],
  }[step];
  $('#caption').innerHTML = `<b>${t(title)}</b><span class="spec">${spec}</span>`;
  dl.textContent = t(label); dl.hidden = false;
}

// ---------------------------------------------------------------- loading files
function loadSource(kind, data, name) {
  const prevKind = S.kind;
  S.kind = kind; S.name = name; S.ai = null; S.aiFailed = false;
  if (kind === 'image') { S.img = data; S.geom = null; } else { S.geom = data; S.img = null; }
  // every new file starts with fresh Outline and Relief settings; other settings keep your values,
  // except where images and STLs need different ones and the file type changed
  const kindChanged = kind !== prevKind;
  for (const d of PARAMS) {
    if (!d.id) continue;
    const fresh = d.group === 'Outline' || d.group === 'Relief';
    if (fresh) setParam(d.id, DEFAULTS[kind][d.id] ?? d.val);
    else if (kindChanged && perKind(d)) setParam(d.id, savedValue(d, kind));
  }
  if (kind === 'image') {
    const a = analyzeImage(data);
    S.auto = STYLE_PRESETS[a]; S.method = { shaded: 'ai', heightmap: 'bright' }[a] || 'cartoon';
    for (const [k, v] of Object.entries(S.auto)) setParam(k, v);
  } else S.auto = null;
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
    if (/\.stl$/i.test(file.name)) {
      const geom = new STLLoader().parse(await file.arrayBuffer());
      loadSource('stl', geom.index ? geom.toNonIndexed() : geom, file.name);
    } else {
      const bmp = await createImageBitmap(file);
      loadSource('image', bmp, file.name);
    }
  } catch (e) { status(t('Could not read that file: ') + e.message, true); }
}

// ---------------------------------------------------------------- building
function status(msg, err = false) {
  const s = $('#status'); s.textContent = msg; s.classList.toggle('err', err);
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
    if (wantAI && !S.ai && !S.aiFailed) {
      try { S.ai = await aiDepth(S.img, status); }
      catch (e) { S.aiFailed = true; console.error(e); status(t('AI depth failed — continuing without it. ') + e.message, true); }
      if (my !== gen) return;
    }
    await new Promise((r) => setTimeout(r, 30)); // let the status text paint first
    if (my !== gen) return;
    const t0 = performance.now();
    const hf = S.kind === 'image' ? hfFromImage(S.img, wantAI ? S.ai : null, p, S.editUsed ? S.edit : null) : hfFromSTL(S.geom, p);
    S.building = false;
    if (S.kind === 'image') setEditorOutline(hf);
    showModel(buildModel(hf, p), $('#paint').checked);
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
  buildControls(() => schedule());
  if (values) for (const d of PARAMS) if (d.id) setParam(d.id, values[d.id]);
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
$('#demo').onclick = () => loadDemo('demo-heart.png');
$('#demoStl').onclick = () => loadDemo('demo-medallion.stl');
document.querySelectorAll('#steps button').forEach((b) => (b.onclick = () => setStep(+b.dataset.step)));
$('#fit').onclick = fitView;
$('#paint').onchange = () => setPainted($('#paint').checked);
$('#dl').onclick = () => exportStage(step, (S.name || 'model').replace(/\.[^.]+$/, ''));

// hook for checking the app from the browser console
window.__mold = { loadSource, loadFile, setStep, camera, controls, S, get M() { return M; } };

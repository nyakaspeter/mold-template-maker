// Geometry, rasterisation and AI inference run here so the page can keep handling input.
import { BufferGeometry, BufferAttribute } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { setLang, t } from './i18n.js';
import { aiDepth, aiMatte } from './depth.js';
import { guidedMatte } from './matte.js';
import { hfFromImage, subjectBox } from './relief.js';
import { hfFromSTL, halvesFromSTL, bestCut, originalMesh } from './stl.js';
import { buildModel, buildHalves } from './model.js';
import { exactHalves } from './exact.js';
import { joinMeshes } from './mesh.js';

let sourceId, geom, ai, aiModel, aiFailed = false, matte, matteFailed = false, hfCache = null;
// settings only the meshes use (model.js): changing them reuses the last height map. Roundness is one too, except in
// the cartoon method, where it shapes each colour area.
const MESH_ONLY = ['backT', 'border', 'gap', 'over', 'wallT', 'baseT', 'maskSmooth', 'reliefSmooth', 'edgeSoft', 'lineDepth', 'hanger', 'hangerT', 'hangerShift'];

// the picture with the matte as its transparency, so the outline follows the cut-out subject. The model's matte is
// coarse (320 px): it is refined on a copy of up to 1600 px, so its edges follow the picture's own (hair, fingers)
const resample = (a, aw, ah, w, h) => {
  const o = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const fy = Math.min(ah - 1.001, Math.max(0, (j + 0.5) * ah / h - 0.5)), y0 = fy | 0, ay = fy - y0;
    for (let i = 0; i < w; i++) {
      const fx = Math.min(aw - 1.001, Math.max(0, (i + 0.5) * aw / w - 0.5)), x0 = fx | 0, ax = fx - x0, q = y0 * aw + x0;
      o[j * w + i] = (a[q] * (1 - ax) + a[q + 1] * ax) * (1 - ay) + (a[q + aw] * (1 - ax) + a[q + aw + 1] * ax) * ay;
    }
  }
  return o;
};
let cutCache = null;
function cutOut(img, m) {
  if (cutCache?.m === m) return cutCache.c;
  const s = Math.min(1, 1600 / Math.max(img.width, img.height)), gw = Math.round(img.width * s), gh = Math.round(img.height * s);
  const g = new OffscreenCanvas(gw, gh), gctx = g.getContext('2d', { willReadFrequently: true });
  gctx.drawImage(img, 0, 0, gw, gh);
  const refined = guidedMatte(gctx.getImageData(0, 0, gw, gh).data, gw, gh, resample(m.data, m.width, m.height, gw, gh),
    Math.max(2, Math.round(Math.max(gw, gh) / 150)), 1e-3);
  const alpha = s < 1 ? resample(refined, gw, gh, img.width, img.height) : refined;
  const c = new OffscreenCanvas(img.width, img.height), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height), px = d.data;
  for (let k = 0; k < alpha.length; k++) px[k * 4 + 3] *= alpha[k];
  ctx.putImageData(d, 0, 0);
  cutCache = { m, c };
  return c;
}
self.onmessage = async ({ data: job }) => {
  const { id, source, kind, img, edit, editVersion, p, split, notFlat, autoCut, lang } = job;
  setLang(lang);
  const status = (message) => self.postMessage({ id, status: message });
  const start = performance.now();
  try {
    if (source !== sourceId) {
      geom?.dispose(); geom = null;
      ai = null; aiModel = null; aiFailed = false; matte = null; matteFailed = false; hfCache = null; sourceId = source;
    }
    if (kind === 'stl' && !geom) {
      geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(job.positions, 3));
    }
    // the AI cut-out first (when, see app.js: never for a picture with its own transparency)
    const wantMatte = kind === 'image' && p.aiCutout;
    if (wantMatte && !matte && !matteFailed) {
      try { matte = await aiMatte(img, status); }
      catch (error) { matteFailed = true; console.error(error); }
    }
    p.cutout = wantMatte && !!matte;
    const picture = p.cutout ? cutOut(img, matte) : img;
    // AI depth of the subject: the models see a fixed-size copy, so the picture cropped to the subject and a margin
    // (the nearby scene, for context) gives them more detail on it. It is estimated again only when a painted outline
    // reaches beyond the crop.
    const wantAI = kind === 'image' && p.depthMode !== 'bright';
    if (wantAI && aiModel !== p.depthModel) { ai = null; aiFailed = false; aiModel = p.depthModel; }
    if (wantAI && !aiFailed) {
      const { box } = subjectBox(picture, p, edit), m = 0.1 * Math.max(box.x1 - box.x0, box.y1 - box.y0);
      const x0 = Math.max(0, Math.floor(box.x0 - m)), y0 = Math.max(0, Math.floor(box.y0 - m));
      const crop = { x: x0, y: y0, w: Math.min(img.width, Math.ceil(box.x1 + m)) - x0, h: Math.min(img.height, Math.ceil(box.y1 + m)) - y0 };
      const c = ai?.crop;
      if (c && (box.x0 < c.x || box.y0 < c.y || box.x1 > c.x + c.w || box.y1 > c.y + c.h)) ai = null;
      if (!ai) {
        const part = new OffscreenCanvas(crop.w, crop.h);
        part.getContext('2d').drawImage(img, -crop.x, -crop.y);
        try { ai = await aiDepth(part, status, p.depthModel); ai.crop = crop; }
        catch (error) { aiFailed = true; console.error(error); }
      }
    }
    if (autoCut) p.splitAt = bestCut(geom, p);
    let hf;
    if (kind === 'image') {
      const key = { ...p, editVersion };
      for (const k of MESH_ONLY) delete key[k];
      if (p.depthMode !== 'cartoon') delete key.puff;
      const keyText = JSON.stringify(key), depth = wantAI ? ai : null;
      // (the picture itself is a new snapshot each time; for one source it only differs by the cut-out)
      if (hfCache?.key === keyText && hfCache.depth === depth && hfCache.matte === matte) hf = hfCache.hf;
      else { hf = hfFromImage(picture, depth, p, edit); hfCache = { key: keyText, depth, matte, hf }; }
    } else hf = split ? halvesFromSTL(geom, p) : hfFromSTL(geom, p);
    let model;
    if (split) {
      const halves = hf.map((h) => buildModel(h, p));
      await exactHalves(geom, p, halves);
      model = buildHalves(halves, p);
    } else model = buildModel(hf, p);
    model.notFlat = notFlat;
    if (notFlat && !split) model.geo.object = model.hanger ? joinMeshes([[originalMesh(geom, p)], [model.hanger]]) : originalMesh(geom, p);
    delete model.hanger;
    // (a copy of the mask: the result's buffers are handed over to the page, and the height map stays cached here)
    const result = { id, model, outline: kind === 'image' ? { W: hf.W, H: hf.H, mask: hf.mask.slice(), rect: hf.rect } : null,
      splitAt: autoCut ? p.splitAt : null, elapsed: Math.round(performance.now() - start),
      warning: wantAI && aiFailed ? t('depthFailed') : null };
    // Transfer mesh buffers rather than copying large generated models back to the page.
    const buffers = new Set();
    const collect = (value) => {
      if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
      else if (value && typeof value === 'object') for (const v of Object.values(value)) collect(v);
    };
    collect(result);
    self.postMessage(result, [...buffers]);
  } catch (error) { console.error(error); self.postMessage({ id, error: error.message }); }
  finally { img?.close(); edit?.add.close(); edit?.cut.close(); }
};

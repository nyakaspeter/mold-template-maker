// Geometry, rasterisation and AI inference run here so the page can keep handling input.
import { BufferGeometry, BufferAttribute } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { setLang, t } from './i18n.js';
import { aiDepth } from './depth.js';
import { hfFromImage } from './relief.js';
import { hfFromSTL, halvesFromSTL, bestCut, originalMesh } from './stl.js';
import { buildModel, buildHalves } from './model.js';
import { exactHalves } from './exact.js';

let sourceId, geom, ai, aiModel, aiFailed = false;
self.onmessage = async ({ data: job }) => {
  const { id, source, kind, img, edit, p, split, notFlat, autoCut, lang } = job;
  setLang(lang);
  const status = (message) => self.postMessage({ id, status: message });
  const start = performance.now();
  try {
    if (source !== sourceId) {
      geom?.dispose(); geom = null;
      ai = null; aiModel = null; aiFailed = false; sourceId = source;
    }
    if (kind === 'stl' && !geom) {
      geom = new BufferGeometry();
      geom.setAttribute('position', new BufferAttribute(job.positions, 3));
    }
    const wantAI = kind === 'image' && p.depthMode !== 'bright';
    if (wantAI && aiModel !== p.depthModel) { ai = null; aiFailed = false; aiModel = p.depthModel; }
    if (wantAI && !ai && !aiFailed) {
      try { ai = await aiDepth(img, status, p.depthModel); }
      catch (error) { aiFailed = true; console.error(error); }
    }
    if (autoCut) p.splitAt = bestCut(geom, p);
    const hf = kind === 'image' ? hfFromImage(img, wantAI ? ai : null, p, edit)
      : split ? halvesFromSTL(geom, p) : hfFromSTL(geom, p);
    let model;
    if (split) {
      const halves = hf.map((h) => buildModel(h, p));
      await exactHalves(geom, p, halves);
      model = buildHalves(halves, p);
    } else model = buildModel(hf, p);
    model.notFlat = notFlat;
    if (notFlat && !split) model.geo.object = originalMesh(geom, p);
    const result = { id, model, outline: kind === 'image' ? { W: hf.W, H: hf.H, mask: hf.mask, rect: hf.rect } : null,
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

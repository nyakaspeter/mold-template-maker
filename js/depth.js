// AI depth estimation in the browser, on the graphics card (WebGPU) when there is one, otherwise on the CPU.
// Each model is downloaded once, then cached by the browser.
import { t } from './i18n.js';
import { geometryFromMoGe, fuseTiles, fuseDepthDetail } from './sculpt.js';

// the Depth model setting's depth-only choice
const MODELS = {
  1: 'onnx-community/depth-anything-v2-small', // Depth Anything V2 small, ~50 MB, Apache-2.0
};
// the model that also estimates the surface (point map and normals), for sculpted reliefs; official ONNX export, MIT
export const GEOMETRY = {
  4: 'https://huggingface.co/Ruicheng/moge-2-vits-normal-onnx/resolve/main/model.onnx', // MoGe-2 ViT-S, ~141 MB
};
// cuts the subject out of photos (see app.js for when): U²-Net, Apache-2.0, ~176 MB. (BiRefNet and BEN2 cut out
// more finely, but need more storage buffers per shader than Apple graphics cards offer on WebGPU.)
const MATTE = 'https://huggingface.co/BritishWerewolf/U-2-Net/resolve/main/onnx/model.onnx', MATTE_SIZE = 320;
const BASE = 518, DETAIL = 1036; // short side of the models' own input size, and of the finer second pass
const OUT = 1024; // long side of the returned depth map
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

const estimators = {}, cpuOnly = new Set(); // models that failed on the graphics card run on the CPU from then on
let gpuP = null, tfP = null, ortP = null, matteP = null;
const hasGPU = () => (gpuP ||= (async () => {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; }
})());
const useGPU = async (key) => !cpuOnly.has(key) && hasGPU();
const lib = () => (tfP ||= import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1')
  .catch((error) => { tfP = null; throw error; }));
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
const QUIET = { logSeverityLevel: 3 }; // sessions log errors only (no warnings about which ops run on the CPU)
const ortLib = () => (ortP ||= import(ORT + 'ort.webgpu.bundle.min.mjs')
  .then((ort) => { ort.env.wasm.wasmPaths = ORT; ort.env.logLevel = 'error'; return ort; })
  .catch((error) => { ortP = null; throw error; }));

// A model file, from the browser's cache when it has been downloaded before (the "Loading … model" message stays
// up while it downloads).
async function download(url) {
  let cache = null;
  try {
    cache = await caches.open('mold-template-maker-models');
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch (e) { cache = null; /* no cache storage here: download every time */ }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  try { await cache?.put(url, new Response(data)); } catch (e) { /* cache full: downloaded again next time */ }
  return data;
}

function geometryModel(key, gpu, onStatus) {
  if (!estimators[key]) {
    estimators[key] = (async () => {
      onStatus(t('loadingDepth'));
      const ort = await ortLib(), data = await download(GEOMETRY[key]);
      if (gpu) {
        try { return { gpu, ort, session: await ort.InferenceSession.create(data, { executionProviders: ['webgpu'], ...QUIET }) }; }
        catch (e) { console.warn('WebGPU geometry failed, using the CPU', e); }
      }
      return { gpu: false, ort, session: await ort.InferenceSession.create(data, { executionProviders: ['wasm'], ...QUIET }) };
    })();
    estimators[key].catch(() => { delete estimators[key]; });
  }
  return estimators[key];
}

// MoGe-2: the picture's surface as a point map and normals, turned into depth plus geometry (see sculpt.js).
// On the graphics card it uses MoGe's largest token count, then refines: MoGe again on 2 × 2 overlapping tiles (each
// sees twice the detail) and the finest band of Depth Anything's depth. On the CPU there is one run on a smaller
// copy of the picture with fewer tokens (coarser, but in reasonable time).
const TILES = 2, OVERLAP = 0.25;
async function aiGeometry(img, onStatus, model) {
  // on the graphics card Depth Anything adds the finest detail: it loads alongside MoGe, and both count as one
  // "Loading depth model" and one "Estimating depth" step
  const quiet = () => {};
  if (await useGPU(model)) estimator('1', await useGPU('1'), quiet).catch(() => { /* fine detail is skipped */ });
  const { gpu, ort, session } = await geometryModel(model, await useGPU(model), onStatus);
  onStatus(t('estimatingDepth'));
  const run = async (x, y, cw, ch, long, tokens) => {
    const s = Math.min(1, long / Math.max(cw, ch)), w = Math.max(14, Math.round(cw * s)), h = Math.max(14, Math.round(ch * s));
    const c = typeof document === 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, cw, ch, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data, n = w * h, input = new Float32Array(3 * n);
    for (let k = 0; k < n; k++) for (let c3 = 0; c3 < 3; c3++) input[c3 * n + k] = px[k * 4 + c3] / 255; // the model normalises itself
    const out = await session.run({
      image: new ort.Tensor('float32', input, [1, 3, h, w]),
      num_tokens: new ort.Tensor('int64', BigInt64Array.from([BigInt(tokens)]), []),
    });
    const r = { w, h, points: out.points.data, normals: out.normal.data, mask: out.mask.data };
    for (const v of Object.values(out)) v.dispose?.();
    return r;
  };
  const whole = await run(0, 0, img.width, img.height, gpu ? 1036 : 700, gpu ? 3600 : 1200);
  let result = geometryFromMoGe(whole.points, whole.normals, whole.mask, whole.w, whole.h, img.width);
  if (!gpu) return result;
  const tw = img.width / (TILES - (TILES - 1) * OVERLAP), th = img.height / (TILES - (TILES - 1) * OVERLAP), tiles = [];
  for (let j = 0; j < TILES; j++) {
    for (let i = 0; i < TILES; i++) {
      const x = i * tw * (1 - OVERLAP), y = j * th * (1 - OVERLAP), r = await run(x, y, tw, th, 1036, 3600);
      tiles.push({ x, y, w: tw, h: th, width: r.w, height: r.h, normals: r.normals });
    }
  }
  result = fuseTiles(result, tiles, 1.6, img.width, img.height);
  try { fuseDepthDetail(result, await aiDepth(img, quiet, '1'), TILES * 60); }
  catch (e) { console.warn('Depth Anything detail failed, continuing without it', e); }
  return result;
}

function estimator(key, gpu, onStatus) {
  if (!estimators[key]) {
    estimators[key] = (async () => {
      onStatus(t('loadingDepth'));
      const tf = await lib();
      if (gpu) {
        try { return { gpu, pipe: await tf.pipeline('depth-estimation', MODELS[key], { device: 'webgpu', dtype: 'fp16', session_options: QUIET }) }; }
        catch (e) { console.warn('WebGPU depth failed, using the CPU', e); }
      }
      return { gpu: false, pipe: await tf.pipeline('depth-estimation', MODELS[key], { dtype: 'q8', session_options: QUIET }) };
    })();
    estimators[key].catch(() => { delete estimators[key]; });
  }
  return estimators[key];
}

// One model run with the picture's short side at `short` pixels, resampled to w × h.
async function runAt(tf, model, img, short, w, h) {
  const s = short / Math.min(img.width, img.height);
  const iw = Math.max(14, Math.round(img.width * s / 14) * 14), ih = Math.max(14, Math.round(img.height * s / 14) * 14);
  const c = typeof document === 'undefined' ? new OffscreenCanvas(iw, ih) : document.createElement('canvas');
  c.width = iw; c.height = ih;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, iw, ih);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, iw, ih);
  const px = ctx.getImageData(0, 0, iw, ih).data, n = iw * ih, input = new Float32Array(3 * n);
  for (let k = 0; k < n; k++) for (let ch = 0; ch < 3; ch++) input[ch * n + k] = (px[k * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  const { predicted_depth: d } = await model({ pixel_values: new tf.Tensor('float32', input, [1, 3, ih, iw]) });
  const [oh, ow] = d.dims.slice(-2), a = d.data, out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const fy = Math.min(oh - 1.001, Math.max(0, (j + 0.5) * oh / h - 0.5)), y0 = fy | 0, ay = fy - y0;
    for (let i = 0; i < w; i++) {
      const fx = Math.min(ow - 1.001, Math.max(0, (i + 0.5) * ow / w - 0.5)), x0 = fx | 0, ax = fx - x0, q = y0 * ow + x0;
      out[j * w + i] = (a[q] * (1 - ax) + a[q + 1] * ax) * (1 - ay) + (a[q + ow] * (1 - ax) + a[q + ow + 1] * ax) * ay;
    }
  }
  return out;
}

// The subject of a photo as an alpha matte: { width, height, data } from 0 (background) to 1 (subject).
function matteModel(gpu, onStatus) {
  matteP ||= (async () => {
    onStatus(t('loadingMatte'));
    const ort = await ortLib(), data = await download(MATTE);
    if (gpu) {
      try { return { gpu, ort, session: await ort.InferenceSession.create(data, { executionProviders: ['webgpu'], ...QUIET }) }; }
      catch (e) { console.warn('WebGPU background removal failed, using the CPU', e); }
    }
    return { gpu: false, ort, session: await ort.InferenceSession.create(data, { executionProviders: ['wasm'], ...QUIET }) };
  })();
  matteP.catch(() => { matteP = null; });
  return matteP;
}
export async function aiMatte(img, onStatus) {
  let m = await matteModel(await hasGPU(), onStatus);
  onStatus(t('cuttingOut'));
  const s = MATTE_SIZE, c = typeof document === 'undefined' ? new OffscreenCanvas(s, s) : document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, s, s);
  const px = ctx.getImageData(0, 0, s, s).data, n = s * s, input = new Float32Array(3 * n);
  for (let k = 0; k < n; k++) for (let ch = 0; ch < 3; ch++) input[ch * n + k] = (px[k * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  const run = async () => { // the first output is the fused, finest mask
    const out = await m.session.run({ [m.session.inputNames[0]]: new m.ort.Tensor('float32', input, [1, 3, s, s]) });
    return out[m.session.outputNames[0]];
  };
  let o;
  try { o = await run(); }
  catch (e) { // some graphics cards can't run it after all: the CPU
    if (!m.gpu) throw e;
    console.warn('WebGPU background removal failed, using the CPU', e);
    matteP = null; m = await matteModel(false, onStatus); onStatus(t('cuttingOut')); o = await run();
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of o.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const data = new Float32Array(n);
  for (let k = 0; k < n; k++) data[k] = (o.data[k] - lo) / Math.max(1e-6, hi - lo);
  o.dispose?.();
  return { width: s, height: s, data };
}

function boxBlur(f, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    let s = 0, n = 0;
    for (let i = -r; i < w + r; i++) {
      if (i + r < w) { s += f[j * w + i + r]; n++; }
      if (i - r - 1 >= 0) { s -= f[j * w + i - r - 1]; n--; }
      if (i >= 0 && i < w) t[j * w + i] = s / n;
    }
  }
  for (let i = 0; i < w; i++) {
    let s = 0, n = 0;
    for (let j = -r; j < h + r; j++) {
      if (j + r < h) { s += t[(j + r) * w + i]; n++; }
      if (j - r - 1 >= 0) { s -= t[(j - r - 1) * w + i]; n--; }
      if (j >= 0 && j < h) o[j * w + i] = s / n;
    }
  }
  return o;
}
const smooth = (f, w, h, r) => boxBlur(boxBlur(f, w, h, r), w, h, r);

// Returns { width, height, data }: depth from 0 to 1, higher = nearer. onStatus receives progress messages.
// On the graphics card a second, finer run adds small detail (noses, eyes, hair) to the overall shape of the first.
// MoGe also returns `geo`, the surface geometry.
export async function aiDepth(img, onStatus, model = '1') {
  const key = GEOMETRY[model] || MODELS[model] ? model : '1';
  try { return await (GEOMETRY[key] ? aiGeometry : depthOnly)(img, onStatus, key); }
  catch (error) {
    // a model can load on the graphics card and still fail while running (memory, an unsupported operation):
    // run it again on the CPU, and only give up if that fails too
    if (!(await estimators[key]?.catch(() => null))?.gpu) throw error;
    console.warn('AI on the graphics card failed, running it on the CPU', error);
    cpuOnly.add(key); delete estimators[key];
    return (GEOMETRY[key] ? aiGeometry : depthOnly)(img, onStatus, key);
  }
}
async function depthOnly(img, onStatus, key) {
  const { gpu, pipe } = await estimator(key, await useGPU(key), onStatus);
  const tf = await lib();
  onStatus(t('estimatingDepth'));
  const sc = Math.min(1, OUT / Math.max(img.width, img.height));
  const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
  let d = await runAt(tf, pipe.model, img, BASE, w, h);
  if (gpu) {
    const fine = await runAt(tf, pipe.model, img, DETAIL, w, h);
    // match the fine run's scale to the base run, then take only what it adds below the blur radius
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const n = w * h;
    for (let k = 0; k < n; k++) { sx += fine[k]; sy += d[k]; sxx += fine[k] * fine[k]; sxy += fine[k] * d[k]; }
    const m = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx), q = (sy - m * sx) / n;
    for (let k = 0; k < n; k++) fine[k] = fine[k] * m + q;
    const r = Math.max(2, Math.round(Math.min(w, h) / 40)), lowD = smooth(d, w, h, r), lowF = smooth(fine, w, h, r);
    for (let k = 0; k < n; k++) d[k] = lowD[k] + fine[k] - lowF[k];
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of d) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1e-9, hi - lo);
  for (let k = 0; k < d.length; k++) d[k] = (d[k] - lo) / span;
  return { width: w, height: h, data: d };
}

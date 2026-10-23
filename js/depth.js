// AI depth estimation in the browser, on the graphics card (WebGPU) when there is one, otherwise on the CPU.
// Each model is downloaded once, then cached by the browser.
import { t } from './i18n.js';

// the Depth model setting's choices, smallest first
const MODELS = {
  1: 'onnx-community/depth-anything-v2-small', // Depth Anything V2 small, ~50 MB, Apache-2.0
  2: 'onnx-community/depth-anything-v2-base', // Depth Anything V2 base, ~195 MB, CC-BY-NC-4.0
  3: 'Ko033/distill-any-depth-base-onnx', // Distill Any Depth base, ~197 MB, MIT
};
const BASE = 518, DETAIL = 1036; // short side of the models' own input size, and of the finer second pass
const OUT = 1024; // long side of the returned depth map
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

const estimators = {};
let gpuP = null, tfP = null;
const hasGPU = () => (gpuP ||= (async () => {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; }
})());
const lib = () => (tfP ||= import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1'));

function estimator(key, gpu, onStatus) {
  if (!estimators[key]) {
    estimators[key] = (async () => {
      onStatus(t('Loading depth model…'));
      const tf = await lib();
      const progress_callback = (e) => { if (e.status === 'progress' && e.file?.endsWith('.onnx')) onStatus(t('Downloading depth model… {p}%', { p: Math.round(e.progress) })); };
      if (gpu) {
        try { return { gpu, pipe: await tf.pipeline('depth-estimation', MODELS[key], { device: 'webgpu', dtype: 'fp16', progress_callback }) }; }
        catch (e) { console.warn('WebGPU depth failed, using the CPU', e); }
      }
      return { gpu: false, pipe: await tf.pipeline('depth-estimation', MODELS[key], { dtype: 'q8', progress_callback }) };
    })();
    estimators[key].catch(() => { delete estimators[key]; });
  }
  return estimators[key];
}

// One model run with the picture's short side at `short` pixels, resampled to w × h.
async function runAt(tf, model, img, short, w, h) {
  const s = short / Math.min(img.width, img.height);
  const iw = Math.max(14, Math.round(img.width * s / 14) * 14), ih = Math.max(14, Math.round(img.height * s / 14) * 14);
  const c = document.createElement('canvas'); c.width = iw; c.height = ih;
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
export async function aiDepth(img, onStatus, model = '1') {
  const { gpu, pipe } = await estimator(MODELS[model] ? model : '1', await hasGPU(), onStatus);
  const tf = await lib();
  onStatus(t('Estimating depth…'));
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

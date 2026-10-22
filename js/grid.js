// Grid helpers shared by the image and model code: blurring, distance transforms, hole filling, sampling.

export function blur(src, W, H, sigma) {
  if (sigma < 0.25) return Float32Array.from(src);
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const row = j * W;
    for (let i = 0; i < W; i++) {
      let a = 0;
      for (let t = -r; t <= r; t++) { let ii = i + t; ii = ii < 0 ? 0 : ii >= W ? W - 1 : ii; a += src[row + ii] * k[t + r]; }
      tmp[row + i] = a;
    }
  }
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      let a = 0;
      for (let t = -r; t <= r; t++) { let jj = j + t; jj = jj < 0 ? 0 : jj >= H ? H - 1 : jj; a += tmp[jj * W + i] * k[t + r]; }
      out[j * W + i] = a;
    }
  }
  return out;
}

// Felzenszwalb & Huttenlocher exact Euclidean distance transform
export const BIG = 1e20;
export function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -BIG; z[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
export function distTo(feature, W, H) {
  const N = W * H, g = new Float64Array(N), n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let k = 0; k < N; k++) g[k] = feature[k] ? 0 : BIG;
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = g[j * W + i];
    dt1(f, H, d, v, z);
    for (let j = 0; j < H; j++) g[j * W + i] = d[j];
  }
  const out = new Float32Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) f[i] = g[j * W + i];
    dt1(f, W, d, v, z);
    for (let i = 0; i < W; i++) out[j * W + i] = Math.sqrt(d[i]);
  }
  return out;
}
// positive inside, in cells
export function signedDist(mask, W, H) {
  const N = W * H, outside = new Uint8Array(N);
  for (let k = 0; k < N; k++) outside[k] = mask[k] ? 0 : 1;
  const toIn = distTo(mask, W, H), toOut = distTo(outside, W, H), s = new Float32Array(N);
  for (let k = 0; k < N; k++) s[k] = mask[k] ? toOut[k] - 0.5 : -(toIn[k] - 0.5);
  return s;
}
export function fillHoles(mask, W, H) {
  const seen = new Uint8Array(W * H), stack = [];
  const push = (k) => { if (!mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); } };
  for (let i = 0; i < W; i++) { push(i); push((H - 1) * W + i); }
  for (let j = 0; j < H; j++) { push(j * W); push(j * W + W - 1); }
  while (stack.length) {
    const k = stack.pop(), i = k % W, j = (k / W) | 0;
    if (i > 0) push(k - 1); if (i < W - 1) push(k + 1); if (j > 0) push(k - W); if (j < H - 1) push(k + W);
  }
  for (let k = 0; k < W * H; k++) if (!seen[k]) mask[k] = 1;
}
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// keep the working grid at a sane size
export const MAX_CELLS = 700000;
export function fitGrid(wMM, hMM, res) {
  let W = Math.max(8, Math.round(wMM / res)), H = Math.max(8, Math.round(hMM / res));
  if (W * H > MAX_CELLS) {
    res *= Math.sqrt(W * H / MAX_CELLS);
    W = Math.max(8, Math.round(wMM / res)); H = Math.max(8, Math.round(hMM / res));
  }
  return { W, H, res };
}

export function sampleImage(img, rect, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H).data;
}
export const lumAt = (px, k) => (0.299 * px[k * 4] + 0.587 * px[k * 4 + 1] + 0.114 * px[k * 4 + 2]) / 255;
export const neighbours = (k, W, H) => {
  const i = k % W, j = (k / W) | 0;
  return [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1];
};

export function maskBox(mask, W, H) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (mask[j * W + i]) {
    if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

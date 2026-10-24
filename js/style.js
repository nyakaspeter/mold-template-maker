// Guessing what kind of picture an image is, to choose the 3D method and starting settings.
import { sampleImage } from './grid.js';
import { shapeMask } from './outline.js';

// Picture types and their starting settings: drawings and flat cartoons are split into colour areas; photos,
// 3D renders and paintings use AI depth; smooth greyscale height maps use brightness as height.
// In a photo or a render dark areas are shadows and colour changes are surface colour, not drawn lines, so they
// get no grooves; a painting's lines and brush texture are part of the picture.
export const SHADED = ['photo', 'render', 'painting'];
export const STYLE_PRESETS = {
  heightmap: { reliefH: 5, gamma: 1, puff: 0, edgeSoft: 0.5, lineDepth: 0, edgeDepth: 0, detail: 0 },
  lineart: { lineDark: 0.62, areaDetail: 6.5, reliefH: 2, puff: 2, lineDepth: 0.6, edgeDepth: 0, detail: 0 },
  flat: { lineDark: 0.38, areaDetail: 8, reliefH: 3, puff: 2, lineDepth: 0.5, edgeDepth: 0, detail: 0 },
  photo: { lineDark: 0.38, reliefH: 10, gamma: 1, puff: 0.5, edgeSoft: 0.8, lineDepth: 0, edgeDepth: 0, detail: 0.2, reopen: 0.5 },
  render: { lineDark: 0.3, reliefH: 8, gamma: 1, puff: 1, edgeSoft: 1, lineDepth: 0.2, edgeDepth: 0.15, detail: 0.2, reopen: 0.5 },
  painting: { lineDark: 0.38, reliefH: 6, gamma: 1, puff: 1.5, edgeSoft: 1, lineDepth: 0.3, edgeDepth: 0.3, detail: 0.5, reopen: 0.5 },
  // any picture with a model that knows the surface: the shape comes from the geometry alone, without the
  // rounded rim, grooves and brightness detail that stand in for it otherwise (see app.js for drawings)
  sculpt: { lineDark: 0.38, puff: 0, edgeSoft: 0.3, lineDepth: 0, edgeDepth: 0, detail: 0, reliefSmooth: 0, flatten: 0.6, stepH: 0.6, fineDetail: 1 },
};

// Guess the type from small copies of the image. Besides colour statistics inside the shape, the fine-scale noise in
// smooth areas tells photos (sensor grain, JPEG, real texture) from drawn and rendered pictures, and how much of the
// shape is smooth shading with little fine texture tells 3D renders from paintings.
// Returns { type, scene, transparent, shading }: `scene` is how much the colours around the picture's edge vary (0 for
// a plain backdrop), `transparent` whether it has its own outline, `shading` the share of soft gradients inside the
// shape (0 for pure flat colour).
export function analyzeImage(img) {
  const sc = Math.min(1, 300 / Math.max(img.width, img.height));
  const W = Math.max(8, Math.round(img.width * sc)), H = Math.max(8, Math.round(img.height * sc));
  const px = sampleImage(img, { x: 0, y: 0, w: img.width, h: img.height }, W, H);
  const mask = shapeMask(px, W, H, { tol: 40 });
  let n = 0, sat = 0, flat = 0, sharp = 0;
  const bins = new Map();
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const k = j * W + i;
      if (!mask[k]) continue;
      const r = px[k * 4], g = px[k * 4 + 1], b = px[k * 4 + 2], mx = Math.max(r, g, b);
      n++; sat += mx ? (mx - Math.min(r, g, b)) / mx : 0;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(px[k * 4 + c] - px[(k + 1) * 4 + c]), Math.abs(px[k * 4 + c] - px[(k + W) * 4 + c]));
      if (d < 4) flat++;
      if (d > 40) sharp++;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      bins.set(key, (bins.get(key) || 0) + 1);
    }
  }
  let clear = 0;
  for (let k = 0; k < W * H; k++) if (px[k * 4 + 3] < 200) clear++;
  const transparent = clear > W * H * 0.01;
  if (!n) return { type: 'flat', scene: 0, transparent, shading: 0 };
  const top12 = [...bins.values()].sort((a, b) => b - a).slice(0, 12).reduce((a, b) => a + b, 0) / n;
  const { noise, smooth, texture } = fineStats(img, mask, W, H);
  // how much the colours around the picture's edge vary: a scene rather than a backdrop
  const edge = [];
  for (let i = 0; i < W; i++) edge.push(i, (H - 1) * W + i);
  for (let j = 0; j < H; j++) edge.push(j * W, j * W + W - 1);
  const mean = [0, 1, 2].map((c) => edge.reduce((a, k) => a + px[k * 4 + c], 0) / edge.length);
  const scene = edge.reduce((a, k) => a + Math.hypot(px[k * 4] - mean[0], px[k * 4 + 1] - mean[1], px[k * 4 + 2] - mean[2]), 0) / edge.length;
  // grain marks a photo; a retouched or recompressed photo has lost it, but is still a smooth, untextured subject
  // in front of a scene (paintings in a scene have brush texture, renders mostly a plain backdrop)
  let type;
  if (sat / n < 0.1 && sharp / n < 0.03 && noise < 0.5) type = 'heightmap';
  else if (noise >= 1.3 || (smooth >= 0.7 && noise >= 0.6) || (scene > 50 && texture < 3.5 && smooth >= 0.45)) type = 'photo';
  else if (sat / n < 0.1) type = 'lineart';
  else if ((top12 >= 0.5 || flat / n >= 0.35) && smooth < 0.45) type = 'flat'; // few colours, and not shaded (a shiny render)
  else type = smooth >= 0.55 && texture < 3.5 ? 'render' : 'painting';
  return { type, scene, transparent, shading: smooth };
}

// On a larger copy, inside the shape: noise = median brightness deviation from the 4 neighbours where the picture
// is otherwise smooth; smooth = share of gentle gradients (shading); texture = mean deviation everywhere.
function fineStats(img, mask, mw, mh) {
  const sc = Math.min(1, 800 / Math.max(img.width, img.height));
  const W = Math.max(8, Math.round(img.width * sc)), H = Math.max(8, Math.round(img.height * sc));
  const px = sampleImage(img, { x: 0, y: 0, w: img.width, h: img.height }, W, H);
  const L = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) L[k] = 0.299 * px[k * 4] + 0.587 * px[k * 4 + 1] + 0.114 * px[k * 4 + 2];
  const dev = [];
  let gentle = 0, all = 0, tex = 0;
  for (let j = 2; j < H - 2; j++) {
    for (let i = 2; i < W - 2; i++) {
      const k = j * W + i;
      if (px[k * 4 + 3] < 200 || !mask[Math.min(mh - 1, (j * mh / H) | 0) * mw + Math.min(mw - 1, (i * mw / W) | 0)]) continue;
      const g = Math.hypot(L[k + 2] - L[k - 2], L[k + 2 * W] - L[k - 2 * W]) / 4;
      const lap = Math.abs(L[k] - (L[k - 1] + L[k + 1] + L[k - W] + L[k + W]) / 4);
      all++; tex += lap;
      if (g < 6) dev.push(lap);
      if (g > 0.7 && g < 8) gentle++;
    }
  }
  dev.sort((a, b) => a - b);
  return { noise: dev.length ? dev[dev.length >> 1] : 0, smooth: all ? gentle / all : 0, texture: all ? tex / all : 0 };
}

// Guessing what kind of picture an image is, to choose the 3D method and starting settings.
import { sampleImage } from './grid.js';
import { shapeMask } from './outline.js';

// Guess the drawing style from a small copy of the image, to pick the 3D method and starting settings:
// drawings and flat cartoons are split into colour areas; shaded renders and paintings use AI depth;
// smooth greyscale height maps use brightness as height.
export const STYLE_PRESETS = {
  heightmap: { reliefH: 5, gamma: 1, puff: 0, edgeSoft: 0.5, lineDepth: 0, edgeDepth: 0, detail: 0 },
  lineart: { lineDark: 0.62, colorTol: 24, simplify: 2, reliefH: 2, puff: 2, lineDepth: 0.6, edgeDepth: 0, detail: 0 },
  flat: { lineDark: 0.38, colorTol: 16, simplify: 0, reliefH: 3, puff: 2, lineDepth: 0.5, edgeDepth: 0, detail: 0 },
  shaded: { lineDark: 0.38, reliefH: 6, gamma: 1, puff: 1.5, edgeSoft: 1, lineDepth: 0.3, edgeDepth: 0.3, detail: 0.5 },
};
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
  if (!n) return 'flat';
  const top12 = [...bins.values()].sort((a, b) => b - a).slice(0, 12).reduce((a, b) => a + b, 0) / n;
  if (sat / n < 0.1) return sharp / n < 0.03 ? 'heightmap' : 'lineart';
  if (top12 >= 0.5 || flat / n >= 0.35) return 'flat';
  return 'shaded';
}

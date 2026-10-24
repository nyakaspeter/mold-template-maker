// Turning an image into heights: depth, cartoon colour areas, line grooves, surface detail.
import { blur, distTo, smoothstep, fitGrid, sampleImage, sampleField, lumAt, neighbours, maskBox } from './grid.js';
import { editCells, shapeMask, reopenBackgroundHoles } from './outline.js';
import { sculptRelief } from './sculpt.js';

// Low-resolution pass over the whole image: the background colour, and where the shape is (its box in picture
// pixels; the whole picture if no shape is found).
export function subjectBox(img, p, edit) {
  const pw = 400, ph = Math.max(8, Math.round(pw * img.height / img.width));
  const full = { x: 0, y: 0, w: img.width, h: img.height };
  const pm = shapeMask(sampleImage(img, full, pw, ph), pw, ph, { ...p, edit: editCells(edit, img, full, pw, ph) });
  const pb = maskBox(pm, pw, ph), sx = img.width / pw, sy = img.height / ph;
  return { bgc: pm.bgc, box: pb ? { x0: pb.x0 * sx, y0: pb.y0 * sy, x1: pb.x1 * sx, y1: pb.y1 * sy } : { x0: 0, y0: 0, x1: img.width, y1: img.height } };
}

// aiDepth may cover only a crop of the picture (`crop`, in picture pixels; see build-worker.js).
export function hfFromImage(img, aiDepth, p, edit) {
  const quick = subjectBox(img, p, edit), q = { ...p, bgc: quick.bgc };
  let box = quick.box;
  // full pass on the shape plus a margin; the grid is scaled so the shape itself is "Object width" wide.
  // If the full pass finds a different extent than the quick one, rescale once.
  let W, H, res, px, mask, N, rect, mmPerPx;
  for (let pass = 0; pass < 2; pass++) {
    const m = 0.03 * Math.max(img.width, img.height);
    rect = { x: Math.max(0, box.x0 - m), y: Math.max(0, box.y0 - m) };
    rect.w = Math.min(img.width, box.x1 + m) - rect.x; rect.h = Math.min(img.height, box.y1 + m) - rect.y;
    mmPerPx = p.width / (box.x1 - box.x0);
    ({ W, H, res } = fitGrid(rect.w * mmPerPx, rect.h * mmPerPx, p.res));
    px = sampleImage(img, rect, W, H); N = W * H;
    mask = shapeMask(px, W, H, { ...q, cellsPerMm: 1 / res, edit: editCells(edit, img, rect, W, H) });
    const b = maskBox(mask, W, H);
    if (!b) break;
    const fx = rect.w / W, fy = rect.h / H;
    const nb = { x0: rect.x + b.x0 * fx, y0: rect.y + b.y0 * fy, x1: rect.x + b.x1 * fx, y1: rect.y + b.y1 * fy };
    if (Math.abs((nb.x1 - nb.x0) - (box.x1 - box.x0)) <= 0.015 * (box.x1 - box.x0)) break;
    box = nb;
  }
  const lum = new Float32Array(N);
  for (let k = 0; k < N; k++) lum[k] = lumAt(px, k);

  // depth (AI, or brightness) normalised to 0..1 inside the shape (2nd..98th percentile)
  let val = lum;
  const sculpt = p.depthMode === 'sculpt' && aiDepth?.geo;
  let geo = null;
  if (aiDepth) {
    const c = aiDepth.crop || { x: 0, y: 0, w: img.width, h: img.height }, ax = aiDepth.width / c.w, ay = aiDepth.height / c.h;
    const r = { x: (rect.x - c.x) * ax, y: (rect.y - c.y) * ay, w: rect.w * ax, h: rect.h * ay };
    const field = (data) => sampleField({ width: aiDepth.width, height: aiDepth.height, data }, r, W, H);
    val = field(aiDepth.data);
    // in drawings the paper inside the outlines looks as far away as the background, so only shaded images, and not
    // after an AI cut-out (it has its gaps). MoGe's true depth makes eye sockets and nostrils nearly as deep as the
    // background: there a gap has to be much closer to the background's depth before it is opened
    if ((p.depthMode === 'ai' || p.depthMode === 'sculpt') && p.reopen > 0 && !p.cutout) {
      reopenBackgroundHoles(mask, val, W, H, res, p.depthMode === 'sculpt' ? 0.4 * p.reopen : p.reopen);
    }
    if (sculpt) {
      const g = aiDepth.geo;
      geo = { height: field(g.height), slopeX: field(g.slopeX), slopeY: field(g.slopeY) };
      if (g.fineX && p.fineDetail > 0) { // finer detail from Depth Anything (see sculpt.js fuseDepthDetail)
        const fx = field(g.fineX), fy = field(g.fineY);
        for (let k = 0; k < N; k++) { geo.slopeX[k] += p.fineDetail * fx[k]; geo.slopeY[k] += p.fineDetail * fy[k]; }
      }
    }
  }
  if (geo) {
    // world units to mm at the shape's typical depth (a pixel there is depth / pxPerDepth world units wide)
    const zs = [];
    for (let k = 0; k < N; k += Math.max(1, Math.floor(N / 20000))) if (mask[k]) zs.push(-geo.height[k]);
    zs.sort((a, b) => a - b);
    const zRef = zs.length ? zs[zs.length >> 1] : 1, mmPerWorld = mmPerPx * aiDepth.geo.pxPerDepth / Math.max(1e-9, zRef);
    for (let k = 0; k < N; k++) geo.height[k] *= mmPerWorld;
  }
  const sample = [];
  const stride = Math.max(1, Math.floor(N / 60000));
  for (let k = 0; k < N; k += stride) if (mask[k]) sample.push(val[k]);
  sample.sort((a, b) => a - b);
  const lo = sample.length ? sample[Math.floor(sample.length * 0.02)] : 0;
  const hi = sample.length ? sample[Math.floor(sample.length * 0.98)] : 1;
  const span = Math.max(1e-6, hi - lo);
  // the nearest 2 % (a nose, a fingertip) is eased in above the range instead of cut off flat; the tallest point
  // is then the top of the range
  const knee = 0.08, depth01 = new Float32Array(N);
  let top = 1;
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    let t = Math.max(0, (val[k] - lo) / span);
    if (t > 1) t = 1 + knee * (1 - Math.exp(-(t - 1) / knee));
    depth01[k] = t;
    if (t > top) top = t;
  }
  for (let k = 0; k < N; k++) depth01[k] /= top;

  const lines = inkLines(lum, mask, W, H, res, p.lineDark);
  let relief;
  if (p.depthMode === 'cartoon') {
    if (!aiDepth) depth01.fill(0);
    relief = cartoonRelief(px, mask, lines, depth01, W, H, res, p);
  } else if (geo) relief = sculptRelief(geo, mask, W, H, res, p);
  else {
    relief = new Float32Array(N);
    for (let k = 0; k < N; k++) if (mask[k]) relief[k] = Math.pow(depth01[k], p.gamma) * p.reliefH;
  }
  if (p.detail > 0) addSurfaceDetail(relief, lum, mask, W, H, res, p.detail);
  if (p.edgeDepth > 0) carveColourEdges(relief, px, mask, W, H, res, p.edgeDepth);
  return { W, H, res, mask, relief, lines, px, rect, kind: 'image', cartoon: p.depthMode === 'cartoon' };
}

// 0..1 on thin dark strokes. Big dark fills (pupils, black hair, dark boots) are areas, not lines.
export function inkLines(lum, mask, W, H, res, darkness) {
  const N = W * H, lines = new Float32Array(N), light = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (mask[k]) lines[k] = smoothstep(darkness, darkness - 0.2, lum[k]);
    light[k] = lines[k] > 0.5 ? 0 : 1;
  }
  const thr = Math.max(2.5, 0.45 / res); // half the widest stroke still counted as a line, in cells
  const dLight = distTo(light, W, H), core = new Uint8Array(N);
  let any = false;
  for (let k = 0; k < N; k++) if (!light[k] && dLight[k] > thr) { core[k] = 1; any = true; }
  if (any) {
    const dCore = distTo(core, W, H);
    for (let k = 0; k < N; k++) if (!light[k] && dCore[k] <= thr + 1) lines[k] = 0;
  }
  return lines;
}

// Fine relief from light and dark: brighter than the surroundings = slightly raised.
export function addSurfaceDetail(relief, lum, mask, W, H, res, amount) {
  const N = W * H, m = new Float32Array(N), lm = new Float32Array(N);
  for (let k = 0; k < N; k++) { m[k] = mask[k]; lm[k] = lum[k] * mask[k]; }
  const sig = Math.max(1.5, 1 / res), bl = blur(lm, W, H, sig), bm = blur(m, W, H, sig);
  const hp = new Float32Array(N);
  let s2 = 0, n = 0;
  for (let k = 0; k < N; k++) if (mask[k] && bm[k] > 1e-3) { hp[k] = lum[k] - bl[k] / bm[k]; s2 += hp[k] * hp[k]; n++; }
  const sd = Math.sqrt(s2 / Math.max(1, n)) || 1;
  for (let k = 0; k < N; k++) if (mask[k]) relief[k] += amount * Math.max(-1, Math.min(1, hp[k] / (2 * sd)));
}

// Grooves where the colour changes sharply inside the shape (eyes, mouth, stripes on renders and paintings).
export function carveColourEdges(relief, px, mask, W, H, res, depth) {
  const N = W * H, ch = [0, 1, 2].map((c) => {
    const a = new Float32Array(N);
    for (let k = 0; k < N; k++) a[k] = px[k * 4 + c] / 255;
    return blur(a, W, H, 0.8);
  });
  const e = new Float32Array(N);
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      if (!mask[k] || !mask[k - 1] || !mask[k + 1] || !mask[k - W] || !mask[k + W]) continue;
      let g = 0;
      for (const a of ch) g = Math.max(g, Math.hypot(a[k + 1] - a[k - 1], a[k + W] - a[k - W]));
      e[k] = smoothstep(0.06, 0.2, g);
    }
  }
  const eb = blur(e, W, H, Math.max(0.6, 0.1 / res));
  for (let k = 0; k < N; k++) if (mask[k]) relief[k] -= depth * eb[k];
}

// Edge-preserving smoothing: evens out paint texture and shading so colour areas don't shatter.
export function simplifyColours(px, W, H, passes) {
  let src = px;
  for (let pass = 0; pass < passes; pass++) {
    const dst = new Uint8ClampedArray(src.length);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        let r = 0, g = 0, b = 0, ws = 0;
        for (let dj = -2; dj <= 2; dj++) {
          const jj = j + dj; if (jj < 0 || jj >= H) continue;
          for (let di = -2; di <= 2; di++) {
            const ii = i + di; if (ii < 0 || ii >= W) continue;
            const q = jj * W + ii;
            const dr = src[q * 4] - src[k * 4], dg = src[q * 4 + 1] - src[k * 4 + 1], db = src[q * 4 + 2] - src[k * 4 + 2];
            const w = Math.exp(-(di * di + dj * dj) / 4.5 - (dr * dr + dg * dg + db * db) / 1800);
            r += src[q * 4] * w; g += src[q * 4 + 1] * w; b += src[q * 4 + 2] * w; ws += w;
          }
        }
        dst[k * 4] = r / ws; dst[k * 4 + 1] = g / ws; dst[k * 4 + 2] = b / ws; dst[k * 4 + 3] = src[k * 4 + 3];
      }
    }
    src = dst;
  }
  return src;
}

// Cartoon mode: split the drawing into flat colour areas (separated by ink lines and colour changes),
// stack each area at its own height (AI depth, if any) and round each one off like a cushion.
export function cartoonRelief(px, mask, lines, depth01, W, H, res, p) {
  const N = W * H, label = new Int32Array(N).fill(-1);
  if (p.simplify > 0) px = simplifyColours(px, W, H, p.simplify);
  const tol2 = (p.colorTol * 2.55) ** 2;
  const diff2 = (a, b) => {
    const dr = px[a * 4] - px[b * 4], dg = px[a * 4 + 1] - px[b * 4 + 1], db = px[a * 4 + 2] - px[b * 4 + 2];
    return dr * dr + dg * dg + db * db;
  };
  const ink = (k) => lines[k] > 0.5;
  const sizes = [], stack = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || ink(s) || label[s] >= 0) continue;
    const id = sizes.length; let size = 0;
    label[s] = id; stack.push(s);
    while (stack.length) {
      const k = stack.pop(); size++;
      for (const q of neighbours(k, W, H)) {
        if (q < 0 || label[q] >= 0 || !mask[q] || ink(q) || diff2(k, q) > tol2) continue;
        label[q] = id; stack.push(q);
      }
    }
    sizes.push(size);
  }
  // specks (anti-aliasing fringes, texture) are absorbed by the most similar neighbouring area
  const minSize = Math.max(6, Math.round((0.6 / res) ** 2));
  let todo = [];
  for (let k = 0; k < N; k++) if (label[k] >= 0 && sizes[label[k]] < minSize) { label[k] = -2; todo.push(k); }
  for (let pass = 0; pass < 60 && todo.length; pass++) {
    const next = [], set = [];
    for (const k of todo) {
      let best = -1, bd = Infinity;
      for (const q of neighbours(k, W, H)) if (q >= 0 && label[q] >= 0) { const d = diff2(k, q); if (d < bd) { bd = d; best = label[q]; } }
      if (best >= 0) set.push(k, best); else next.push(k);
    }
    for (let i = 0; i < set.length; i += 2) label[set[i]] = set[i + 1];
    todo = next;
  }
  for (const k of todo) label[k] = -1;

  // distance from each cell to the edge of its own area
  const edge = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const l = label[k];
    if (l < 0) { edge[k] = 1; continue; }
    for (const q of neighbours(k, W, H)) if (q >= 0 && label[q] !== l) { edge[k] = 1; break; }
  }
  const dist = distTo(edge, W, H);
  const n = sizes.length, maxD = new Float32Array(n), sum = new Float64Array(n), cnt = new Float64Array(n);
  for (let k = 0; k < N; k++) {
    const l = label[k]; if (l < 0) continue;
    const d = (dist[k] + 0.5) * res;
    if (d > maxD[l]) maxD[l] = d;
    sum[l] += depth01[k]; cnt[l]++;
  }
  const layer = new Float32Array(n);
  for (let l = 0; l < n; l++) layer[l] = cnt[l] ? (sum[l] / cnt[l]) * p.reliefH : 0;

  // circular cushion profile, radius capped by the area's own size so small details stay small
  const puffR = Math.max(0.5, p.puff * 2.5), flat = p.puff > 0 ? p.puff / puffR : 0;
  const relief = new Float32Array(N), done = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const l = label[k]; if (l < 0) continue;
    const R = Math.min(puffR, maxD[l]), x = Math.min((dist[k] + 0.5) * res, R);
    relief[k] = layer[l] + Math.sqrt(Math.max(0, R * R - (R - x) * (R - x))) * flat;
    done[k] = 1;
  }
  // lines take the lower of the neighbouring areas' levels
  todo = [];
  for (let k = 0; k < N; k++) if (mask[k] && !done[k]) todo.push(k);
  for (let pass = 0; pass < 40 && todo.length; pass++) {
    const next = [], vals = [];
    for (const k of todo) {
      let m = Infinity;
      for (const q of neighbours(k, W, H)) {
        if (q >= 0 && done[q] && mask[q]) m = Math.min(m, label[q] >= 0 ? layer[label[q]] : relief[q]);
      }
      if (m < Infinity) vals.push(k, m); else next.push(k);
    }
    for (let i = 0; i < vals.length; i += 2) { relief[vals[i]] = vals[i + 1]; done[vals[i]] = 1; }
    todo = next;
  }
  return relief;
}

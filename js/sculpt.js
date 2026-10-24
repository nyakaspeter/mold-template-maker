// Sculpted relief from AI surface geometry (MoGe-2 point map and normals): the shape is rebuilt from its surface
// slopes, so curvature and overlapping parts survive while overall depth is flattened (a bas-relief, after
// Weyrich et al. 2007 "Digital bas-relief from 3D scenes" and Kerber et al. 2009).
import { distTo } from './grid.js';

// MoGe predicts points up to an unknown depth shift. Find the shift (and focal length) that makes the points
// project back onto their own pixels, as MoGe's own recover_focal_shift does. uv spans the view plane with
// the image diagonal = 2.
function viewPlane(w, h) {
  const a = w / h, d = Math.sqrt(1 + a * a);
  return { sx: a / d, sy: 1 / d };
}
function recoverShift(points, valid, w, h) {
  const { sx, sy } = viewPlane(w, h), step = Math.max(1, Math.round(Math.max(w, h) / 64));
  const xs = [], ys = [], zs = [], us = [], vs = [];
  for (let j = step >> 1; j < h; j += step) {
    for (let i = step >> 1; i < w; i += step) {
      const k = j * w + i;
      if (!valid[k]) continue;
      xs.push(points[k * 3]); ys.push(points[k * 3 + 1]); zs.push(points[k * 3 + 2]);
      us.push(((i + 0.5) / w * 2 - 1) * sx); vs.push(((j + 0.5) / h * 2 - 1) * sy);
    }
  }
  const n = zs.length;
  if (n < 16) return { shift: 0, focal: 1 };
  let zmin = Infinity, zmax = -Infinity;
  for (const z of zs) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  // reprojection error for a shift, with the best focal length for it in closed form
  const err = (t) => {
    let sxu = 0, sxx = 0;
    for (let q = 0; q < n; q++) {
      const zz = zs[q] + t; if (zz <= 1e-6) return [Infinity, 1];
      const a = xs[q] / zz, b = ys[q] / zz;
      sxu += a * us[q] + b * vs[q]; sxx += a * a + b * b;
    }
    const f = sxu / Math.max(1e-12, sxx);
    let e = 0;
    for (let q = 0; q < n; q++) {
      const zz = zs[q] + t, a = f * xs[q] / zz - us[q], b = f * ys[q] / zz - vs[q];
      e += a * a + b * b;
    }
    return [e, f];
  };
  // coarse scan of z + shift from just above zero to far beyond the scene, then golden-section refinement
  const lo0 = -zmin + 1e-3 * Math.max(1e-6, zmax - zmin), span = Math.max(1e-6, zmax - zmin, Math.abs(zmax));
  let best = 0, bestE = err(0)[0];
  const ts = [];
  for (let q = 0; q <= 60; q++) ts.push(lo0 + span * (Math.pow(1.25, q) - 1) / 100);
  for (let q = 0; q < ts.length; q++) { const e = err(ts[q])[0]; if (e < bestE) { bestE = e; best = q; } }
  let a = ts[Math.max(0, best - 1)], b = ts[Math.min(ts.length - 1, best + 1)];
  if (bestE === err(0)[0] && !(0 > a && 0 < b)) { a = Math.min(a, 0); b = Math.max(b, 0); }
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), ec = err(c)[0], ed = err(d)[0];
  for (let it = 0; it < 60; it++) {
    if (ec < ed) { b = d; d = c; ed = ec; c = b - g * (b - a); ec = err(c)[0]; }
    else { a = c; c = d; ec = ed; d = a + g * (b - a); ed = err(d)[0]; }
  }
  const shift = (a + b) / 2;
  return { shift, focal: err(shift)[1] };
}

// MoGe output (points h×w×3, normals h×w×3, mask h×w, OpenCV camera axes: x right, y down, z away) → maps over
// the picture: `data` depth 0..1 (higher = nearer, like the other depth models) plus the geometry itself:
// `height` = -depth (world units), `slopeX`/`slopeY` = how fast the surface rises to the right / downwards
// (from the normals), and `pxPerDepth` to turn world units into picture pixels at a given depth.
export function geometryFromMoGe(points, normals, mask, w, h, imgW) {
  const n = w * h, valid = new Uint8Array(n);
  for (let k = 0; k < n; k++) valid[k] = mask[k] > 0.5 && points[k * 3 + 2] > -1e6 ? 1 : 0;
  const { shift, focal } = recoverShift(points, valid, w, h);
  const { sx } = viewPlane(w, h);
  const height = new Float32Array(n), slopeX = new Float32Array(n), slopeY = new Float32Array(n), data = new Float32Array(n);
  let far = -Infinity, near = Infinity;
  for (let k = 0; k < n; k++) {
    const z = points[k * 3 + 2] + shift;
    if (valid[k] && z > 0) { if (z > far) far = z; if (z < near) near = z; }
  }
  if (!(far > near)) { far = 1; near = 0; }
  for (let k = 0; k < n; k++) {
    const z = valid[k] ? Math.max(near, points[k * 3 + 2] + shift) : far; // sky and invalid: as far as the farthest
    height[k] = -z;
    data[k] = (far - z) / (far - near);
    // a surface z = a·x has the normal ∝ (a, 0, -1): rising towards the camera to the right is -a = nx / nz
    let nz = normals[k * 3 + 2];
    if (nz > -0.05) nz = -0.05; // edge-on or facing away: cap the slope at 20
    slopeX[k] = Math.max(-20, Math.min(20, normals[k * 3] / nz));
    slopeY[k] = Math.max(-20, Math.min(20, normals[k * 3 + 1] / nz));
  }
  // a pixel of the original picture covers depth × (2·sx / focal) / imgW world units
  return { width: w, height: h, data, geo: { height, slopeX, slopeY, valid, pxPerDepth: focal * imgW / (2 * sx) } };
}

// Finer surface detail from MoGe runs on overlapping tiles of the picture (each tile is a smaller part of the picture
// at the same input size, so MoGe sees it in more detail). The tiles' slopes give the fine detail, the whole-picture
// run the large-scale shape: a tile is a crop seen as if centred, so its slopes are tilted a little, which only shifts
// them on a large scale. Returns the geometry on a grid `n` times as fine as the whole-picture run's.
// tiles: [{ x, y, w, h (in picture pixels), width, height, normals }]
export function fuseTiles(base, tiles, n, imgW, imgH, sigma = 2.5) {
  const bw = base.width, bh = base.height, W = Math.round(bw * n), H = Math.round(bh * n), N = W * H;
  const fx = new Float32Array(N), fy = new Float32Array(N), fw = new Float32Array(N);
  for (const t of tiles) {
    for (let j = 0; j < H; j++) {
      const v = ((j + 0.5) / H * imgH - t.y) / t.h;
      if (v < 0 || v >= 1) continue;
      for (let i = 0; i < W; i++) {
        const u = ((i + 0.5) / W * imgW - t.x) / t.w;
        if (u < 0 || u >= 1) continue;
        const wt = Math.min(u, 1 - u, v, 1 - v) + 1e-3; // feathered towards the tile's edges
        const q = Math.min(t.height - 1, (v * t.height) | 0) * t.width + Math.min(t.width - 1, (u * t.width) | 0);
        let nz = t.normals[q * 3 + 2];
        if (nz > -0.05) nz = -0.05;
        const k = j * W + i;
        fx[k] += wt * Math.max(-20, Math.min(20, t.normals[q * 3] / nz));
        fy[k] += wt * Math.max(-20, Math.min(20, t.normals[q * 3 + 1] / nz));
        fw[k] += wt;
      }
    }
  }
  // the base maps, bilinearly upsampled
  const up = (a) => {
    const o = new Float32Array(N);
    for (let j = 0; j < H; j++) {
      const sy = Math.min(bh - 1.001, Math.max(0, (j + 0.5) * bh / H - 0.5)), y0 = sy | 0, ay = sy - y0;
      for (let i = 0; i < W; i++) {
        const sx = Math.min(bw - 1.001, Math.max(0, (i + 0.5) * bw / W - 0.5)), x0 = sx | 0, ax = sx - x0, q = y0 * bw + x0;
        o[j * W + i] = (a[q] * (1 - ax) + a[q + 1] * ax) * (1 - ay) + (a[q + bw] * (1 - ax) + a[q + bw + 1] * ax) * ay;
      }
    }
    return o;
  };
  const g = base.geo, sx = up(g.slopeX), sy = up(g.slopeY), r = sigma * n;
  for (let k = 0; k < N; k++) if (fw[k]) { fx[k] /= fw[k]; fy[k] /= fw[k]; } else { fx[k] = sx[k]; fy[k] = sy[k]; }
  const lx = boxBlur(fx, W, H, r), ly = boxBlur(fy, W, H, r), bx = boxBlur(sx, W, H, r), by = boxBlur(sy, W, H, r);
  for (let k = 0; k < N; k++) { sx[k] = bx[k] + fx[k] - lx[k]; sy[k] = by[k] + fy[k] - ly[k]; }
  const valid = up(g.valid), v8 = new Uint8Array(N);
  for (let k = 0; k < N; k++) v8[k] = valid[k] > 0.5 ? 1 : 0;
  return { width: W, height: H, data: up(base.data),
    geo: { height: up(g.height), slopeX: sx, slopeY: sy, valid: v8, pxPerDepth: g.pxPerDepth } };
}

// Finer surface detail from a relative depth map (Depth Anything's fine pass): its depth is known only up to a scale
// that varies over the picture, so the scale is learned locally where both resolve the same shapes (a middle band),
// and only the band finer than MoGe resolves is kept, as `fineX`/`fineY` slopes to add (setting Fine detail).
// depth: { width, height, data }, higher = nearer. `patches`: how many of MoGe's patches span the picture's long
// side (its resolution limit).
export function fuseDepthDetail(ai, depth, patches = 60) {
  const { width: W, height: H } = ai, N = W * H, g = ai.geo;
  const fine = 0.5 * Math.max(W, H) / patches, mid = 2.5 * Math.max(W, H) / patches;
  const d = new Float32Array(N), dw = depth.width, dh = depth.height;
  for (let j = 0; j < H; j++) {
    const sy = Math.min(dh - 1.001, Math.max(0, (j + 0.5) * dh / H - 0.5)), y0 = sy | 0, ay = sy - y0;
    for (let i = 0; i < W; i++) {
      const sx = Math.min(dw - 1.001, Math.max(0, (i + 0.5) * dw / W - 0.5)), x0 = sx | 0, ax = sx - x0, q = y0 * dw + x0, a = depth.data;
      d[j * W + i] = (a[q] * (1 - ax) + a[q + 1] * ax) * (1 - ay) + (a[q + dw] * (1 - ax) + a[q + dw + 1] * ax) * ay;
    }
  }
  const grad = (dx) => {
    const o = new Float32Array(N);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      o[k] = dx ? (d[j * W + Math.min(W - 1, i + 1)] - d[j * W + Math.max(0, i - 1)]) / 2 : (d[Math.min(H - 1, j + 1) * W + i] - d[Math.max(0, j - 1) * W + i]) / 2;
    }
    return o;
  };
  const band = (f, a, b) => { const x = boxBlur(f, W, H, a), y = boxBlur(f, W, H, b); for (let k = 0; k < N; k++) x[k] -= y[k]; return x; };
  const local = Math.max(4 * mid, 0.08 * Math.max(W, H));
  g.fineX = new Float32Array(N); g.fineY = new Float32Array(N);
  for (const [gd, slope, add] of [[grad(true), g.slopeX, g.fineX], [grad(false), g.slopeY, g.fineY]]) {
    // the scale matches the two bands' strength (a regression would shrink it wherever they disagree a little),
    // and only where they agree in direction
    const bm = band(slope, fine, mid), bd = band(gd, fine, mid), md = new Float32Array(N), mm = new Float32Array(N), dd = new Float32Array(N);
    for (let k = 0; k < N; k++) { if (!g.valid[k]) continue; md[k] = bm[k] * bd[k]; mm[k] = bm[k] * bm[k]; dd[k] = bd[k] * bd[k]; }
    const cross = boxBlur(md, W, H, local), em = boxBlur(mm, W, H, local), ed = boxBlur(dd, W, H, local), low = boxBlur(gd, W, H, fine);
    for (let k = 0; k < N; k++) {
      const a = cross[k] > 0 ? Math.sqrt(em[k] / (ed[k] + 1e-12)) : 0;
      if (g.valid[k]) add[k] = a * (gd[k] - low[k]);
    }
  }
  return ai;
}

// Solve the screened Poisson equation  Σ_nbrs (h_k − h_q) + μ h_k = −div g  inside the mask (no constraint across
// the outline). Multigrid: each coarser level joins 2 × 2 cells (its operator is the fine one restricted to
// a coarser grid), the coarse level corrects the large-scale error, conjugate gradients the fine one.
const MU = 1e-4;
function level(W, H, mask, ex, ey, mu) {
  const N = W * H, diag = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    diag[k] += mu;
    if (ex[k]) { diag[k] += ex[k]; diag[k + 1] += ex[k]; }
    if (ey[k]) { diag[k] += ey[k]; diag[k + W] += ey[k]; }
  }
  return { W, H, N, mask, ex, ey, mu, diag };
}
function apply(L, v, out) {
  const { W, N, mask, ex, ey, diag } = L;
  for (let k = 0; k < N; k++) out[k] = mask[k] ? diag[k] * v[k] : 0;
  for (let k = 0; k < N; k++) {
    if (ex[k]) { out[k] -= ex[k] * v[k + 1]; out[k + 1] -= ex[k] * v[k]; }
    if (ey[k]) { out[k] -= ey[k] * v[k + W]; out[k + W] -= ey[k] * v[k]; }
  }
}
function coarsen(L) {
  const cW = Math.ceil(L.W / 2), cH = Math.ceil(L.H / 2), cN = cW * cH;
  const mask = new Uint8Array(cN), ex = new Float32Array(cN), ey = new Float32Array(cN);
  for (let j = 0; j < L.H; j++) {
    for (let i = 0; i < L.W; i++) {
      const k = j * L.W + i, c = (j >> 1) * cW + (i >> 1);
      if (L.mask[k]) mask[c] = 1;
      // the two fine edges between two blocks become the coarse edge, at half weight: block sums of the fine
      // equations are the same Laplacian on the twice as coarse grid (piecewise-constant aggregation alone is
      // twice as stiff, and its corrections only half the size they should be)
      if (L.ex[k] && i & 1) ex[c] += 0.5 * L.ex[k];
      if (L.ey[k] && j & 1) ey[c] += 0.5 * L.ey[k];
    }
  }
  return level(cW, cH, mask, ex, ey, L.mu * 4);
}
const restrict = (L, C, r) => {
  const out = new Float32Array(C.N);
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++) out[(j >> 1) * C.W + (i >> 1)] += r[j * L.W + i];
  return out;
};
function pcg(L, b, x, iters) {
  const { N, mask, diag } = L, r = new Float32Array(N), z = new Float32Array(N), p = new Float32Array(N), Ap = new Float32Array(N);
  apply(L, x, Ap);
  let rz = 0, bb = 0;
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    r[k] = b[k] - Ap[k]; z[k] = r[k] / diag[k]; p[k] = z[k]; rz += r[k] * z[k]; bb += b[k] * b[k];
  }
  for (let it = 0; it < iters && rz > 1e-14 * bb; it++) {
    apply(L, p, Ap);
    let pAp = 0;
    for (let k = 0; k < N; k++) pAp += p[k] * Ap[k];
    if (!(pAp > 0)) break;
    const a = rz / pAp;
    let rz2 = 0;
    for (let k = 0; k < N; k++) {
      if (!mask[k]) continue;
      x[k] += a * p[k]; r[k] -= a * Ap[k]; z[k] = r[k] / diag[k]; rz2 += r[k] * z[k];
    }
    const beta = rz2 / rz; rz = rz2;
    for (let k = 0; k < N; k++) p[k] = z[k] + beta * p[k];
  }
  return x;
}
function vcycle(levels, l, b) {
  const L = levels[l];
  if (l === levels.length - 1) return pcg(L, b, new Float32Array(L.N), 300);
  const x = pcg(L, b, new Float32Array(L.N), 6), r = new Float32Array(L.N);
  apply(L, x, r);
  for (let k = 0; k < L.N; k++) r[k] = b[k] - r[k];
  const C = levels[l + 1], e = vcycle(levels, l + 1, restrict(L, C, r));
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++) { const k = j * L.W + i; if (L.mask[k]) x[k] += e[(j >> 1) * C.W + (i >> 1)]; }
  return pcg(L, b, x, 6);
}
function solvePoisson(gx, gy, mask, W, H, cycles = 3) {
  const N = W * H, ex = new Float32Array(N), ey = new Float32Array(N), b = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    if ((k % W) + 1 < W && mask[k + 1]) { ex[k] = 1; b[k] -= gx[k]; b[k + 1] += gx[k]; }
    if (k + W < N && mask[k + W]) { ey[k] = 1; b[k] -= gy[k]; b[k + W] += gy[k]; }
  }
  const levels = [level(W, H, mask, ex, ey, MU)];
  while (levels.length < 10 && Math.min(levels[levels.length - 1].W, levels[levels.length - 1].H) > 16) levels.push(coarsen(levels[levels.length - 1]));
  const x = new Float32Array(N), r = new Float32Array(N);
  for (let c = 0; c < cycles; c++) {
    apply(levels[0], x, r);
    for (let k = 0; k < N; k++) r[k] = b[k] - r[k];
    const e = vcycle(levels, 0, r);
    for (let k = 0; k < N; k++) x[k] += e[k];
  }
  return x;
}

// Wide Gaussian-like blur in O(N) whatever the radius: three box blurs per direction.
function boxBlur(f, W, H, sigma) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)); // 3 passes of width w: σ² = (w² − 1) / 4
  let a = Float32Array.from(f), b = new Float32Array(W * H);
  const pass = (src, dst, n, m, stride, step) => { // n lines of m samples
    for (let l = 0; l < n; l++) {
      const o = l * stride;
      let s = 0, c = 0;
      for (let i = 0; i < Math.min(r, m); i++) { s += src[o + i * step]; c++; }
      for (let i = 0; i < m; i++) {
        if (i + r < m) { s += src[o + (i + r) * step]; c++; }
        if (i - r - 1 >= 0) { s -= src[o + (i - r - 1) * step]; c--; }
        dst[o + i * step] = s / c;
      }
    }
  };
  for (let it = 0; it < 3; it++) { pass(a, b, H, W, W, 1); [a, b] = [b, a]; pass(a, b, W, H, 1, W); [a, b] = [b, a]; }
  return a;
}
// Masked blur of an edge field: only edges with weight count, so the blur doesn't cross occlusions.
function blurEdges(g, wgt, W, H, sigma) {
  const N = W * H, gw = new Float32Array(N);
  for (let k = 0; k < N; k++) gw[k] = g[k] * wgt[k];
  const a = boxBlur(gw, W, H, sigma), b = boxBlur(wgt, W, H, sigma), out = new Float32Array(N);
  for (let k = 0; k < N; k++) out[k] = b[k] > 1e-4 ? a[k] / b[k] : 0;
  return out;
}

// The relief, in mm, over the W × H grid: geometry sampled to the grid (height in mm at true scale, slopes),
// the shape mask and settings: reliefH (total height), flatten (0 = true proportions, 1 = strongly flattened),
// stepH (height of the step where one part lies in front of another).
export function sculptRelief({ height, slopeX, slopeY }, mask, W, H, res, p) {
  const N = W * H, flatten = p.flatten ?? 0.6, stepH = p.stepH ?? 0.6;
  if (!(p.reliefH > 0)) return new Float32Array(N);
  // cells right at the outline carry background depth: no occlusion steps there
  const outside = new Uint8Array(N);
  for (let k = 0; k < N; k++) outside[k] = mask[k] ? 0 : 1;
  const rim = distTo(outside, W, H);
  // per edge (to the right, downwards): the step from the depth, and the same step from the normals
  const cx = new Float32Array(N), cy = new Float32Array(N), jx = new Float32Array(N), jy = new Float32Array(N);
  const wx = new Float32Array(N), wy = new Float32Array(N);
  // depth steps per edge, to compare each with its neighbours along the same line
  const dx = new Float32Array(N), dy = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    if ((k % W) + 1 < W && mask[k + 1]) dx[k] = Math.abs(height[k + 1] - height[k]);
    if (k + W < N && mask[k + W]) dy[k] = Math.abs(height[k + W] - height[k]);
  }
  // the 3rd largest of the 7 steps around an edge: low beside a sudden jump (spread over up to 2 cells), high along
  // a steep but continuous slope such as the side of a nose
  const around = (d, k, step) => {
    const v = [];
    for (let o = -3; o <= 3; o++) { const q = k + o * step; if (q >= 0 && q < N) v.push(d[q]); }
    return v.sort((a, b) => b - a)[2] ?? 0;
  };
  const edge = (k, q, s, c, jmp, wt) => {
    const gd = height[q] - height[k], gn = 0.5 * (s[k] + s[q]) * res;
    const deep = rim[k] > 2.5 && rim[q] > 2.5;
    // an occlusion: the depth jumps by much more than the surface itself slopes, and more than just beside it
    const step = q === k + 1 ? 1 : W;
    if (deep && Math.abs(gd) > 4 * res && Math.abs(gd) > 3 * Math.abs(gn) + 2 * res &&
      Math.abs(gd) > 2 * around(step === 1 ? dx : dy, k, step)) {
      jmp[k] = Math.sign(gd) * Math.tanh(Math.abs(gd) / (6 * res)); // a full step for a jump of a few cells or more
      return;
    }
    c[k] = gn; wt[k] = 1;
  };
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    const i = k % W;
    if (i + 1 < W && mask[k + 1]) edge(k, k + 1, slopeX, cx, jx, wx);
    if (k + W < N && mask[k + W]) edge(k, k + W, slopeY, cy, jy, wy);
  }
  // Flatten: large-scale form is compressed more than fine form (a relief sculptor's foreshortening), and steep
  // slopes more than gentle ones, so the overall bulge sinks while folds, rims and ornament keep their shape.
  let span = 0;
  for (let k = 0; k < N; k++) if (mask[k]) span++;
  const sigma = Math.max(2, 0.12 * Math.sqrt(span)), lowW = 1 - 0.8 * flatten, alpha = 4 * flatten;
  const shape = (c, wt) => {
    const low = blurEdges(c, wt, W, H, sigma), out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!wt[k]) continue;
      const g = lowW * low[k] + (c[k] - low[k]), s = Math.abs(g) / res;
      out[k] = alpha > 0 ? Math.sign(g) * res * Math.log1p(alpha * s) / alpha : g;
    }
    return out;
  };
  const gx = shape(cx, wx), gy = shape(cy, wy);
  const surf = solvePoisson(gx, gy, mask, W, H), steps = solvePoisson(jx, jy, mask, W, H);
  // (the overall tilt is kept: for a figure leaning towards the camera it is the pose, chest before belly)
  // scale the surface so surface + steps spans the depth range; the outline's fringe and the most extreme
  // thousandth don't count, so a stray cell can't take the range from the rest (it is clamped instead)
  const idx = [];
  const stride = Math.max(1, Math.floor(span / 12000));
  for (let k = 0, c = 0; k < N; k++) if (mask[k] && rim[k] > 2.5 && c++ % stride === 0) idx.push(k);
  if (!idx.length) for (let k = 0; k < N; k++) if (mask[k]) idx.push(k);
  const range = (scale) => {
    const v = idx.map((k) => scale * surf[k] + stepH * steps[k]).sort((a, b) => a - b);
    return { lo: v[Math.floor(v.length * 0.001)] ?? 0, hi: v[Math.floor(v.length * 0.999)] ?? 0 };
  };
  const sr = range(1), unit = Math.max(1e-6, sr.hi - sr.lo);
  let a = 0, b = 4 * p.reliefH / unit;
  for (let it = 0; it < 24; it++) {
    const m = (a + b) / 2, q = range(m);
    if (q.hi - q.lo < p.reliefH) a = m; else b = m;
  }
  const scale = Math.max(0.1 * p.reliefH / unit, a), { lo, hi } = range(scale);
  const relief = new Float32Array(N);
  for (let k = 0; k < N; k++) if (mask[k]) relief[k] = Math.min(hi - lo, Math.max(0, scale * surf[k] + stepH * steps[k] - lo));
  return relief;
}

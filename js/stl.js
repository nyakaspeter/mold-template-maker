// Reading an STL as a height map seen from above, or cut into two halves that each get a flat back.
import { fitGrid, distTo, neighbours } from './grid.js';

// The model's points, scaled and turned so the chosen side faces up (only turned, never mirrored)
function orient(geom, p) {
  const src = geom.attributes.position.array, s = p.scale / 100;
  const n = src.length / 3, pts = new Float32Array(src.length);
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  // p.stlUp is the side facing up, then how many quarter turns (anticlockwise seen from above), e.g. 'y' or 'y:1'
  const [up, turns] = p.stlUp.split(':'), q = (+turns || 0) % 4;
  for (let v = 0; v < n; v++) {
    const x = src[v * 3] * s, y = src[v * 3 + 1] * s, z = src[v * 3 + 2] * s;
    let X, Y, Z;
    // lying on a side, the model's own top (+Z) points to the back of the view, so it reads upright from above
    switch (up) {
      case '-z': X = x; Y = -y; Z = -z; break;
      case 'y': X = -x; Y = z; Z = y; break;
      case '-y': X = x; Y = z; Z = -y; break;
      case 'x': X = y; Y = z; Z = x; break;
      case '-x': X = -y; Y = z; Z = -x; break;
      default: X = x; Y = y; Z = z;
    }
    if (q === 1) [X, Y] = [-Y, X]; else if (q === 2) [X, Y] = [-X, -Y]; else if (q === 3) [X, Y] = [Y, -X];
    pts[v * 3] = X; pts[v * 3 + 1] = Y; pts[v * 3 + 2] = Z;
    if (X < minx) minx = X; if (X > maxx) maxx = X;
    if (Y < miny) miny = Y; if (Y > maxy) maxy = Y;
    if (Z < minz) minz = Z; if (Z > maxz) maxz = Z;
  }
  return { pts, n, minx, miny, minz, maxx, maxy, maxz };
}

// The model's top and bottom surface on a grid (seen from above), turned so the chosen side faces up.
// Kept for the last file and orientation, since moving the cut or changing the mold doesn't change it.
// Every point where the model's surface crosses a grid cell's vertical line: visit(cell, height, side), side being
// +1 or -1 by which way the triangle faces (up or down; which is which depends on the mesh's winding)
function sample(pts, n, W, H, res, minx, maxy, visit) {
  for (let t = 0; t < n; t += 3) {
    const u0 = (pts[t * 3] - minx) / res, v0 = (maxy - pts[t * 3 + 1]) / res, z0 = pts[t * 3 + 2];
    const u1 = (pts[t * 3 + 3] - minx) / res, v1 = (maxy - pts[t * 3 + 4]) / res, z1 = pts[t * 3 + 5];
    const u2 = (pts[t * 3 + 6] - minx) / res, v2 = (maxy - pts[t * 3 + 7]) / res, z2 = pts[t * 3 + 8];
    const area = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(u0, u1, u2))), i1 = Math.min(W - 1, Math.floor(Math.max(u0, u1, u2)));
    const j0 = Math.max(0, Math.ceil(Math.min(v0, v1, v2))), j1 = Math.min(H - 1, Math.floor(Math.max(v0, v1, v2)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w0 = ((u1 - i) * (v2 - j) - (u2 - i) * (v1 - j)) / area;
        const w1 = ((u2 - i) * (v0 - j) - (u0 - i) * (v2 - j)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        visit(j * W + i, w0 * z0 + w1 * z1 + w2 * z2, area > 0 ? 1 : -1);
      }
    }
  }
}

// The model's top and bottom surface on a grid (seen from above), turned so the chosen side faces up.
// Kept for the last file and orientation, since moving the cut or changing the mold doesn't change it.
let last = null;
function raster(geom, p) {
  if (last && last.geom === geom && last.scale === p.scale && last.up === p.stlUp && last.res === p.res) return last.r;
  const { pts, n, minx, miny, minz, maxx, maxy, maxz } = orient(geom, p);
  const { res } = fitGrid(maxx - minx, maxy - miny, p.res);
  const W = Math.floor((maxx - minx) / res) + 1, H = Math.floor((maxy - miny) / res) + 1;
  const top = new Float32Array(W * H).fill(-Infinity), bot = new Float32Array(W * H).fill(Infinity);
  sample(pts, n, W, H, res, minx, maxy, (k, z) => {
    if (z > top[k]) top[k] = z;
    if (z < bot[k]) bot[k] = z;
  });
  const r = { W, H, res, top, bot, minz, maxz, minx, maxy, pts, n };
  last = { geom, scale: p.scale, up: p.stlUp, res: p.res, r };
  return r;
}

// What the Auto choices pick. A flat back is a side that is a flat plane, opposite which the model has no overhangs
// (the one-piece mold would hold hardly more than the model itself); facing up from one, the model is made as it is.
// "Orientation: Auto" puts the best flat back down; with none, the model lies so the outline seen from above
// is largest (a figure with its arms out is cut into front and back), with the more detailed side up: a face rather
// than a back. flats: every up direction with a flat back below it, so "Cut into two halves: Auto" can follow a
// side picked by hand.
export function detectSTL(geom, p) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox, s = p.scale / 100;
  const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * s;
  const src = geom.attributes.position.array;
  let vol = 0; // the model's own volume (divergence theorem); meaningless if the mesh isn't closed
  for (let i = 0; i < src.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = src.subarray(i, i + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  vol = Math.abs(vol) * s * s * s;
  let flatBack = null, widest = null;
  const flats = [];
  for (const axis of ['z', 'y', 'x']) {
    const { W, H, res, top, bot, minz, maxz } = raster(geom, { ...p, stlUp: axis, res: Math.max(p.res, ext / 160) });
    const tol = Math.max(2 * res, 0.01 * (maxz - minz)), a = res * res;
    let cells = 0, flatDown = 0, flatUp = 0, volUp = 0, volDown = 0;
    for (let k = 0; k < W * H; k++) {
      if (top[k] === -Infinity) continue;
      cells++;
      if (bot[k] - minz < tol) flatDown++;
      if (maxz - top[k] < tol) flatUp++;
      volUp += (top[k] - minz) * a; volDown += (maxz - bot[k]) * a;
    }
    // facing up: +axis when the flat side is at the bottom, -axis when it is at the top
    for (const [up, flat, v] of [[axis, flatDown, volUp], ['-' + axis, flatUp, volDown]]) {
      const extra = vol > 0 ? v / vol - 1 : 0;
      if (flat < 0.9 * cells || extra >= 0.15) continue;
      flats.push(up);
      if (!flatBack || extra < flatBack.extra) flatBack = { up, extra };
    }
    if (!widest || cells * a > widest.area) widest = { up: axis, area: cells * a, top, bot, W, H, res };
  }
  if (!flatBack) { // the side with more surface detail faces up; about even (a symmetric model): keep +
    const { W, H, res, top, bot } = widest;
    const detail = (h) => {
      let sum = 0;
      for (let j = 1; j < H - 1; j++) {
        for (let i = 1; i < W - 1; i++) {
          const k = j * W + i, n = [h[k - 1], h[k + 1], h[k - W], h[k + W]];
          if (!isFinite(h[k]) || n.some((v) => !isFinite(v))) continue;
          sum += Math.min(1, Math.abs(4 * h[k] - n[0] - n[1] - n[2] - n[3]) / res); // steep edges capped
        }
      }
      return sum;
    };
    if (detail(bot) > 1.15 * detail(top)) widest.up = '-' + widest.up;
  }
  last = null; // these were coarse; the real build reads it again at full detail
  return { up: flatBack ? flatBack.up : widest.up, flats };
}

// The model itself, turned like the height map and standing exactly where its object would (for showing a model
// that isn't flat on the back as it is, rather than filled in down to its lowest point)
export function originalMesh(geom, p) {
  const { pts, n } = orient(geom, p), { W, H, res, minz, minx, maxy } = raster(geom, p);
  const dx = -minx - (W - 1) * res / 2, dy = -maxy + (H - 1) * res / 2, N = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { pts[v * 3] += dx; pts[v * 3 + 1] += dy; pts[v * 3 + 2] -= minz; }
  for (let t = 0; t < n * 3; t += 9) {
    const ux = pts[t + 3] - pts[t], uy = pts[t + 4] - pts[t + 1], uz = pts[t + 5] - pts[t + 2];
    const vx = pts[t + 6] - pts[t], vy = pts[t + 7] - pts[t + 1], vz = pts[t + 8] - pts[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let o = 0; o < 9; o += 3) { N[t + o] = nx; N[t + o + 1] = ny; N[t + o + 2] = nz; }
  }
  return { P: pts, N };
}

export function hfFromSTL(geom, p) {
  const { W, H, res, top, minz } = raster(geom, p);
  const mask = new Uint8Array(W * H), relief = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) if (top[k] > -Infinity) { mask[k] = 1; relief[k] = top[k] - minz; }
  return { W, H, res, mask, relief, kind: 'stl' };
}

// Where to cut by default, in % of the height from the bottom. First, each half should stay in as few pieces as
// possible (one each): a cut just above a toe leaves the toe as a loose crumb. Among those heights, the one where
// the cut face is largest, so each half has as few overhangs as possible; among nearly equal ones, the one nearest
// the middle. Pieces are counted on the outline seen from above (a quick check; tiny bits under 1 mm² don't count).
export function bestCut(geom, p) {
  const { W, H, res, top, bot, minz, maxz } = raster(geom, p), N = W * H, span = Math.max(1e-6, maxz - minz);
  const minCells = Math.max(4, 1 / (res * res)), seen = new Int32Array(N), stack = new Int32Array(N);
  let mark = 0;
  const pieces = (inside) => {
    mark++;
    let n = 0;
    for (let s = 0; s < N; s++) {
      if (seen[s] === mark || !inside(s)) continue;
      let size = 0, sp = 0;
      stack[sp++] = s; seen[s] = mark;
      while (sp) {
        const k = stack[--sp], i = k % W;
        size++;
        for (const q of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, k - W, k + W]) {
          if (q >= 0 && q < N && seen[q] !== mark && inside(q)) { seen[q] = mark; stack[sp++] = q; }
        }
      }
      if (size >= minCells) n++;
    }
    return n;
  };
  const tries = [];
  for (let pct = 5; pct <= 95; pct++) {
    const z = minz + span * pct / 100;
    let area = 0;
    for (let k = 0; k < N; k++) if (bot[k] < z && top[k] > z) area++;
    tries.push({ pct, area, n: pieces((k) => top[k] > z) + pieces((k) => bot[k] < z) });
  }
  const fewest = Math.min(...tries.map((c) => c.n)), ok = tries.filter((c) => c.n === fewest);
  const widest = Math.max(...ok.map((c) => c.area));
  return ok.filter((c) => c.area >= widest * 0.97).reduce((a, c) => (Math.abs(c.pct - 50) < Math.abs(a.pct - 50) ? c : a)).pct;
}

// The two halves above and below the cut, each as a height map standing on its cut face. The lower half is
// turned over (mirrored left to right), so both are seen from outside. Their outlines shape the templates and lids
// (the halves themselves are cut exactly in exact.js). Pins: where the alignment holes go. core (hollow casts): the
// lid's core over the cut face (hollowCore).
export function halvesFromSTL(geom, p) {
  const { W, H, res, top, bot, minz, maxz, minx, maxy, pts, n } = raster(geom, p);
  const z0 = minz + (maxz - minz) * p.splitAt / 100, N = W * H;
  const upper = { W, H, res, mask: new Uint8Array(N), relief: new Float32Array(N), kind: 'stl' };
  const lower = { W, H, res, mask: new Uint8Array(N), relief: new Float32Array(N), kind: 'stl' };
  const cut = new Uint8Array(N); // cells where the cut goes through the model: both halves have material there
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i, m = j * W + (W - 1 - i);
      if (top[k] === -Infinity) continue;
      if (top[k] > z0) { upper.mask[k] = 1; upper.relief[k] = top[k] - z0; }
      if (bot[k] < z0) { lower.mask[m] = 1; lower.relief[m] = z0 - bot[k]; }
      if (top[k] > z0 && bot[k] < z0) cut[k] = 1;
    }
  }
  upper.pins = []; lower.pins = [];
  if (p.pins || p.hollow) {
    const { above, below } = solidAround(pts, n, W, H, res, minx, maxy, z0);
    const thick = new Float32Array(N);
    for (let k = 0; k < N; k++) if (cut[k]) thick[k] = Math.min(above[k] - z0, z0 - below[k]);
    // where the pins can't go in a hollow cast: the core of either half (the lower one is mirrored)
    let cores = null;
    if (p.hollow) {
      const first = [new Float32Array(N), new Float32Array(N)];
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const k = j * W + i;
          first[0][k] = above[k] - z0; first[1][j * W + (W - 1 - i)] = z0 - below[k]; // (0 where the cut isn't)
        }
      }
      upper.core = hollowCore(first[0], W, H, res, p.hollow);
      lower.core = hollowCore(first[1], W, H, res, p.hollow);
      cores = new Uint8Array(N);
      for (let k = 0; k < N; k++) cores[k] = upper.core[k] > CORE_MIN || lower.core[k - k % W + W - 1 - k % W] > CORE_MIN ? 1 : 0;
    }
    if (p.pins) for (const pin of placePins(cut, thick, cores, W, H, res, p)) {
      upper.pins.push(pin);
      lower.pins.push({ ...pin, i: W - 1 - pin.i });
    }
  }
  return [upper, lower];
}

// How far a hollow cast's core reaches into the half above each cell of the cut face (mm, below 0 where there is
// none). The core keeps the shell thickness away from the half's surface everywhere: the space straight in from the
// cut face, up to the first surface (f), shrunk by a ball of that radius. Built straight up from the cut face,
// it pulls out of the set cast even where the half curves back in (there the shell is thicker).
function hollowCore(f, W, H, res, w) {
  const N = W * H;
  // the ball is sampled cell by cell up to 24 cells across its radius, beyond that every s cells (f's lowest point
  // within reach of a sample is taken first, so nothing is missed)
  const R = w / res, s = Math.max(1, Math.round(R / 24)), h = s >> 1;
  let low = f;
  if (s > 1) {
    for (const step of [1, W]) {
      const out = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        const i = k % W, j = (k / W) | 0;
        let m = low[k];
        for (let o = -h; o <= h; o++) {
          if (step === 1 ? i + o < 0 || i + o >= W : j + o < 0 || j + o >= H) { m = 0; continue; }
          m = Math.min(m, low[k + o * step]);
        }
        out[k] = m;
      }
      low = out;
    }
  }
  const offs = [], n = Math.ceil(R / s) * s;
  for (let dj = -n; dj <= n; dj += s) {
    for (let di = -n; di <= n; di += s) {
      const d = Math.max(0, Math.hypot(di, dj) - h * Math.SQRT2) * res; // the nearest point of each sample's square
      if (d <= w) offs.push([di, dj, Math.sqrt(w * w - d * d)]);
    }
  }
  // worked out below 0 too, wherever the cut face is, so the core's outline runs smoothly between cells
  const c = new Float32Array(N).fill(-w);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (f[k] <= 0) continue;
      let m = Infinity;
      for (const [di, dj, z] of offs) {
        const x = i + di, y = j + dj;
        const v = (x < 0 || y < 0 || x >= W || y >= H ? 0 : low[y * W + x]) - z;
        if (v < m) m = v;
      }
      c[k] = Math.max(m, -w);
    }
  }
  return c;
}

// the lowest a hollow cast's core is (mm): where it would be lower, there is none
export const CORE_MIN = 0.4;

// How much material there is straight above and below the cut: up to where the model is first left, not its
// outermost surface, so a half that curves back in or is hollow isn't drilled through. A model made of overlapping
// parts (a head pushed into a body) has surfaces buried inside it: going up a cell's line, the parts entered so far are
// counted, and only where the count drops to none is the model left.
function solidAround(pts, n, W, H, res, minx, maxy, z0) {
  const N = W * H, ks = [], zs = [], ss = [];
  sample(pts, n, W, H, res, minx, maxy, (k, z, side) => { ks.push(k); zs.push(z); ss.push(side); });
  // the crossings grouped by cell, each cell's from the bottom up
  const start = new Int32Array(N + 1);
  for (const k of ks) start[k + 1]++;
  for (let k = 0; k < N; k++) start[k + 1] += start[k];
  const at = start.slice(0, N), order = new Int32Array(ks.length);
  ks.forEach((k, c) => { order[at[k]++] = c; });
  const above = new Float32Array(N).fill(z0), below = new Float32Array(N).fill(z0), broken = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const list = Array.from(order.subarray(start[k], start[k + 1])).sort((a, b) => zs[a] - zs[b]);
    if (!list.length) continue;
    // crossings at one height count once, by which way they go on balance: a line through the edge between two
    // triangles meets that surface twice, and one just touching the model (a corner, an outline) goes in and out
    const enter = ss[list[0]], hz = [], hs = []; // the lowest crossing goes in
    for (let a = 0; a < list.length;) {
      const z = zs[list[a]];
      let sum = 0;
      for (; a < list.length && zs[list[a]] - z < 1e-5; a++) sum += ss[list[a]] === enter ? 1 : -1;
      if (sum) { hz.push(z); hs.push(Math.sign(sum)); }
    }
    // a line through a crack in the mesh misses a surface, so it doesn't come out as often as it went in: it is
    // filled in from its neighbours below
    if (hs.reduce((a, b) => a + b, 0) !== 0) { broken[k] = 1; continue; }
    let inside = 0, from = -Infinity;
    for (let a = 0; a < hz.length; a++) {
      const z = hz[a], was = inside;
      inside += hs[a];
      if (was <= 0 && inside > 0) from = z;
      else if (was > 0 && inside <= 0) {
        if (from <= z0 && z > z0) { below[k] = from; above[k] = z; break; }
        if (from > z0) break;
      }
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    const fix = [];
    for (let k = 0; k < N; k++) {
      if (!broken[k]) continue;
      let a = 0, b = 0, n = 0;
      for (const q of neighbours(k, W, H)) if (q >= 0 && !broken[q]) { a += above[q]; b += below[q]; n++; }
      if (n) fix.push(k, a / n, b / n);
    }
    for (let i = 0; i < fix.length; i += 3) { above[fix[i]] = fix[i + 1]; below[fix[i]] = fix[i + 2]; broken[fix[i]] = 0; }
  }
  return { above, below };
}

// p.pins pins spread evenly over the cut face: each sits in the middle of its own equal share of the face (k-means
// over the spots where a pin fits), so none is pushed out to an edge. Each hole is as deep as 1.5 pin widths, but
// leaves at least 1 mm of material behind it in both halves (thick: material above and below the cut, the thinner).
// A pin closer than 2.5 widths to another is dropped. In a hollow cast a pin only fits in the shell around the cut's
// edge, between the outline and the cores: there 0.6 mm of material on either side of its hole is enough.
function placePins(cut, thick, cores, W, H, res, p) {
  const N = W * H, outside = new Uint8Array(N);
  for (let k = 0; k < N; k++) outside[k] = cut[k] ? 0 : 1;
  const edge = distTo(outside, W, H), r = p.pinD / 2, R = Math.ceil(r / res);
  const fromCore = cores && distTo(cores, W, H), margin = cores ? 0.6 : 1.5;
  // thinnest point of either half within the hole's reach (a square around it: slightly cautious)
  let thin = Float32Array.from(thick);
  for (const step of [1, W]) {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let m = thin[k];
      for (let o = -R; o <= R; o++) { const q = k + o * step; if (q >= 0 && q < N) m = Math.min(m, thin[q]); }
      out[k] = m;
    }
    thin = out;
  }
  const depthAt = (k) => Math.min(1.5 * p.pinD, thin[k] - 1);
  const ok = (k) => edge[k] >= (r + margin) / res && depthAt(k) >= Math.max(1.5, r) && (!cores || fromCore[k] >= (r + margin) / res);
  const fits = [];
  for (let k = 0; k < N; k++) if (cut[k] && ok(k)) fits.push(k);
  if (!fits.length) return [];
  const step = Math.ceil(fits.length / 20000), cells = fits.filter((_, i) => i % step === 0); // enough to average over
  const xy = (k) => [k % W, (k / W) | 0], d2 = (k, [x, y]) => (k % W - x) ** 2 + (((k / W) | 0) - y) ** 2;
  // start spread out (deepest spot first, then each as far as possible from the others), then even out the shares
  let seeds = [xy(cells.reduce((b, k) => (edge[k] > edge[b] ? k : b), cells[0]))];
  while (seeds.length < Math.min(p.pins, cells.length)) {
    let best = cells[0], far = -1;
    for (const k of cells) { const f = Math.min(...seeds.map((c) => d2(k, c))); if (f > far) { far = f; best = k; } }
    seeds.push(xy(best));
  }
  const nearest = (k) => { let b = 0; for (let s = 1; s < seeds.length; s++) if (d2(k, seeds[s]) < d2(k, seeds[b])) b = s; return b; };
  for (let it = 0; it < 20; it++) {
    const sum = seeds.map(() => [0, 0, 0]);
    for (const k of cells) { const s = sum[nearest(k)]; s[0] += k % W; s[1] += (k / W) | 0; s[2]++; }
    const mean = sum.map(([x, y, n], s) => (n ? [x / n, y / n] : seeds[s]));
    // each pin goes to the spot of its share nearest that share's middle (the middle itself may not fit a pin)
    const pick = seeds.map(() => [-1, Infinity]);
    for (const k of cells) { const s = nearest(k), d = d2(k, mean[s]); if (d < pick[s][1]) pick[s] = [k, d]; }
    seeds = pick.map(([k], s) => (k < 0 ? seeds[s] : xy(k)));
  }
  const pins = [];
  for (const [i, j] of seeds) {
    if (pins.some((q) => Math.hypot(q.i - i, q.j - j) < 2.5 * p.pinD / res)) continue;
    pins.push({ i, j, r, d: depthAt(j * W + i) });
  }
  return pins;
}

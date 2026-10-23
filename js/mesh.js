// Turning a region of the grid into a closed, printable mesh.
import earcut from 'earcut';

// A solid = region where sdf > 0, between a bottom and a top height (number or per-cell array).
// Marching squares on the outline, so edges are smooth and the shell is closed.
export class Buf {
  constructor(n = 1 << 16) { this.a = new Float32Array(n); this.n = 0; }
  push(x, y, z) {
    if (this.n + 3 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
  out() { return this.a.slice(0, this.n); }
}
export function normalsOf(G, z) {
  const { W, H, res } = G, n = new Float32Array(W * H * 3);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const il = i > 0 ? k - 1 : k, ir = i < W - 1 ? k + 1 : k;
      const ju = j > 0 ? k - W : k, jd = j < H - 1 ? k + W : k;
      const dx = (z[ir] - z[il]) / ((ir - il) * res);
      const dy = -(z[jd] - z[ju]) / (((jd - ju) / W) * res);
      const l = Math.hypot(dx, dy, 1);
      n[k * 3] = -dx / l; n[k * 3 + 1] = -dy / l; n[k * 3 + 2] = 1 / l;
    }
  }
  return n;
}
export function meshSolid(G, sdf, bot, top) {
  if (typeof top === 'number' && typeof bot === 'number') return meshFlat(G, sdf, bot, top);
  const { W, H, res, ox, oy } = G;
  const P = new Buf(1 << 18), Nm = new Buf(1 << 18);
  const tA = typeof top !== 'number', bA = typeof bot !== 'number';
  const tN = tA ? normalsOf(G, top) : null, bN = bA ? normalsOf(G, bot) : null;
  const zAt = (a, isArr, ka, kb, t) => isArr ? a[ka] + (a[kb] - a[ka]) * t : a;
  const nAt = (nArr, ka, kb, t, sign) => {
    if (!nArr) return [0, 0, sign];
    let x = nArr[ka * 3] + (nArr[kb * 3] - nArr[ka * 3]) * t;
    let y = nArr[ka * 3 + 1] + (nArr[kb * 3 + 1] - nArr[ka * 3 + 1]) * t;
    let z = nArr[ka * 3 + 2] + (nArr[kb * 3 + 2] - nArr[ka * 3 + 2]) * t;
    const l = Math.hypot(x, y, z) || 1;
    return [sign * x / l, sign * y / l, sign * z / l];
  };
  const mk = (ka, kb, t, cross) => {
    const xa = ox + (ka % W) * res, ya = oy - ((ka / W) | 0) * res;
    const xb = ox + (kb % W) * res, yb = oy - ((kb / W) | 0) * res;
    return {
      x: xa + (xb - xa) * t, y: ya + (yb - ya) * t, cross,
      zt: zAt(top, tA, ka, kb, t), zb: zAt(bot, bA, ka, kb, t),
      nt: nAt(tN, ka, kb, t, 1), nb: nAt(bN, ka, kb, t, -1),
    };
  };
  const C = (k) => mk(k, k, 0, false);
  const X = (ka, kb) => { // canonical order so neighbouring cells get bit-identical points
    if (ka > kb) { const s = ka; ka = kb; kb = s; }
    return mk(ka, kb, sdf[ka] / (sdf[ka] - sdf[kb]), true);
  };
  const vTop = (v) => { P.push(v.x, v.y, v.zt); Nm.push(v.nt[0], v.nt[1], v.nt[2]); };
  const vBot = (v) => { P.push(v.x, v.y, v.zb); Nm.push(v.nb[0], v.nb[1], v.nb[2]); };
  const emit = (poly) => {
    const n = poly.length;
    for (let i = 1; i < n - 1; i++) {
      vTop(poly[0]); vTop(poly[i]); vTop(poly[i + 1]);
      vBot(poly[0]); vBot(poly[i + 1]); vBot(poly[i]);
    }
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      if (!p.cross || !q.cross) continue;
      let nx = q.y - p.y, ny = -(q.x - p.x);
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const quad = [[p.x, p.y, p.zb], [q.x, q.y, q.zb], [q.x, q.y, q.zt], [p.x, p.y, p.zb], [q.x, q.y, q.zt], [p.x, p.y, p.zt]];
      for (const v of quad) { P.push(v[0], v[1], v[2]); Nm.push(nx, ny, 0); }
    }
  };
  const ks = [0, 0, 0, 0], ins = [0, 0, 0, 0];
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const k = j * W + i;
      // corners counter-clockwise in world space: BL, BR, TR, TL
      ks[0] = k + W; ks[1] = k + W + 1; ks[2] = k + 1; ks[3] = k;
      let cnt = 0;
      for (let c = 0; c < 4; c++) { ins[c] = sdf[ks[c]] > 0 ? 1 : 0; cnt += ins[c]; }
      if (!cnt) continue;
      if (cnt === 2 && ins[0] === ins[2] &&
          (sdf[ks[0]] + sdf[ks[1]] + sdf[ks[2]] + sdf[ks[3]]) <= 0) {
        for (let c = 0; c < 4; c++) if (ins[c]) emit([X(ks[(c + 3) % 4], ks[c]), C(ks[c]), X(ks[c], ks[(c + 1) % 4])]);
        continue;
      }
      const poly = [];
      for (let c = 0; c < 4; c++) {
        const nc = (c + 1) % 4;
        if (ins[c]) poly.push(C(ks[c]));
        if (ins[c] !== ins[nc]) poly.push(X(ks[c], ks[nc]));
      }
      emit(poly);
    }
  }
  return { P: P.out(), N: Nm.out() };
}

// A closed upright cylinder (pins and pegs), round rather than stepped on the grid.
export function cylinder(cx, cy, r, z0, z1, seg = 48) {
  const P = new Buf(seg * 36), Nm = new Buf(seg * 36);
  const tri = (a, b, c, n) => { for (const v of [a, b, c]) { P.push(v[0], v[1], v[2]); Nm.push(n[0], n[1], n[2]); } };
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * 2 * Math.PI, a1 = ((s + 1) / seg) * 2 * Math.PI;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p0 = [cx + r * c0, cy + r * s0], p1 = [cx + r * c1, cy + r * s1];
    const n = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
    tri([p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], n);
    tri([p0[0], p0[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], n);
    tri([cx, cy, z1], [p0[0], p0[1], z1], [p1[0], p1[1], z1], [0, 0, 1]);
    tri([cx, cy, z0], [p1[0], p1[1], z0], [p0[0], p0[1], z0], [0, 0, -1]);
  }
  return { P: P.out(), N: Nm.out() };
}
// several meshes as one, each moved by (dx, dy, dz)
export function joinMeshes(parts) {
  let n = 0;
  for (const [m] of parts) n += m.P.length;
  const P = new Float32Array(n), N = new Float32Array(n);
  let o = 0;
  for (const [m, dx = 0, dy = 0, dz = 0] of parts) {
    for (let i = 0; i < m.P.length; i += 3) { P[o + i] = m.P[i] + dx; P[o + i + 1] = m.P[i + 1] + dy; P[o + i + 2] = m.P[i + 2] + dz; }
    N.set(m.N, o); o += m.P.length;
  }
  return { P, N };
}

// The outline of the region where sdf > 0, as closed loops of [x, y] points (marching squares, the same edge
// crossings meshSolid uses), outer loops counter-clockwise and holes clockwise.
export function outlineLoops(G, sdf) {
  const { W, H, res, ox, oy } = G, next = new Map(), at = new Map();
  const X = (ka, kb) => {
    if (ka > kb) { const s = ka; ka = kb; kb = s; }
    const key = ka * 2 + (kb - ka === 1 ? 0 : 1);
    if (!at.has(key)) {
      const t = sdf[ka] / (sdf[ka] - sdf[kb]);
      const xa = ox + (ka % W) * res, ya = oy - ((ka / W) | 0) * res, xb = ox + (kb % W) * res, yb = oy - ((kb / W) | 0) * res;
      at.set(key, [xa + (xb - xa) * t, ya + (yb - ya) * t]);
    }
    return key;
  };
  const ks = [0, 0, 0, 0], ins = [0, 0, 0, 0];
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const k = j * W + i;
      ks[0] = k + W; ks[1] = k + W + 1; ks[2] = k + 1; ks[3] = k; // BL, BR, TR, TL: counter-clockwise
      let cnt = 0;
      for (let c = 0; c < 4; c++) { ins[c] = sdf[ks[c]] > 0 ? 1 : 0; cnt += ins[c]; }
      if (cnt === 0 || cnt === 4) continue;
      // walking the cell counter-clockwise, the outline leaves the region at an in→out edge and comes back in
      // at the next out→in edge; with two such pairs (a saddle) they are paired the way meshSolid splits it
      const ups = [], downs = [];
      for (let c = 0; c < 4; c++) {
        const nc = (c + 1) % 4;
        if (ins[c] && !ins[nc]) downs.push([c, X(ks[c], ks[nc])]);
        if (!ins[c] && ins[nc]) ups.push([c, X(ks[c], ks[nc])]);
      }
      const split = cnt === 2 && ins[0] === ins[2] && (sdf[ks[0]] + sdf[ks[1]] + sdf[ks[2]] + sdf[ks[3]]) <= 0;
      for (const [c, from] of downs) {
        // the matching entry: the next out→in edge going round, or (split saddle) the one just before this corner
        let best = null;
        for (let s = 1; s <= 4 && !best; s++) {
          const e = ups.find(([u]) => u === (split ? (c + 4 - s) % 4 : (c + s) % 4));
          if (e) best = e;
        }
        next.set(from, best[1]);
      }
    }
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let e = start; e !== undefined && !seen.has(e); e = next.get(e)) { seen.add(e); loop.push(at.get(e)); }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

// An outline without the points that lie on a straight line between their neighbours (or on top of one): the top,
// the bottom and the sides then share exactly the same corners, so they meet without gaps.
function straighten(loop) {
  let pts = loop, changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = out.length ? out[out.length - 1] : pts[(i + pts.length - 1) % pts.length];
      const [bx, by] = pts[i], [cx, cy] = pts[(i + 1) % pts.length];
      if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < 1e-9) { changed = true; continue; }
      out.push(pts[i]);
    }
    pts = out;
  }
  return pts;
}
// A flat-topped solid (template base and walls, lids, the silicone rim): the same outline as meshSolid, but the
// top and bottom are each filled with a few large triangles instead of two per grid cell, so the file is much
// smaller with exactly the same shape.
function meshFlat(G, sdf, bot, top) {
  const loops = outlineLoops(G, sdf).map(straighten).filter((l) => l.length > 2), P = new Buf(1 << 16), Nm = new Buf(1 << 16);
  const push = (x, y, z, n) => { P.push(x, y, z); Nm.push(n[0], n[1], n[2]); };
  const area = (l) => { let a = 0; for (let i = 0; i < l.length; i++) { const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length]; a += x0 * y1 - x1 * y0; } return a / 2; };
  const inside = ([x, y], l) => { // point in polygon (even-odd)
    let c = false;
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const [xi, yi] = l[i], [xj, yj] = l[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // outlines run anticlockwise, holes clockwise: each hole goes with the smallest outline around it
  const outers = loops.filter((l) => area(l) > 0).map((l) => ({ l, a: area(l), holes: [] }));
  for (const h of loops.filter((l) => area(l) < 0)) {
    const around = outers.filter((o) => inside(h[0], o.l)).sort((a, b) => a.a - b.a)[0];
    if (around) around.holes.push(h);
  }
  for (const { l, holes } of outers) {
    const flat = [], holeIdx = [];
    for (const ring of [l, ...holes]) {
      if (ring !== l) holeIdx.push(flat.length / 2);
      for (const [x, y] of ring) flat.push(x, y);
    }
    const tri = earcut(flat, holeIdx);
    for (let i = 0; i < tri.length; i += 3) {
      let [a, b, c] = [tri[i], tri[i + 1], tri[i + 2]];
      const ax = flat[a * 2], ay = flat[a * 2 + 1], bx = flat[b * 2], by = flat[b * 2 + 1], cx = flat[c * 2], cy = flat[c * 2 + 1];
      if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) [b, c] = [c, b]; // anticlockwise seen from above
      push(flat[a * 2], flat[a * 2 + 1], top, [0, 0, 1]); push(flat[b * 2], flat[b * 2 + 1], top, [0, 0, 1]); push(flat[c * 2], flat[c * 2 + 1], top, [0, 0, 1]);
      push(flat[a * 2], flat[a * 2 + 1], bot, [0, 0, -1]); push(flat[c * 2], flat[c * 2 + 1], bot, [0, 0, -1]); push(flat[b * 2], flat[b * 2 + 1], bot, [0, 0, -1]);
    }
  }
  // the sides: one upright quad per outline segment, facing out (the shape is on the left of each segment)
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const [px, py] = l[i], [qx, qy] = l[(i + 1) % l.length];
      let nx = qy - py, ny = -(qx - px);
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) continue;
      const n = [nx / len, ny / len, 0];
      push(px, py, bot, n); push(qx, qy, bot, n); push(qx, qy, top, n);
      push(px, py, bot, n); push(qx, qy, top, n); push(px, py, top, n);
    }
  }
  return { P: P.out(), N: Nm.out() };
}

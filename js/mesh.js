// Turning a region of the grid into a closed, printable mesh.

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

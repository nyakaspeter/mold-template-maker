// Building the object, the printed template and the silicone mold from a height map.
import { t } from './i18n.js';
import { blur, signedDist, fillHoles, smoothstep, neighbours, distTo } from './grid.js';
import { CORE_MIN } from './stl.js';
import { meshSolid, cylinder, joinMeshes } from './mesh.js';

export function spreadColours(colors, mask, W, H) {
  const has = Uint8Array.from(mask);
  for (let pass = 0; pass < 6; pass++) {
    const add = [];
    for (let k = 0; k < W * H; k++) {
      if (has[k]) continue;
      for (const q of neighbours(k, W, H)) if (q >= 0 && has[q]) { add.push(k, q); break; }
    }
    for (let i = 0; i < add.length; i += 2) { colors.set(colors.subarray(add[i + 1] * 3, add[i + 1] * 3 + 3), add[i] * 3); has[add[i]] = 1; }
  }
  return colors;
}
export function buildModel(hf, p) {
  const res = hf.res, B = p.baseT, T = p.backT;
  const border = p.border, gap = p.gap, wallT = p.wallT, over = p.over;
  const pad = Math.ceil((border + gap + wallT + 1.5) / res) + 3;
  const W = hf.W + 2 * pad, H = hf.H + 2 * pad, N = W * H;
  const mask = new Uint8Array(N);
  let relief = new Float32Array(N), lines = new Float32Array(N);
  const colors = hf.px ? new Uint8Array(N * 3) : null; // image colours, for the optional painted preview
  for (let j = 0; j < hf.H; j++) {
    for (let i = 0; i < hf.W; i++) {
      const k = (j + pad) * W + i + pad;
      mask[k] = hf.mask[j * hf.W + i]; relief[k] = hf.relief[j * hf.W + i];
      if (hf.lines) lines[k] = hf.lines[j * hf.W + i];
      if (hf.px) for (let c = 0; c < 3; c++) colors[k * 3 + c] = hf.px[(j * hf.W + i) * 4 + c];
    }
  }
  let any = false;
  for (let k = 0; k < N; k++) if (mask[k]) { any = true; break; }
  if (!any) throw new Error(t('noShape'));

  // an STL's edge is a wall, not a slope down to zero: carry the edge height outward so the
  // outline's top edge doesn't zigzag between the wall height and zero
  if (hf.kind === 'stl') {
    const has = Uint8Array.from(mask);
    for (let pass = 0; pass < 4; pass++) {
      const add = [];
      for (let k = 0; k < N; k++) {
        if (has[k]) continue;
        let sum = 0, n = 0;
        for (const q of neighbours(k, W, H)) if (q >= 0 && has[q]) { sum += relief[q]; n++; }
        if (n) add.push(k, sum / n);
      }
      for (let i = 0; i < add.length; i += 2) { relief[add[i]] = add[i + 1]; has[add[i]] = 1; }
    }
  }
  let sdf = signedDist(mask, W, H);
  for (let k = 0; k < N; k++) sdf[k] *= res;
  if (p.maskSmooth > 0) sdf = blur(sdf, W, H, p.maskSmooth / res);

  if (p.reliefSmooth > 0) { // blur only inside the shape so the background doesn't bleed in
    const m = new Float32Array(N);
    for (let k = 0; k < N; k++) m[k] = mask[k];
    const bm = blur(m, W, H, p.reliefSmooth / res), br = blur(relief, W, H, p.reliefSmooth / res);
    for (let k = 0; k < N; k++) relief[k] = mask[k] && bm[k] > 1e-3 ? br[k] / bm[k] : 0;
  }
  if (hf.kind === 'image' && !hf.cartoon && p.edgeSoft > 0) {
    for (let k = 0; k < N; k++) relief[k] *= smoothstep(0, p.edgeSoft, sdf[k]);
  }
  if (hf.kind === 'image' && !hf.cartoon && p.puff > 0) { // quarter-circle profile rising from the outline
    const R = Math.max(2, p.puff * 2.5);
    for (let k = 0; k < N; k++) {
      if (sdf[k] <= 0) continue;
      const u = 1 - Math.min(1, sdf[k] / R);
      relief[k] += p.puff * Math.sqrt(1 - u * u);
    }
  }
  if (hf.kind === 'image' && p.lineDepth > 0) {
    const bl = blur(lines, W, H, Math.max(0.6, 0.15 / res));
    for (let k = 0; k < N; k++) if (mask[k]) relief[k] -= p.lineDepth * bl[k];
  }

  const sdfPlaque = new Float32Array(N), sdfCav = new Float32Array(N), sdfOut = new Float32Array(N);
  const ring = new Float32Array(N), gapRing = new Float32Array(N);
  const objTop = new Float32Array(N), posTop = new Float32Array(N);
  let maxTop = 0;
  for (let k = 0; k < N; k++) {
    sdfPlaque[k] = sdf[k] + border + 1e-4;
    sdfCav[k] = sdfPlaque[k] + gap;
  }
  // Openings in the object wider than the gap (between legs, beside a face) would otherwise get walls of their
  // own. The wall only follows the outside; enclosed openings are filled with silicone, which keeps them open in the cast.
  const cav = new Uint8Array(N);
  for (let k = 0; k < N; k++) cav[k] = sdfCav[k] > 0 ? 1 : 0;
  const filled = Uint8Array.from(cav);
  fillHoles(filled, W, H);
  for (let k = 0; k < N; k++) if (filled[k] && !cav[k]) sdfCav[k] = Math.max(-sdfCav[k], 0.05);
  for (let k = 0; k < N; k++) {
    sdfOut[k] = sdfCav[k] + wallT;
    ring[k] = Math.min(sdfOut[k], -sdfCav[k]);
    gapRing[k] = Math.min(sdfCav[k], -sdfPlaque[k]);
    objTop[k] = Math.max(T + relief[k], 0.3);
    posTop[k] = objTop[k] + B;
    if (sdfPlaque[k] > 0 && objTop[k] > maxTop) maxTop = objTop[k];
  }
  const Ztop = B + maxTop + over;
  const G = { W, H, res, ox: -(W - 1) * res / 2, oy: (H - 1) * res / 2 };

  // Alignment pins (halves only): a hole in the back of the cast for each (cut by exact.js), formed by a peg on a
  // printed lid that is laid on the filled mold. The lid also has two small holes for excess resin to escape.
  // Hollow casts (halves only): the lid also carries a core that reaches into the mold, so the resin sets as a shell.
  const pins = (hf.pins || []).map((q) => ({ ...q, x: G.ox + (q.i + pad) * res, y: G.oy - (q.j + pad) * res }));
  let core = null; // (see stl.js hollowCore)
  if (hf.core) {
    core = new Float32Array(N).fill(-p.hollow);
    for (let j = 0; j < hf.H; j++) for (let i = 0; i < hf.W; i++) core[(j + pad) * W + i + pad] = hf.core[j * hf.W + i];
  }
  let lid = null;
  if (pins.length || core) {
    // with a core, the vents go over the shell, between the outline and the core's (smaller in a thin shell; where
    // none fits anywhere, there are none)
    const ventR = core ? Math.max(0.4, Math.min(1, (p.hollow - 0.6) / 2)) : 1, vents = [], taken = pins.map((q) => [q.x, q.y]);
    const fromCore = core && distTo(core.map((c) => (c > CORE_MIN ? 1 : 0)), W, H);
    for (let n = 0; n < 2; n++) {
      let best = null, score = 3 + ventR;
      for (let k = 0; k < N; k++) {
        if (sdfPlaque[k] < ventR + (core ? 0.3 : 1) || (core && fromCore[k] * res < ventR + 0.3)) continue;
        const x = G.ox + (k % W) * res, y = G.oy - ((k / W) | 0) * res;
        const s = Math.min(...taken.map(([a, b]) => Math.hypot(x - a, y - b)));
        if (s > score) { score = s; best = [x, y]; }
      }
      if (!best) break;
      vents.push(best); taken.push(best);
    }
    // Printed face down, with pegs and the lip facing up. Once flipped for use, the
    // lip sits outside the silicone perimeter; the flat surface still seats at height B.
    const clearance = 0.4, lipWall = 1.2, lipDepth = 3, taper = 0.4;
    const sdfLid = new Float32Array(N), lidTop = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const x = G.ox + (k % W) * res, y = G.oy - ((k / W) | 0) * res;
      let s = sdfCav[k] + clearance + lipWall;
      lidTop[k] = B + lipDepth * Math.min(1, Math.max(0, (-sdfCav[k] - clearance) / taper));
      for (const [a, b] of vents) s = Math.min(s, Math.hypot(x - a, y - b) - ventR);
      sdfLid[k] = s;
    }
    // printed pegs up; it is turned over onto the mold the same way the mold was turned over
    lid = {
      plate: meshSolid(G, sdfLid, 0, lidTop),
      pegs: joinMeshes(pins.map((q) => [cylinder(q.x, q.y, q.r, B - 0.05, B + q.d)])),
    };
    if (core) {
      const top = new Float32Array(N);
      // the same field for both, so its outline (CORE_MIN) has the same height all round
      for (let k = 0; k < N; k++) { top[k] = B + core[k]; core[k] -= CORE_MIN; }
      lid.core = meshSolid(G, core, B - 0.05, top);
      if (!lid.core.P.length) lid.core = null;
    }
    if (!pins.length && !lid.core) lid = null; // too thin to hollow out: no lid needed
  }

  const geo = {
    object: meshSolid(G, sdfPlaque, 0, objTop),
    base: meshSolid(G, sdfOut, 0, B),
    wall: meshSolid(G, ring, B - 0.05, Ztop),
    positive: meshSolid(G, sdfPlaque, B - 0.05, posTop),
    silOver: meshSolid(G, sdfPlaque, posTop, Ztop),
    silGap: meshSolid(G, gapRing, B, Ztop),
  };

  // numbers
  let cast = 0, sil = 0;
  const bb = (s) => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, s });
  const bo = bb(sdfPlaque), bt = bb(sdfOut), bc = bb(sdfCav);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (sdfPlaque[k] > 0) { cast += objTop[k]; sil += Ztop - posTop[k]; }
      else if (sdfCav[k] > 0) sil += Ztop - B;
      for (const b of [bo, bt, bc]) if (b.s[k] > 0) {
        if (i < b.x0) b.x0 = i; if (i > b.x1) b.x1 = i; if (j < b.y0) b.y0 = j; if (j > b.y1) b.y1 = j;
      }
    }
  }
  const a = res * res / 1000;
  const dims = (b) => [(b.x1 - b.x0 + 1) * res, (b.y1 - b.y0 + 1) * res];
  return {
    G, geo, lid, pins, B, Ztop, maxTop, res, p, colors: colors && spreadColours(colors, mask, W, H),
    sdfCav, // the template's inside outline, for exact STL halves
    stats: { castMl: cast * a, silMl: sil * a, obj: dims(bo), tpl: dims(bt), sil: dims(bc), objH: maxTop, tplH: Ztop },
  };
}

// Two halves of an STL (a model for each) laid out side by side, so each stage downloads as one file.
// With pins, the templates' stage also has a row of pins in front of the templates and the lids in front of those;
// the cast halves and the silicone stay centred.
export function buildHalves([A, Bm], p) {
  const w = (A.G.W - 1) * A.res, h = (A.G.H - 1) * A.res, dx = w / 2 + 1;
  const withLids = !!(A.lid || Bm.lid);
  const pinParts = A.pins.map((q) => ({ r: q.r - 0.15, len: 2 * q.d - 0.6 })); // one pin per pair of holes, a little loose
  const pinRow = pinParts.length ? Math.max(...pinParts.map((q) => q.r)) * 2 + 4 : 0;
  const rows = withLids ? 2 * h + 2 + pinRow : h;
  const y0 = rows / 2 - h / 2, yPin = y0 - h / 2 - 1 - pinRow / 2, yLid = yPin - pinRow / 2 - 1 - h / 2;
  const both = (key, y = y0) => joinMeshes([[A.geo[key], -dx, y], [Bm.geo[key], dx, y]]);
  // the silicone is turned over around x = 0 for display and download: place it mirrored, and level the
  // two halves' tops so both land on the ground
  const Ztop = Math.max(A.Ztop, Bm.Ztop);
  const sil = (key) => joinMeshes([[A.geo[key], dx, 0, Ztop - A.Ztop], [Bm.geo[key], -dx, 0, Ztop - Bm.Ztop]]);
  const geo = {
    object: both('object', 0), base: both('base'), wall: both('wall'), positive: both('positive'),
    silOver: sil('silOver'), silGap: sil('silGap'),
  };
  if (withLids) {
    const lids = [];
    for (const [M, x] of [[A, -dx], [Bm, dx]]) if (M.lid) for (const m of [M.lid.plate, M.lid.pegs, M.lid.core]) if (m) lids.push([m, x, yLid]);
    geo.lid = joinMeshes(lids);
    const gap = 3, total = pinParts.reduce((s, q) => s + 2 * q.r + gap, -gap);
    let x = -total / 2;
    geo.pins = joinMeshes(pinParts.map((q) => { x += q.r; const m = cylinder(x, yPin, q.r, 0, q.len); x += q.r + gap; return [m]; }));
  }
  const st = [A.stats, Bm.stats];
  return {
    G: A.G, geo, B: A.B, Ztop, maxTop: Math.max(A.maxTop, Bm.maxTop), res: A.res, p, colors: null,
    parts: st.map((s, i) => ({ ...s, B: [A, Bm][i].B, Ztop: [A, Bm][i].Ztop })),
    stats: {
      castMl: st[0].castMl + st[1].castMl, silMl: st[0].silMl + st[1].silMl,
      obj: [2 * w + 2, h], tpl: [2 * w + 2, rows], sil: [2 * w + 2, h],
      objH: Math.max(st[0].objH, st[1].objH), tplH: Ztop,
    },
  };
}

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
export function buildModel(hf, p, first = null) {
  const res = hf.res, B = p.baseT, T = p.backT;
  const border = p.border, gap = p.gap, wallT = p.wallT, over = p.over;
  // (with a hanger loop, room for it above the object; with pins, for the tab they are cast on, see pinTab: both halves
  // get it, so their grids stay the same size. A pin is at most 3 pin widths long, see stl.js placePins)
  const pad = Math.ceil((border + gap + wallT + 1.5 + (p.hanger ? p.hanger + 2 * p.hangerT + 1 : 0)
    + (hf.pins?.length ? 3 * p.pinD + 2 * PIN_WALL : 0)) / res) + 3;
  const W = hf.W + 2 * pad, H = hf.H + 2 * pad, N = W * H;
  const mask = new Uint8Array(N), shell = hf.shell && new Uint8Array(N), cut = hf.cut && new Uint8Array(N);
  let relief = new Float32Array(N), lines = new Float32Array(N);
  const colors = hf.px ? new Uint8Array(N * 3) : null; // image colours, for the optional painted preview
  for (let j = 0; j < hf.H; j++) {
    for (let i = 0; i < hf.W; i++) {
      const k = (j + pad) * W + i + pad;
      mask[k] = hf.mask[j * hf.W + i]; relief[k] = hf.relief[j * hf.W + i];
      if (shell) shell[k] = hf.shell[j * hf.W + i];
      if (cut) cut[k] = hf.cut[j * hf.W + i];
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
  for (let k = 0; k < N; k++) sdfPlaque[k] = sdf[k] + border + 1e-4;
  const G = { W, H, res, ox: -(W - 1) * res / 2, oy: (H - 1) * res / 2 };
  const hanger = p.hanger > 0 ? hangerLoop(G, sdfPlaque, relief, T, p.hanger / 2, p.hangerT, p.hangerShift) : null;
  for (let k = 0; k < N; k++) sdfCav[k] = sdfPlaque[k] + gap;
  let sdfShell = null;
  if (shell) { // a two-part mold's halves: the whole object's outline (stl.js halvesFromSTL)
    sdfShell = signedDist(shell, W, H);
    for (let k = 0; k < N; k++) sdfShell[k] *= res;
    if (p.maskSmooth > 0) sdfShell = blur(sdfShell, W, H, p.maskSmooth / res);
    for (let k = 0; k < N; k++) sdfCav[k] = Math.max(sdfCav[k], sdfShell[k] + border + 1e-4 + gap);
  }
  // a flat side of it at the edge (stl.js flatEdge): the mold ends there, its wall just inside the model, so the
  // side is left open to pour through (the lower half's is mirrored, like its height map)
  const opening = shell && (first ? first.closed.opening && { ...first.closed.opening, nx: -first.closed.opening.nx } : hf.opening);
  if (opening) {
    for (let k = 0; k < N; k++) {
      const x = G.ox + (k % W) * res, y = G.oy - ((k / W) | 0) * res;
      sdfCav[k] = Math.min(sdfCav[k], opening.c - opening.depth - (opening.nx * x + opening.ny * y));
    }
  }
  // Openings in the object wider than the gap (between legs, beside a face) would otherwise get walls of their
  // own. The wall only follows the outside; enclosed openings are filled with silicone, which keeps them open in the cast.
  const cav = new Uint8Array(N);
  for (let k = 0; k < N; k++) cav[k] = sdfCav[k] > 0 ? 1 : 0;
  const filled = Uint8Array.from(cav);
  fillHoles(filled, W, H);
  for (let k = 0; k < N; k++) if (filled[k] && !cav[k]) sdfCav[k] = Math.max(-sdfCav[k], 0.05);
  // glued halves' alignment pins, one per pair of holes and a little loose, cast on a tab of the first half's mold
  const pinCasts = hf.castPins ? pinTab(G, sdfCav, hf.pins.map((q) => ({ r: q.r - 0.15, len: 2 * q.d - 0.6 }))) : [];
  for (let k = 0; k < N; k++) {
    sdfOut[k] = sdfCav[k] + wallT;
    ring[k] = Math.min(sdfOut[k], -sdfCav[k]);
    gapRing[k] = Math.min(sdfCav[k], -sdfPlaque[k]);
    objTop[k] = Math.max(T + relief[k], 0.3);
    posTop[k] = objTop[k] + B;
    if (sdfPlaque[k] > 0 && objTop[k] > maxTop) maxTop = objTop[k];
  }
  const Ztop = B + maxTop + over;
  // two-part molds: keys and the pour hole, placed on the upper half's mold and mirrored onto the lower one's
  const closed = shell && (first ? mirrorClosed(first.closed) : closedParts(G, shell, sdfShell, cut, sdfCav, sdfOut, opening, p));

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
  // the loop takes the colour of the top of the object it hangs from
  const painted = colors && spreadColours(colors, mask, W, H);
  if (painted && hanger) for (const k of hanger.cells) painted.copyWithin(k * 3, hanger.from * 3, hanger.from * 3 + 3);
  return {
    G, geo, lid, pins, pinCasts, closed, B, Ztop, maxTop, res, p, colors: painted, hanger: hanger?.mesh,
    sdfCav, // the template's inside outline, for exact STL halves
    stats: { castMl: cast * a, silMl: sil * a, obj: dims(bo), tpl: dims(bt), sil: dims(bc), objH: maxTop, tplH: Ztop },
  };
}

// A hanger loop (flat-back objects): a ring with a hole of radius r for a string, wall mm wide, on a short stem from the
// top of the outline, above the object's balance point so the cast hangs straight. It is added to the outline (sdf, in
// mm) and is as thick as the back plate T, so it sits flush with it, but at least HANGER_MIN (relief). shift moves it
// sideways from the balance point, in % of the outline's width (to the right). The silicone fills its hole, which keeps
// it open in the cast.
const HANGER_MIN = 2;
function hangerLoop(G, sdf, relief, T, r, wall, shift) {
  const { W, H, res, ox, oy } = G, N = W * H, R = r + wall, stem = 0.6 * R;
  const x = (k) => ox + (k % W) * res, y = (k) => oy - ((k / W) | 0) * res;
  let m = 0, mx = 0, x0 = Infinity, x1 = -Infinity;
  for (let k = 0; k < N; k++) {
    if (sdf[k] <= 0) continue;
    const w = Math.max(T + relief[k], 0.3);
    m += w; mx += w * x(k); x0 = Math.min(x0, x(k)); x1 = Math.max(x1, x(k));
  }
  const cx = Math.min(x1, Math.max(x0, mx / m + shift / 100 * (x1 - x0)));
  let from = -1; // the top of the outline over the stem
  for (let k = 0; k < N && from < 0; k++) if (sdf[k] > 0 && Math.abs(x(k) - cx) <= stem) from = k;
  const top = y(from), cy = top + r + 0.8;
  // the ring, and the stem from just inside the outline up to the ring's middle; then the hole
  const loop = new Float32Array(N), hole = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const dx = x(k) - cx, d = Math.hypot(dx, y(k) - cy);
    loop[k] = Math.max(Math.min(R - d, d - r), Math.min(stem - Math.abs(dx), cy - y(k), y(k) - top + 1.5));
    hole[k] = d - r;
  }
  // Its height also goes to the cells just outside it (nearer the loop than the object), so its edge is a wall, not a
  // slope down to the floor that zigzags between cells (as an STL's edge, above)
  const cells = [], thick = Math.max(T, HANGER_MIN);
  for (let k = 0; k < N; k++) {
    const own = Math.min(loop[k], hole[k]);
    if (sdf[k] <= 0 && own > sdf[k] && own > -3 * res) relief[k] = thick - T;
    if (sdf[k] <= 0 && own > 0) cells.push(k);
    sdf[k] = Math.min(Math.max(sdf[k], loop[k]), hole[k]);
    loop[k] = own;
  }
  // the loop alone, for showing with an STL shown as it is (build-worker.js); its colour is taken from 3 mm inside the
  // top of the outline, past an outline's ink and soft edge
  let inside = from;
  for (let n = 0; n < 3 / res && inside + W < N && sdf[inside + W] > 0; n++) inside += W;
  return { cells, from: inside, mesh: meshSolid(G, loop, 0, thick) };
}

// A two-part mold's keys and pour hole (cut by exact.js). Its two silicone halves are pressed together face to face and
// filled as one, so the cast is the whole object: through its flat side left open at the mold's edge (opening), or
// else through a pour hole. Keys: up to p.keys balls of diameter p.keyD centred on the template's floor (z = B), on the
// upper half's template standing up (the silicone gets hollows), on the lower one's sunk into the floor (it gets
// bumps). Each goes only where the silicone around it is at least KEY_WALL thick, towards the object and the outside
// (also the opening and the pour hole), as far as can be from the others: the first as far out as can be, each next
// one as far as can be from those before. There are none if the base is too thin for their hollows (KEY_FLOOR under
// them). The pour hole: a round channel of diameter p.sprueD lying on the floor, half
// in each silicone face, from the lowest point of the cut face straight down to the outside, where it widens into a
// funnel.
const KEY_WALL = 1, KEY_FLOOR = 0.9;
function closedParts(G, shell, sdfShell, cut, sdfCav, sdfOut, opening, p) {
  const { W, H, res, ox, oy } = G, N = W * H;
  const x = (k) => ox + (k % W) * res, y = (k) => oy - ((k / W) | 0) * res;
  let cx = 0, cy = 0, n = 0;
  for (let k = 0; k < N; k++) if (shell[k]) { cx += x(k); cy += y(k); n++; }
  cx /= n; cy /= n;
  // the lowest cell of the cut face, the one nearest the middle among equals
  let low = -1;
  for (let k = 0; k < N; k++) {
    if (!cut[k]) continue;
    if (low < 0 || y(k) < y(low) - 1e-6 || (y(k) < y(low) + 1e-6 && Math.abs(x(k) - cx) < Math.abs(x(low) - cx))) low = k;
  }
  let sprue = null;
  if (!opening) {
    const r = p.sprueD / 2;
    let k = low;
    while (k + W < N && sdfCav[k + W] > 0) k += W;
    const ySil = y(k); // the silicone's outside
    while (k + W < N && sdfOut[k + W] > 0) k += W;
    sprue = { x: x(low), y0: y(low) + Math.min(1, r), y1: y(k), ySil, r, R: 1.8 * r };
  }
  const keys = [], r = p.keyD / 2, room = r + KEY_WALL;
  if (p.keys > 0 && r + KEY_FLOOR <= p.baseT) {
    // (sdfCav is never more than the distance to the silicone's outside, so this is on the safe side)
    const fromOpening = (q) => (opening ? opening.c - opening.depth - (opening.nx * x(q) + opening.ny * y(q)) : Infinity);
    const nearSprue = (q) => sprue && Math.abs(x(q) - sprue.x) < sprue.R + room && y(q) < sprue.y0 + room;
    const fits = [];
    for (let q = 0; q < N; q++) {
      if (-sdfShell[q] - p.border >= room && sdfCav[q] >= room && fromOpening(q) >= room && !nearSprue(q)) fits.push(q);
    }
    const step = Math.ceil(fits.length / 20000), spots = fits.filter((_, i) => i % step === 0); // enough to choose from
    const near = new Float32Array(spots.length).fill(Infinity); // each spot's distance to the nearest key so far
    let next = spots.reduce((b, q, i) => (Math.hypot(x(q) - cx, y(q) - cy) > Math.hypot(x(spots[b]) - cx, y(spots[b]) - cy) ? i : b), 0);
    while (spots.length && keys.length < p.keys) {
      const q = spots[next];
      keys.push({ x: x(q), y: y(q), r, bump: true });
      next = -1;
      spots.forEach((s, i) => {
        near[i] = Math.min(near[i], Math.hypot(x(s) - x(q), y(s) - y(q)));
        if (near[i] >= 2 * r + KEY_WALL && (next < 0 || near[i] > near[next])) next = i;
      });
      if (next < 0) break; // no room for another
    }
  }
  return { keys, sprue, opening };
}
// Glued halves' alignment pins are cast with the halves, lying side by side in channels on a tab added to the bottom of
// the first half's mold (cut by exact.js), centred on its lowest point so the tab joins it there, each PIN_WALL of
// silicone from the next and from the tab's edge. A channel is formed by a pin-sized rod lying on the template's floor,
// its axis PIN_SUNK of its radius above the floor: the rest of the rod is sunk into the floor. So the channel wraps a
// little past the pin's middle, and the cast pin is round but for a narrow flat along its top, which still fits the
// round holes; the silicone bends enough to let it out. sdfCav is widened by the tab; returns the pins
// ({ x, y, r, len }: lying along -y from y).
const PIN_WALL = 1;
export const PIN_SUNK = 0.5;
function pinTab(G, sdfCav, parts) {
  const { W, H, res, ox, oy } = G, N = W * H;
  const x = (k) => ox + (k % W) * res, y = (k) => oy - ((k / W) | 0) * res;
  let low = -1;
  for (let k = 0; k < N; k++) if (sdfCav[k] > 0 && (low < 0 || y(k) < y(low))) low = k;
  const r = Math.max(...parts.map((q) => q.r)), len = Math.max(...parts.map((q) => q.len));
  const step = 2 * r + PIN_WALL, total = (parts.length - 1) * step, xb = x(low), y0 = y(low) - PIN_WALL;
  // the tab: a rectangle with corners rounded by c, from below the row up into the mold
  const top = y(low) + 0.5, bottom = y0 - len - PIN_WALL, cy = (top + bottom) / 2;
  const hx = total / 2 + r + PIN_WALL, hy = (top - bottom) / 2, c = r + PIN_WALL;
  for (let k = 0; k < N; k++) {
    const qx = Math.abs(x(k) - xb) - (hx - c), qy = Math.abs(y(k) - cy) - (hy - c);
    sdfCav[k] = Math.max(sdfCav[k], c - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0));
  }
  return parts.map((q, i) => ({ ...q, x: xb - total / 2 + i * step, y: y0 }));
}

// the lower half's: mirrored left to right, like its height map, with the keys the other way round
const mirrorClosed = ({ keys, sprue }) => ({
  keys: keys.map((q) => ({ ...q, x: -q.x, bump: !q.bump })), sprue: sprue && { ...sprue, x: -sprue.x },
});

// Two halves of an STL (a model for each) laid out side by side, so each stage downloads as one file.
// With lids, the templates' stage also has the lids in front of the templates; the cast halves and the silicone stay
// centred.
export function buildHalves([A, Bm], p) {
  const w = (A.G.W - 1) * A.res, h = (A.G.H - 1) * A.res, dx = w / 2 + 1;
  const withLids = !!(A.lid || Bm.lid);
  const rows = withLids ? 2 * h + 2 : h;
  const y0 = rows / 2 - h / 2, yLid = y0 - h - 2;
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

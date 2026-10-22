// Finding the shape in an image: background, ground shadows, specks, enclosed gaps, painted edits.
import { blur, distTo, fillHoles, sampleImage, neighbours } from './grid.js';

// Painted outline edits (see the editor): 1 = added to the shape, 2 = removed from it, per cell.
export function editCells(edit, img, rect, W, H) {
  if (!edit) return null;
  const k = edit.add.width / img.width, r = { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k };
  const a = sampleImage(edit.add, r, W, H), c = sampleImage(edit.cut, r, W, H), out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = a[i * 4 + 3] > 100 ? 1 : c[i * 4 + 3] > 100 ? 2 : 0;
  return out;
}
export function shapeMask(px, W, H, p) {
  const N = W * H;
  // transparency if the image has it, otherwise the background colour around the edges
  let clear = 0;
  for (let k = 0; k < N; k++) if (px[k * 4 + 3] < 200) clear++;
  let mask = new Uint8Array(N), open = new Uint8Array(N), bgc = null; // open = background-coloured (or transparent)
  const edit = p.edit;
  if (clear > N * 0.01) {
    for (let k = 0; k < N; k++) { mask[k] = px[k * 4 + 3] > 128 ? 1 : 0; open[k] = 1 - mask[k]; }
    if (edit) for (let k = 0; k < N; k++) if (edit[k]) { mask[k] = edit[k] === 1 ? 1 : 0; open[k] = 1 - mask[k]; }
    fillHoles(mask, W, H);
  } else {
    const rs = [], gs = [], bs = [];
    const add = (k) => { rs.push(px[k * 4]); gs.push(px[k * 4 + 1]); bs.push(px[k * 4 + 2]); };
    for (let i = 0; i < W; i++) { add(i); add((H - 1) * W + i); }
    for (let j = 0; j < H; j++) { add(j * W); add(j * W + W - 1); }
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
    bgc = p.bgc || [med(rs), med(gs), med(bs)];
    const near = (k, c, tol) => {
      const dr = px[k * 4] - c[0], dg = px[k * 4 + 1] - c[1], db = px[k * 4 + 2] - c[2];
      return dr * dr + dg * dg + db * db <= tol * tol;
    };
    const bgLike = (k) => px[k * 4 + 3] <= 128 || near(k, bgc, p.tol);
    const shadow = findGroundShadow(px, W, H, bgc);
    // soft shadow edges: colours on the line between the shadow tone and the background
    const shadowLike = (k) => {
      if (!shadow) return false;
      let t = 0, l2 = 0;
      for (let c = 0; c < 3; c++) { const d = bgc[c] - shadow[c]; t += (px[k * 4 + c] - shadow[c]) * d; l2 += d * d; }
      t = Math.min(1, Math.max(0, t / l2));
      const c = [0, 1, 2].map((i) => shadow[i] + (bgc[i] - shadow[i]) * t);
      return near(k, c, 14);
    };
    // background = everything reachable from the image border through background (or shadow) colours
    // Seeds are the border stretches that connect to a background corner, so a figure cut off by the image edge
    // (a dress running off the bottom) isn't flooded through its open end.
    for (let k = 0; k < N; k++) open[k] = bgLike(k) || shadowLike(k) ? 1 : 0;
    if (edit) for (let k = 0; k < N; k++) if (edit[k]) open[k] = edit[k] === 2 ? 1 : 0;
    // closing outline gaps: the flood may not pass within `gap` cells of the drawing; grown back afterwards
    const gap = Math.max(0, (p.gapClose || 0) * (p.cellsPerMm || W / (p.width || W)));
    let dFig = null;
    if (gap > 0.5) {
      const fig = new Uint8Array(N);
      for (let k = 0; k < N; k++) fig[k] = open[k] ? 0 : 1;
      dFig = distTo(fig, W, H);
    }
    const reached = new Uint8Array(N), stack = [];
    const passable = (k) => open[k] && (!dFig || dFig[k] > gap);
    const push = (k) => { if (!reached[k] && passable(k)) { reached[k] = 1; stack.push(k); } };
    const ring = [];
    for (let i = 0; i < W; i++) ring.push(i);
    for (let j = 1; j < H; j++) ring.push(j * W + W - 1);
    for (let i = W - 2; i >= 0; i--) ring.push((H - 1) * W + i);
    for (let j = H - 2; j > 0; j--) ring.push(j * W);
    const corners = [0, W - 1, W + H - 2, 2 * W + H - 3].filter((c) => passable(ring[c]));
    if (!corners.length) for (const k of ring) push(k); // no background corner: fall back to the whole border
    for (const c of corners) {
      for (const dir of [1, -1]) {
        for (let n = 0, r = c; n < ring.length && passable(ring[r]); n++, r = (r + dir + ring.length) % ring.length) push(ring[r]);
      }
    }
    // the background may drift gradually (vignetting, uneven lighting in photos of prints): from a background
    // cell, a neighbour of almost the same colour counts too, as long as it stays roughly background-coloured
    // (compared on slightly blurred colours so photo grain doesn't stop it)
    const soft = [0, 1, 2].map((c) => {
      const a = new Float32Array(N);
      for (let k = 0; k < N; k++) a[k] = px[k * 4 + c];
      return blur(a, W, H, 1.5);
    });
    const drift = (k, q) => {
      if ((dFig && dFig[q] <= gap) || (edit && edit[q] === 1)) return false;
      for (const a of soft) if (Math.abs(a[k] - a[q]) > 4) return false;
      return near(q, bgc, p.tol * 2.5);
    };
    while (stack.length) {
      const k = stack.pop();
      for (const q of neighbours(k, W, H)) {
        if (q < 0 || reached[q]) continue;
        if (passable(q) || drift(k, q)) { reached[q] = 1; open[q] = 1; stack.push(q); }
      }
    }
    if (dFig) { // grow the background back up to the drawing
      const dBg = distTo(reached, W, H);
      for (let k = 0; k < N; k++) if (open[k] && dBg[k] <= gap + 1) reached[k] = 1;
    }
    for (let k = 0; k < N; k++) mask[k] = reached[k] ? 0 : 1;
  }
  if (edit) for (let k = 0; k < N; k++) if (edit[k] === 2) { mask[k] = 0; open[k] = 1; }
  mask = dropSpecks(mask, W, H);
  if (edit) for (let k = 0; k < N; k++) if (edit[k] === 1) { mask[k] = 1; open[k] = 0; }
  mask.open = open;
  mask.bgc = bgc;
  return mask;
}

// The most common shadow-coloured tone (a darker version of the background) near the bottom of the image,
// if it covers a real area. Shaded clothes and shoes vary too much in tone to qualify.
export function findGroundShadow(px, W, H, bgc) {
  const bs = bgc[0] + bgc[1] + bgc[2];
  if (bs < 150) return null;
  const counts = new Map();
  for (let j = Math.floor(H * 0.6); j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i, r = px[k * 4], g = px[k * 4 + 1], b = px[k * 4 + 2], s = r + g + b;
      if (s < 30) continue;
      const ratio = s / bs;
      if (ratio < 0.4 || ratio > 0.92) continue;
      if (Math.abs(r / s - bgc[0] / bs) + Math.abs(g / s - bgc[1] / bs) + Math.abs(b / s - bgc[2] / bs) > 0.03) continue;
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let best = 0, bestKey = -1;
  for (const [key, c] of counts) if (c > best) { best = c; bestKey = key; }
  if (best < W * H * 0.01) return null;
  return [((bestKey >> 12) << 2) + 2, (((bestKey >> 6) & 63) << 2) + 2, ((bestKey & 63) << 2) + 2];
}

// Background-coloured areas enclosed by the figure were filled in as part of it. That's right for the white
// inside of a line drawing, wrong for background showing between legs. AI depth tells them apart: an enclosed
// area as far away as the background is a real gap and is opened up again.
export function reopenBackgroundHoles(mask, depth, W, H, res, strength) {
  const open = mask.open, N = W * H, bg = [], fig = [];
  for (let k = 0; k < N; k += 3) (mask[k] ? (open[k] ? null : fig) : bg)?.push(depth[k]);
  if (!bg.length || !fig.length) return;
  const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const bgD = median(bg), figD = median(fig);
  if (figD - bgD < 0.08) return; // depth can't tell figure from background here
  const comp = new Int32Array(N).fill(-1), stack = [], minArea = Math.max(8, (0.8 / res) ** 2);
  for (let s = 0; s < N; s++) {
    if (!mask[s] || !open[s] || comp[s] >= 0) continue;
    const cells = [];
    comp[s] = s; stack.push(s);
    while (stack.length) {
      const k = stack.pop(); cells.push(k);
      for (const q of neighbours(k, W, H)) if (q >= 0 && mask[q] && open[q] && comp[q] < 0) { comp[q] = s; stack.push(q); }
    }
    if (cells.length < minArea) continue;
    let sum = 0;
    for (const k of cells) sum += depth[k];
    // the depth map is coarse, so a gap picks up some depth from the parts around it
    if (sum / cells.length - bgD < strength * (figD - bgD)) for (const k of cells) mask[k] = 0;
  }
}

// keep the main shape(s), drop stray specks (watermarks, dirt, cropped bits of other objects)
export function dropSpecks(mask, W, H) {
  const N = W * H, comp = new Int32Array(N).fill(-1), sizes = [], edges = [], stack = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || comp[s] >= 0) continue;
    const id = sizes.length; let n = 0, edge = false;
    comp[s] = id; stack.push(s);
    while (stack.length) {
      const k = stack.pop(); n++;
      const i = k % W, j = (k / W) | 0;
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) edge = true;
      for (const q of neighbours(k, W, H)) if (q >= 0 && mask[q] && comp[q] < 0) { comp[q] = id; stack.push(q); }
    }
    sizes.push(n); edges.push(edge);
  }
  // pieces cut off by the image edge (dark photo corners, bits of a neighbouring drawing) must be big to count
  const big = Math.max(0, ...sizes), out = new Uint8Array(N);
  const keep = sizes.map((n, id) => n >= big * (edges[id] ? 0.25 : 0.04));
  for (let k = 0; k < N; k++) if (comp[k] >= 0 && keep[comp[k]]) out[k] = 1;
  return out;
}

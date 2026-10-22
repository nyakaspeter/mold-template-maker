// Reading an STL as a height map seen from above.
import { fitGrid } from './grid.js';

export function hfFromSTL(geom, p) {
  const src = geom.attributes.position.array, s = p.scale / 100;
  const n = src.length / 3, pts = new Float32Array(src.length);
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let v = 0; v < n; v++) {
    const x = src[v * 3] * s, y = src[v * 3 + 1] * s, z = src[v * 3 + 2] * s;
    let X, Y, Z;
    switch (p.stlUp) {
      case '-z': X = x; Y = -y; Z = -z; break;
      case 'y': X = x; Y = -z; Z = y; break;
      case '-y': X = x; Y = z; Z = -y; break;
      case 'x': X = -z; Y = y; Z = x; break;
      case '-x': X = z; Y = y; Z = -x; break;
      default: X = x; Y = y; Z = z;
    }
    pts[v * 3] = X; pts[v * 3 + 1] = Y; pts[v * 3 + 2] = Z;
    if (X < minx) minx = X; if (X > maxx) maxx = X;
    if (Y < miny) miny = Y; if (Y > maxy) maxy = Y;
    if (Z < minz) minz = Z; if (Z > maxz) maxz = Z;
  }
  const { res } = fitGrid(maxx - minx, maxy - miny, p.res);
  const W = Math.floor((maxx - minx) / res) + 1, H = Math.floor((maxy - miny) / res) + 1;
  const zb = new Float32Array(W * H).fill(-Infinity);
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
        const z = w0 * z0 + w1 * z1 + w2 * z2, k = j * W + i;
        if (z > zb[k]) zb[k] = z;
      }
    }
  }
  const mask = new Uint8Array(W * H), relief = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) if (zb[k] > -Infinity) { mask[k] = 1; relief[k] = zb[k] - minz; }
  return { W, H, res, mask, relief, kind: 'stl' };
}

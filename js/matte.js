// Refining a coarse AI matte at the picture's full resolution: a guided filter (He, Sun & Tang 2013) makes the
// matte follow the picture's own edges (hair, fingers, straps) instead of the model's coarse grid.

// mean over a (2r+1)² box, clamped at the borders
function boxMean(f, W, H, r) {
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    let s = 0, n = 0;
    for (let i = 0; i < Math.min(r, W); i++) { s += f[j * W + i]; n++; }
    for (let i = 0; i < W; i++) {
      if (i + r < W) { s += f[j * W + i + r]; n++; }
      if (i - r - 1 >= 0) { s -= f[j * W + i - r - 1]; n--; }
      t[j * W + i] = s / n;
    }
  }
  for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let j = 0; j < Math.min(r, H); j++) { s += t[j * W + i]; n++; }
    for (let j = 0; j < H; j++) {
      if (j + r < H) { s += t[(j + r) * W + i]; n++; }
      if (j - r - 1 >= 0) { s -= t[(j - r - 1) * W + i]; n--; }
      o[j * W + i] = s / n;
    }
  }
  return o;
}

// px: RGBA bytes of the picture (W × H), p: the coarse matte upsampled to W × H (0..1). Colour guide: a local linear
// model of the matte in R, G and B, solved per pixel (3 × 3), then averaged.
export function guidedMatte(px, W, H, p, r, eps) {
  const N = W * H, I = [0, 1, 2].map((c) => { const a = new Float32Array(N); for (let k = 0; k < N; k++) a[k] = px[k * 4 + c] / 255; return a; });
  const mI = I.map((a) => boxMean(a, W, H, r)), mp = boxMean(p, W, H, r);
  const prod = (a, b) => { const o = new Float32Array(N); for (let k = 0; k < N; k++) o[k] = a[k] * b[k]; return o; };
  const cov = (a, b, ma, mb) => { const m = boxMean(prod(a, b), W, H, r); for (let k = 0; k < N; k++) m[k] -= ma[k] * mb[k]; return m; };
  const cIp = I.map((a, c) => cov(a, p, mI[c], mp));
  const v = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]].map(([a, b]) => cov(I[a], I[b], mI[a], mI[b]));
  const A = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], B = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const rr = v[0][k] + eps, rg = v[1][k], rb = v[2][k], gg = v[3][k] + eps, gb = v[4][k], bb = v[5][k] + eps;
    // inverse of the symmetric 3 × 3 covariance
    const i00 = gg * bb - gb * gb, i01 = rb * gb - rg * bb, i02 = rg * gb - rb * gg;
    const i11 = rr * bb - rb * rb, i12 = rb * rg - rr * gb, i22 = rr * gg - rg * rg, det = rr * i00 + rg * i01 + rb * i02;
    const x = cIp[0][k], y = cIp[1][k], z = cIp[2][k];
    const a0 = (i00 * x + i01 * y + i02 * z) / det, a1 = (i01 * x + i11 * y + i12 * z) / det, a2 = (i02 * x + i12 * y + i22 * z) / det;
    A[0][k] = a0; A[1][k] = a1; A[2][k] = a2;
    B[k] = mp[k] - a0 * mI[0][k] - a1 * mI[1][k] - a2 * mI[2][k];
  }
  const mA = A.map((a) => boxMean(a, W, H, r)), mB = boxMean(B, W, H, r), q = new Float32Array(N);
  for (let k = 0; k < N; k++) q[k] = Math.min(1, Math.max(0, mA[0][k] * I[0][k] + mA[1][k] * I[1][k] + mA[2][k] * I[2][k] + mB[k]));
  return q;
}

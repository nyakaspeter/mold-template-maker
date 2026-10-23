// Exact STL halves: the model itself is cut, so nothing under an overhang is filled in (a height map can't curve
// back under itself). The cast half, the printed positive and the silicone are made with 3D booleans
// (manifold-3d, WebAssembly, loaded the first time a model is cut). The template's walls, base and lids only follow
// the outline and stay as they are. Only a closed, watertight model can be cut.
import { t } from './i18n.js';
import { originalMesh } from './stl.js';
import { outlineLoops } from './mesh.js';

let libP = null;
const lib = () => (libP ||= import('https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.js')
  .then(async (m) => { const w = await m.default(); w.setup(); return w; }));

// a triangle list ({ P }) as a solid, with corners at the same place joined up
function solid(w, m) {
  const n = m.P.length / 3, tri = new Uint32Array(n);
  for (let i = 0; i < n; i++) tri[i] = i;
  const mesh = new w.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.P), triVerts: tri });
  mesh.merge();
  return new w.Manifold(mesh);
}
// the region where sdf > 0 (an outline on the grid), as a flat-topped solid from z0 to z1
function prism(w, G, sdf, z0, z1) {
  const cs = new w.CrossSection(outlineLoops(G, sdf), 'EvenOdd'), m = cs.extrude(z1 - z0), out = m.translate([0, 0, z0]);
  cs.delete(); m.delete();
  return out;
}
// back to a triangle list with flat normals, for the view and the STL
function triangles(man) {
  const { vertProperties: v, triVerts: t, numProp: np } = man.getMesh();
  const P = new Float32Array(t.length * 3), N = new Float32Array(t.length * 3);
  for (let i = 0; i < t.length; i += 3) {
    for (let c = 0; c < 3; c++) for (let d = 0; d < 3; d++) P[(i + c) * 3 + d] = v[t[i + c] * np + d];
    const o = i * 3;
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (let c = 0; c < 3; c++) { N[o + c * 3] = nx / l; N[o + c * 3 + 1] = ny / l; N[o + c * 3 + 2] = nz / l; }
  }
  return { P, N };
}

// Replaces the two half models' object, positive and silicone with exact ones.
export async function exactHalves(geom, p, models) {
  const w = await lib();
  const keep = []; // every solid made here, freed at the end (WebAssembly memory isn't garbage-collected)
  const k = (m) => { keep.push(m); return m; };
  try {
    let whole = null;
    try { whole = k(solid(w, originalMesh(geom, p))); } catch (e) { /* not a closed solid */ }
    if (!whole || whole.status() !== 'NoError' || whole.isEmpty()) {
      throw new Error(t('This model has holes or loose surfaces, so it can\'t be cut into halves. Repair it (e.g. in your slicer) and load it again, or set “Cut into two halves” to No.'));
    }
    // separate parts that overlap (a head pushed into a body) become one solid
    const parts = whole.decompose();
    if (parts.length > 1) whole = k(w.Manifold.union(parts));
    for (const m of parts) m.delete();
    const { min, max } = whole.boundingBox(), z0 = min[2] + (max[2] - min[2]) * p.splitAt / 100;
    // both halves stand on the cut; the lower one is turned over left to right, like its height map
    const halves = [
      k(k(whole.trimByPlane([0, 0, 1], z0)).translate([0, 0, -z0])),
      k(k(k(whole.trimByPlane([0, 0, -1], -z0)).translate([0, 0, -z0])).rotate([0, 180, 0])),
    ];
    models.forEach((M, i) => {
      const { G, B, Ztop } = M, body = halves[i]; // no back plate or border: they would end up in the glued seam
      let object = body;
      for (const q of M.pins) object = k(object.subtract(k(k(w.Manifold.cylinder(q.d + 0.01, q.r, q.r, 48)).translate([q.x, q.y, -0.01]))));
      const positive = k(body.translate([0, 0, B - 0.05]));
      const silicone = k(k(prism(w, G, M.sdfCav, B, Ztop)).subtract(positive));
      M.geo.object = triangles(object);
      M.geo.positive = triangles(positive);
      M.geo.silOver = triangles(silicone);
      M.geo.silGap = { P: new Float32Array(0), N: new Float32Array(0) };
      M.stats.castMl = object.volume() / 1000;
      M.stats.silMl = silicone.volume() / 1000;
      M.stats.objH = object.boundingBox().max[2];
    });
  } finally {
    for (const m of keep) m.delete();
  }
}

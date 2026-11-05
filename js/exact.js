// Exact STL halves: the model itself is cut, so nothing under an overhang is filled in (a height map can't curve
// back under itself). The cast half, the printed positive and the silicone are made with 3D booleans
// (manifold-3d, WebAssembly, loaded the first time a model is cut). The template's walls, base and lids only follow
// the outline. Each printed template and lid is fused into one solid for STL splitting.
// Only a closed, watertight model can be cut.
import { t } from './i18n.js';
import { originalMesh } from './stl.js';
import { outlineLoops } from './mesh.js';
import { PIN_SUNK } from './model.js';

let libP = null;
const lib = () => (libP ||= import('https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.js')
  .then(async (m) => { const w = await m.default(); w.setup(); return w; })
  .catch((error) => { libP = null; throw error; }));

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

// The model as one closed solid, standing on its lowest point where its height map does
function wholeSolid(w, k, geom, p) {
  let whole = null;
  try { whole = k(solid(w, originalMesh(geom, p))); } catch (e) { /* not a closed solid */ }
  if (!whole || whole.status() !== 'NoError' || whole.isEmpty()) throw new Error(t('invalidSolid'));
  // separate parts that overlap (a head pushed into a body) become one solid
  const parts = whole.decompose();
  if (parts.length > 1) whole = k(w.Manifold.union(parts));
  for (const m of parts) m.delete();
  return whole;
}

// One half's object, positive and silicone from its solid body, standing on the cut at z = 0
function exactModel(w, k, M, body) {
  const { G, B, Ztop } = M; // no back plate or border: they would end up in the glued seam
  let object = body;
  // the lid's core is printed on its face (z = B); on the mold, that face lies on the cut. It is made on the grid,
  // a few triangles per cell: simplified (within 0.02 mm), it is a fraction of the size
  const core = M.lid?.core ? k(k(solid(w, M.lid.core)).simplify(0.02)) : null;
  if (core) object = k(object.subtract(k(core.translate([0, 0, -B]))));
  for (const q of M.pins) object = k(object.subtract(k(k(w.Manifold.cylinder(q.d + 0.01, q.r, q.r, 48)).translate([q.x, q.y, -0.01]))));
  const positive = k(body.translate([0, 0, B - 0.05]));
  // a two-part mold's keys and pour hole, if any (model.js closedParts): what stands on the template's floor is left
  // out of the silicone, what is sunk into it is added
  const raised = [], sunk = [];
  if (M.closed) {
    for (const q of M.closed.keys) (q.bump ? raised : sunk).push(k(k(w.Manifold.sphere(q.r, 32)).translate([q.x, q.y, B])));
    const s = M.closed.sprue;
    if (s) {
      const F = Math.min(6, (s.y0 - s.ySil) / 2);
      // a cone along the floor, from y0 down (-y) for len mm, its radius going from r0 to r1
      const along = (y0, len, r0, r1) => k(k(k(w.Manifold.cylinder(len, r0, r1, 32)).rotate([90, 0, 0])).translate([s.x, y0, B]));
      raised.push(along(s.y0, s.y0 - s.y1, s.r, s.r), along(s.ySil + F, F, s.r, s.R));
    }
  }
  // glued halves' pins, cast on a tab of this half's mold (model.js pinTab): rods lying on the template's floor, partly
  // sunk into it, make their channels in the silicone
  const pins = M.pinCasts || [];
  const rod = (q, z) => k(k(k(w.Manifold.cylinder(q.len, q.r, q.r, 48)).rotate([90, 0, 0])).translate([q.x, q.y, z + PIN_SUNK * q.r]));
  raised.push(...pins.map((q) => rod(q, B)));
  let mold = k(prism(w, G, M.sdfCav, B, Ztop));
  if (sunk.length) mold = k(w.Manifold.union([mold, ...sunk]));
  const silicone = k(mold.subtract(k(w.Manifold.union([positive, ...raised]))));
  // the cast: the half and its pins, lying beside it on their flat
  if (pins.length) object = k(w.Manifold.union([object, ...pins.map((q) => k(rod(q, 0).trimByPlane([0, 0, 1], 0)))]));
  M.geo.object = triangles(object);
  // STL has no object hierarchy: slicers split connected shells. Fuse each physical
  // printed part so base/walls/positive and lid/pegs do not split into separate objects.
  let template = k(w.Manifold.union([k(solid(w, M.geo.base)), k(solid(w, M.geo.wall)), positive, ...raised]));
  for (const m of sunk) template = k(template.subtract(m));
  M.geo.base = triangles(template);
  M.geo.wall = { P: new Float32Array(0), N: new Float32Array(0) };
  M.geo.positive = { P: new Float32Array(0), N: new Float32Array(0) };
  if (M.lid) {
    const parts = [M.lid.plate, M.lid.pegs].filter((m) => m.P.length).map((m) => k(solid(w, m)));
    M.lid.plate = triangles(k(k(w.Manifold.union(core ? [...parts, core] : parts)).simplify(0.02)));
    M.lid.pegs = { P: new Float32Array(0), N: new Float32Array(0) };
    M.lid.core = null;
  }
  M.geo.silOver = triangles(silicone);
  M.geo.silGap = { P: new Float32Array(0), N: new Float32Array(0) };
  M.stats.castMl = object.volume() / 1000;
  M.stats.silMl = silicone.volume() / 1000;
  M.stats.objH = object.boundingBox().max[2];
}

// Replaces the two half models' object, positive and silicone with exact ones.
export async function exactHalves(geom, p, models) {
  const w = await lib();
  const keep = []; // every solid made here, freed at the end (WebAssembly memory isn't garbage-collected)
  const k = (m) => { keep.push(m); return m; };
  try {
    const whole = wholeSolid(w, k, geom, p);
    const { min, max } = whole.boundingBox(), z0 = min[2] + (max[2] - min[2]) * p.splitAt / 100;
    // both halves stand on the cut; the lower one is turned over left to right, like its height map
    const halves = [
      k(k(whole.trimByPlane([0, 0, 1], z0)).translate([0, 0, -z0])),
      k(k(k(whole.trimByPlane([0, 0, -1], -z0)).translate([0, 0, -z0])).rotate([0, 180, 0])),
    ];
    models.forEach((M, i) => exactModel(w, k, M, halves[i]));
  } finally {
    for (const m of keep) m.delete();
  }
}

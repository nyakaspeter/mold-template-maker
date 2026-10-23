// The 3D view: object, printed template and silicone mold, and exporting them as STL.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $ } from './dom.js';

const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
camera.up.set(0, 0, 1);
camera.position.set(0, -160, 130);
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-60, -90, 160); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(80, 60, 40); scene.add(fill);

const mat = {
  resin: new THREE.MeshStandardMaterial({ color: 0x9ea7b3, roughness: 0.55 }),
  sil: new THREE.MeshStandardMaterial({ color: 0x63c7b2, roughness: 0.4 }),
  cast: new THREE.MeshStandardMaterial({ color: 0xf4a6c4, roughness: 0.5 }),
  painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
};
let root = null, grid = null, meshes = {}, firstFit = true;
let objUp = null, objDown = null; // the object's shape the right way up, and turned over (made when first shown)
export let M = null; // the model on show

function geomOf(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.N, 3));
  g.computeBoundingSphere();
  return g;
}
export function showModel(model, painted, upsideDown) {
  M = model;
  if (root) { root.traverse((o) => o.geometry && o.geometry.dispose()); objUp?.dispose(); objDown?.dispose(); objDown = null; scene.remove(root); }
  root = new THREE.Group(); scene.add(root);
  const g = {};
  for (const k in M.geo) g[k] = geomOf(M.geo[k]);
  const add = (parent, geo, material) => { const m = new THREE.Mesh(geo, material); parent.add(m); return m; };
  if (M.colors) {
    const pos = g.object.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const { W, H, res, ox, oy } = M.G;
    for (let v = 0; v < pos.count; v++) {
      const i = Math.min(W - 1, Math.max(0, Math.round((pos.getX(v) - ox) / res)));
      const j = Math.min(H - 1, Math.max(0, Math.round((oy - pos.getY(v)) / res)));
      const k = (j * W + i) * 3;
      c.setRGB(M.colors[k] / 255, M.colors[k + 1] / 255, M.colors[k + 2] / 255, THREE.SRGBColorSpace);
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    g.object.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  meshes = {
    object: add(root, g.object, M.colors && painted ? mat.painted : mat.cast),
    base: add(root, g.base, mat.resin),
    wall: add(root, g.wall, mat.resin),
    positive: add(root, g.positive, mat.resin),
  };
  // two halves with alignment pins: the lids and the pins are printed with the templates
  for (const k of ['lid', 'pins']) if (g[k]) meshes[k] = add(root, g[k], mat.resin);
  // demolded silicone, turned over left-to-right so the cavity faces up: (x, y, z) -> (-x, y, Ztop - z)
  const flip = new THREE.Group();
  flip.rotation.y = Math.PI; flip.position.z = M.Ztop; root.add(flip);
  meshes.flip = flip;
  meshes.silOver = add(flip, g.silOver, mat.sil);
  meshes.silGap = add(flip, g.silGap, mat.sil);

  if (grid) scene.remove(grid);
  const span = Math.max(M.stats.tpl[0], M.stats.tpl[1]);
  const size = Math.ceil(span * 1.6 / 10) * 10;
  grid = new THREE.GridHelper(size, size / 10, 0x9097a0, 0xc4c8ce);
  grid.rotation.x = Math.PI / 2; grid.position.z = -0.02;
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);

  objUp = g.object; // the object can also be shown turned over: see setUpsideDown
  setUpsideDown(upsideDown);
  if (firstFit) { fitView(); firstFit = false; }
}
// The object turned over sideways, to see its underside with the top still at the back: each piece (both halves of a
// cut STL) turned around its own middle, so it stays in place, standing on the ground. Only for showing.
function turnedOver(g) {
  const src = g.attributes.position.array, nrm = g.attributes.normal.array, P = new Float32Array(src.length), N = new Float32Array(nrm.length);
  const piece = (v) => (M.parts && src[v * 3] > 0 ? 1 : 0); // cut halves: left and right of x = 0
  const box = [[Infinity, -Infinity, -Infinity], [Infinity, -Infinity, -Infinity]]; // min x, max x, max z
  for (let v = 0; v < src.length / 3; v++) {
    const b = box[piece(v)];
    b[0] = Math.min(b[0], src[v * 3]); b[1] = Math.max(b[1], src[v * 3]); b[2] = Math.max(b[2], src[v * 3 + 2]);
  }
  for (let v = 0; v < src.length / 3; v++) { // half a turn around the y axis: x and z reverse, y stays
    const [x0, x1, top] = box[piece(v)];
    P[v * 3] = x0 + x1 - src[v * 3]; P[v * 3 + 1] = src[v * 3 + 1]; P[v * 3 + 2] = top - src[v * 3 + 2];
    N[v * 3] = -nrm[v * 3]; N[v * 3 + 1] = nrm[v * 3 + 1]; N[v * 3 + 2] = -nrm[v * 3 + 2];
  }
  const out = geomOf({ P, N });
  if (g.attributes.color) out.setAttribute('color', g.attributes.color);
  return out;
}
export function setUpsideDown(on) {
  if (!M) return;
  if (on && !objDown) objDown = turnedOver(objUp);
  meshes.object.geometry = on ? objDown : objUp;
}
// frame the next model that comes in (a new file)
export function requestFit() { firstFit = true; }

export function fitView() {
  if (!M) return;
  const [w, h] = M.stats.tpl;
  const fov = camera.fov * Math.PI / 180;
  const fit = Math.max(h, w / camera.aspect) * 0.62 / Math.tan(fov / 2) + M.Ztop;
  controls.target.set(0, 0, M.Ztop / 3);
  camera.position.set(0, -fit * 0.55, fit * 0.85);
  controls.update();
}

// which parts are visible for a stage: 1 object, 2 template, 3 mold (0, the image, shows none)
export function showStage(n) {
  const vis = { 0: [], 1: ['object'], 2: ['base', 'wall', 'positive', 'lid', 'pins'], 3: ['flip', 'silOver', 'silGap'] }[n];
  for (const k in meshes) meshes[k].visible = vis.includes(k);
}
export function setPainted(on) {
  if (M && M.colors) meshes.object.material = on ? mat.painted : mat.cast;
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ---------------------------------------------------------------- export
function exportSTL(list, name) {
  let tris = 0;
  for (const m of list) tris += m.geometry.attributes.position.count / 3;
  const buf = new ArrayBuffer(84 + tris * 50), dv = new DataView(buf);
  dv.setUint32(80, tris, true);
  let o = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (const m of list) {
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position, mw = m.matrixWorld;
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(mw);
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(mw);
      c.fromBufferAttribute(pos, i + 2).applyMatrix4(mw);
      n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
      for (const v of [n, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
      o += 2;
    }
  }
  const url = URL.createObjectURL(new Blob([buf], { type: 'model/stl' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// download the STL for a stage, named after the loaded file
export function exportStage(n, baseName) {
  if (n === 1) { // the right way up, however it is shown
    const shown = meshes.object.geometry;
    meshes.object.geometry = objUp;
    exportSTL([meshes.object], `${baseName}-object.stl`);
    meshes.object.geometry = shown;
  }
  else if (n === 2) exportSTL([meshes.base, meshes.wall, meshes.positive, meshes.lid, meshes.pins].filter(Boolean), `${baseName}-template.stl`);
  else exportSTL([meshes.silOver, meshes.silGap], `${baseName}-silicone-mold.stl`);
}

// The Orientation setting as a small 3D view of the STL: drag to turn it, and on release it snaps to the nearest of
// 24 positions (each side facing up, in four quarter turns). The turns are the same as in stl.js.
import * as THREE from 'three';

const sides = { // where the model's x, y and z axes end up with each side facing up (lying on a side, its top points back)
  z: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  '-z': [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
  y: [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  '-y': [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  x: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  '-x': [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
};
// a value like 'y' or 'y:1' (+Y up, then a quarter turn anticlockwise seen from above) as a rotation
const turnOf = (value) => {
  const [up, turns] = value.split(':');
  const [a, b, c] = sides[up].map((v) => new THREE.Vector3(...v));
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(a, b, c))
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (+turns || 0) * Math.PI / 2));
};
const positions = Object.keys(sides).flatMap((up) => [0, 1, 2, 3].map((q) => (q ? `${up}:${q}` : up)))
  .map((value) => ({ value, turn: turnOf(value) }));

// The scene stays; the canvas and its graphics context only exist while an STL is loaded (made fresh per file)
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 2, 0.1, 5000);
camera.up.set(0, 1, 0); // looking straight down: the back of the scene is the top of the view
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-60, -90, 160); scene.add(sun);
const turn = new THREE.Group(); scene.add(turn); // the model's turn, around its own middle
const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0xf4a6c4, roughness: 0.5 }));
turn.add(mesh);

let view = null, box = null, onPick = null, shown = 'z', anim = null;
const render = () => view?.renderer.render(scene, camera);
function resize() {
  if (!view) return;
  const { canvas, renderer } = view, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
}

// put the view into the settings panel (it is rebuilt when the language changes); pick(value) is called on a snap
export function attachOrient(el, pick) {
  box = el; onPick = pick;
  if (view) { box.appendChild(view.canvas); resize(); }
}
// let go of the view and its graphics context (an image was loaded, or before the next STL)
export function dropOrient() {
  cancelAnimationFrame(anim);
  if (view) {
    view.observer.disconnect(); view.renderer.dispose(); view.renderer.forceContextLoss(); view.canvas.remove();
    view = null;
  }
  mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry();
}
export function setOrientModel(geom) {
  dropOrient();
  const canvas = document.createElement('canvas');
  canvas.className = 'orientView';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  listen(canvas);
  view = { canvas, renderer, observer };
  geom.computeVertexNormals(); // many STLs leave the stored normals empty
  geom.computeBoundingSphere();
  const s = geom.boundingSphere, d = (s.radius || 1) / Math.tan(camera.fov * Math.PI / 360) * 1.15;
  mesh.geometry = geom; mesh.position.copy(s.center).negate();
  camera.position.set(0, 0, d); camera.lookAt(0, 0, 0); // exactly from above, as the mold is made
  turn.quaternion.copy(turnOf(shown));
  box?.appendChild(canvas); resize();
}
// show an orientation (animated unless now)
export function showOrient(value, now = false) {
  shown = value;
  const to = turnOf(value);
  if (now || !view) { turn.quaternion.copy(to); render(); return; }
  const from = turn.quaternion.clone(), t0 = performance.now();
  cancelAnimationFrame(anim);
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 220);
    turn.quaternion.slerpQuaternions(from, to, 1 - (1 - k) ** 3); render();
    if (k < 1) anim = requestAnimationFrame(step);
  };
  step();
}

// dragging rolls the model under the pointer (about the view's vertical and horizontal axes), like grabbing it;
// letting go snaps to the nearest of the 24 positions
function listen(canvas) {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim);
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const upward = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const q = new THREE.Quaternion().setFromAxisAngle(upward, dx * 0.012)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.012));
    turn.quaternion.premultiply(q); render();
  });
  const release = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return;
    const now = turn.quaternion;
    const near = positions.reduce((a, b) => (Math.abs(b.turn.dot(now)) > Math.abs(a.turn.dot(now)) ? b : a));
    showOrient(near.value);
    onPick?.(near.value);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}

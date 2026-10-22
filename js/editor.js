// The Image stage: the picture with what's left out darkened. Painting lightens (adds to the object), Shift +
// painting darkens (removes). Two paint layers at up to 1024 px, applied by shapeMask on the next build;
// painting one clears the other.
import { $ } from './dom.js';
import { S } from './state.js';

const E = { size: 24, undo: [], fit: null, outline: null, last: null, drawing: false, mix: null };
const DIM = 'rgb(15, 17, 22)';

// forget the painting and outline of the previous file
export function resetEditor() { E.undo = []; E.outline = null; }

function editLayers() {
  if (!S.edit) {
    const sc = Math.min(1, 1024 / Math.max(S.img.width, S.img.height));
    const make = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(S.img.width * sc); c.height = Math.round(S.img.height * sc);
      return c;
    };
    S.edit = { add: make(), cut: make() };
  }
  return S.edit;
}
export function setEditorOutline(hf) {
  // the shape from the last build, opaque where included, in the coordinates of hf.rect
  const { W, H, mask, rect } = hf, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d'), id = ctx.createImageData(W, H);
  for (let k = 0; k < W * H; k++) if (mask[k]) id.data[k * 4 + 3] = 255;
  ctx.putImageData(id, 0, 0);
  E.outline = { canvas: c, rect };
  if (!$('#editor').hidden) drawEditor();
}
export function drawEditor() {
  const cv = $('#edCanvas'), wrap = $('#edWrap'), dpr = devicePixelRatio || 1;
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (!cw || !ch || !S.img) return;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // the picture only appears once its outline is worked out; until then, a spinner
  $('#edLoading').hidden = !S.building;
  if (S.building) { E.fit = null; return; }
  const img = S.img, s = Math.min((cw - 32) / img.width, (ch - 32) / img.height);
  const ox = (cw - img.width * s) / 2, oy = (ch - img.height * s) / 2;
  E.fit = { s, ox, oy };
  ctx.drawImage(img, ox, oy, img.width * s, img.height * s);
  if (!E.outline && !S.edit) return;
  // darkening layer: everything, minus the shape, minus painted additions, plus painted removals
  const L = editLayers(), m = E.mix || (E.mix = document.createElement('canvas'));
  if (m.width !== L.add.width || m.height !== L.add.height) { m.width = L.add.width; m.height = L.add.height; }
  const mc = m.getContext('2d'), k = m.width / img.width;
  mc.globalCompositeOperation = 'source-over';
  mc.clearRect(0, 0, m.width, m.height);
  if (E.outline) { // nothing is darkened until the first build has found the shape
    const r = E.outline.rect;
    mc.fillStyle = DIM; mc.fillRect(0, 0, m.width, m.height);
    mc.globalCompositeOperation = 'destination-out';
    mc.drawImage(E.outline.canvas, r.x * k, r.y * k, r.w * k, r.h * k);
  }
  mc.globalCompositeOperation = 'destination-out';
  mc.drawImage(L.add, 0, 0);
  mc.globalCompositeOperation = 'source-over';
  mc.drawImage(L.cut, 0, 0);
  ctx.globalAlpha = 0.75;
  ctx.drawImage(m, ox, oy, img.width * s, img.height * s);
  ctx.globalAlpha = 1;
}
function paintAt(e) {
  const r = $('#edCanvas').getBoundingClientRect(), L = editLayers(), k = L.add.width / S.img.width;
  const x = (e.clientX - r.left - E.fit.ox) / E.fit.s * k, y = (e.clientY - r.top - E.fit.oy) / E.fit.s * k;
  const rad = E.size / 2 / E.fit.s * k, add = !e.shiftKey; // painting adds, Shift + painting removes
  for (const [layer, op] of [[L.add, add ? 'source-over' : 'destination-out'], [L.cut, add ? 'destination-out' : 'source-over']]) {
    const c = layer.getContext('2d');
    c.globalCompositeOperation = op;
    c.fillStyle = c.strokeStyle = DIM; c.lineWidth = rad * 2; c.lineCap = 'round';
    c.beginPath();
    if (E.last) { c.moveTo(E.last.x, E.last.y); c.lineTo(x, y); c.stroke(); }
    else { c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); }
  }
  E.last = { x, y };
  drawEditor();
}
function moveCursor(e) {
  const r = $('#edWrap').getBoundingClientRect(), c = $('#edCursor');
  c.style.display = 'block'; c.style.width = c.style.height = E.size + 'px';
  c.style.left = e.clientX - r.left + 'px'; c.style.top = e.clientY - r.top + 'px';
}
function snapshot() {
  const L = editLayers();
  return [L.add, L.cut].map((c) => c.getContext('2d').getImageData(0, 0, c.width, c.height));
}
function edited() { S.editUsed = true; S.editDirty = true; drawEditor(); }

// rebuild: recalculates the outline (after undo and reset, the last build's outline may hold painting that is gone)
export function initEditor(rebuild) {
  const cv = $('#edCanvas');
  cv.addEventListener('pointerdown', (e) => {
    if (!E.fit) return;
    cv.setPointerCapture(e.pointerId);
    E.undo.push(snapshot());
    if (E.undo.length > 15) E.undo.shift();
    E.drawing = true; E.last = null; paintAt(e);
  });
  cv.addEventListener('pointermove', (e) => { moveCursor(e); if (E.drawing) paintAt(e); });
  const end = () => { if (!E.drawing) return; E.drawing = false; edited(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { $('#edCursor').style.display = 'none'; });
  const shiftCursor = (e) => $('#edCursor').classList.toggle('cut', e.shiftKey);
  addEventListener('keydown', shiftCursor);
  addEventListener('keyup', shiftCursor);
  const sizeDot = () => { const d = 4 + E.size * 0.25; $('#sizeDot').style.width = $('#sizeDot').style.height = d + 'px'; };
  $('#edSize').oninput = (e) => { E.size = +e.target.value; sizeDot(); };
  sizeDot();
  $('#edUndo').onclick = () => {
    const prev = E.undo.pop();
    if (!prev || !S.edit) return;
    S.edit.add.getContext('2d').putImageData(prev[0], 0, 0);
    S.edit.cut.getContext('2d').putImageData(prev[1], 0, 0);
    S.editUsed = true; S.editDirty = false;
    rebuild();
  };
  $('#edClear').onclick = () => {
    if (!S.edit) return;
    E.undo.push(snapshot());
    for (const c of [S.edit.add, S.edit.cut]) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    S.editUsed = false; S.editDirty = false; // back to the outline as detected
    rebuild();
  };
  new ResizeObserver(() => { if (!$('#editor').hidden) drawEditor(); }).observe($('#edWrap'));
}

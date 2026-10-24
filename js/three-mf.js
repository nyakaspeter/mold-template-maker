// Read mesh builds, including the external component files used by Bambu Studio and OrcaSlicer.
import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

const productionNS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const units = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
// Errors the person can do something about carry a message key (app.js shows it translated); any other error means a
// damaged or invalid file, and its English text is only for the console.
const userError = (key, params, detail) => Object.assign(new Error(detail), { key, params });

export function parse3MF(data) {
  const archive = unzipSync(new Uint8Array(data)), models = new Map();
  const resolve = (base, target) => {
    const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  };
  const xml = (path) => {
    if (!archive[path]) throw new Error(`Missing 3MF file: ${path}`);
    const doc = new DOMParser().parseFromString(strFromU8(archive[path]), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(`Invalid 3MF XML: ${path}`);
    return doc;
  };
  const children = (node, name) => {
    if (!node) throw new Error(`Missing 3MF ${name} container.`);
    return [...node.children].filter((c) => c.localName === name);
  };
  const transform = (node) => {
    const text = node.getAttribute('transform');
    if (!text) return new Matrix4();
    const v = text.trim().split(/\s+/).map(Number);
    if (v.length !== 12 || v.some((n) => !Number.isFinite(n))) throw new Error('Invalid 3MF transform.');
    return new Matrix4().set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
  };
  const model = (path) => {
    if (models.has(path)) return models.get(path);
    const root = xml(path).documentElement;
    if (root.localName !== 'model') throw new Error(`Invalid 3MF model: ${path}`);
    const unit = root.getAttribute('unit') || 'millimeter', scale = units[unit];
    if (!scale) throw userError('threeMFUnit', { unit }, `Unsupported 3MF unit: ${unit}`);
    const resources = children(root, 'resources')[0];
    const result = { root, scale, objects: new Map(resources ? children(resources, 'object').map((o) => [o.getAttribute('id'), o]) : []) };
    models.set(path, result);
    return result;
  };
  const relationship = [...xml('_rels/.rels').getElementsByTagNameNS('*', 'Relationship')]
    .find((r) => /\/3dmodel$/.test(r.getAttribute('Type')));
  const target = relationship?.getAttribute('Target');
  if (!target) throw new Error('Missing 3MF model.');
  const rootPath = resolve('', target), rootModel = model(rootPath);
  const positions = [], active = new Set(), point = new Vector3();
  const visit = (path, id, matrix) => {
    const key = `${path}#${id}`;
    if (active.has(key)) throw new Error('Cyclic 3MF component reference.');
    const source = model(path), object = source.objects.get(id);
    if (!object) throw new Error(`Missing 3MF object: ${key}`);
    active.add(key);
    try {
      for (const mesh of children(object, 'mesh')) {
        const vertices = children(children(mesh, 'vertices')[0], 'vertex').map((v) =>
          ['x', 'y', 'z'].map((axis) => v.hasAttribute(axis) ? Number(v.getAttribute(axis)) : NaN));
        const mirrored = matrix.determinant() < 0;
        for (const triangle of children(children(mesh, 'triangles')[0], 'triangle')) {
          for (const attr of mirrored ? ['v1', 'v3', 'v2'] : ['v1', 'v2', 'v3']) {
            const index = triangle.hasAttribute(attr) ? Number(triangle.getAttribute(attr)) : NaN;
            const vertex = Number.isInteger(index) && vertices[index];
            if (!vertex || vertex.some((n) => !Number.isFinite(n))) throw new Error('Invalid 3MF mesh triangle.');
            point.fromArray(vertex).applyMatrix4(matrix);
            positions.push(point.x * rootModel.scale, point.y * rootModel.scale, point.z * rootModel.scale);
          }
        }
      }
      for (const components of children(object, 'components')) {
        for (const component of children(components, 'component')) {
          const external = component.getAttributeNS(productionNS, 'path');
          const childPath = external ? resolve(path, external) : path;
          const next = matrix.clone().multiply(transform(component));
          const ratio = model(childPath).scale / source.scale;
          next.scale(new Vector3(ratio, ratio, ratio));
          visit(childPath, component.getAttribute('objectid'), next);
        }
      }
    } finally { active.delete(key); }
  };
  const build = children(rootModel.root, 'build')[0];
  for (const item of build ? children(build, 'item') : []) {
    if (item.getAttribute('printable') === '0' || item.getAttribute('printable') === 'false') continue;
    const external = item.getAttributeNS(productionNS, 'path');
    const path = external ? resolve(rootPath, external) : rootPath;
    const matrix = transform(item), ratio = model(path).scale / rootModel.scale;
    matrix.scale(new Vector3(ratio, ratio, ratio));
    visit(path, item.getAttribute('objectid'), matrix);
  }
  if (!positions.length || positions.some((v) => !Number.isFinite(v))) throw userError('threeMFEmpty', {}, 'The 3MF contains no valid mesh triangles.');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

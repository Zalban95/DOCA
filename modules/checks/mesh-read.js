'use strict';

/**
 * 3D files as triangles (checks/mesh.js): STL (binary or text), OBJ, glTF (.glb, or .gltf with its buffers beside it or
 * inside it) read in Node; a STEP file only as the points it lists — enough for a bounding box, not for whether its
 * solid is closed, which the check then says. Returns { positions: Float64Array of x,y,z, triangles: Uint32Array of
 * vertex indices } or { points, solids } for STEP.
 */
const fs = require('fs');
const path = require('path');

function stl(buf) {
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : -1;
  if (n >= 0 && 84 + n * 50 === buf.length) {   // binary: its size says so (a text STL may begin with "solid" too, a binary one as well)
    const positions = new Float64Array(n * 9);
    for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) positions[i * 9 + j] = buf.readFloatLE(84 + i * 50 + 12 + j * 4);
    return { positions, triangles: Uint32Array.from({ length: n * 3 }, (_, i) => i) };
  }
  const text = buf.toString('latin1');
  if (!/^\s*solid/.test(text)) throw new Error('not an STL file (neither binary nor text)');
  const v = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap(m => [+m[1], +m[2], +m[3]]);
  if (v.length % 9) throw new Error('a text STL whose facets do not have three vertices each');
  return { positions: Float64Array.from(v), triangles: Uint32Array.from({ length: v.length / 3 }, (_, i) => i) };
}

function obj(buf) {
  const v = [], t = [];
  for (const line of buf.toString('utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'f') {
      const ids = p.slice(1).map(x => { const i = parseInt(x, 10); return i < 0 ? v.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < ids.length; k++) t.push(ids[0], ids[k], ids[k + 1]);   // a polygon as a fan
    }
  }
  return { positions: Float64Array.from(v), triangles: Uint32Array.from(t) };
}

const COMPONENTS = { 5120: [1, 'readInt8'], 5121: [1, 'readUInt8'], 5122: [2, 'readInt16LE'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function gltf(json, buffers) {
  const read = idx => {
    const a = json.accessors[idx], bv = json.bufferViews[a.bufferView], buf = buffers[bv.buffer];
    const [bytes, fn] = COMPONENTS[a.componentType], size = SIZE[a.type], stride = bv.byteStride || bytes * size;
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0), out = [];
    for (let i = 0; i < a.count; i++) for (let j = 0; j < size; j++) out.push(buf[fn](start + i * stride + j * bytes));
    return out;
  };
  const positions = [], triangles = [];
  // Every mesh as its nodes place it would need the node tree; the meshes as stored are what a print is made of.
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    if (p.attributes?.POSITION === undefined || (p.mode !== undefined && p.mode !== 4)) continue;
    const base = positions.length / 3, pos = read(p.attributes.POSITION);
    positions.push(...pos);
    const idx = p.indices !== undefined ? read(p.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i);
    for (const i of idx) triangles.push(base + i);
  }
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) };
}

function glb(buf) {
  if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB file');
  let off = 12, json = null;
  const buffers = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004E4942) buffers.push(body);
    off += 8 + len;
  }
  if (!json) throw new Error('a GLB with no JSON chunk');
  return gltf(json, buffers);
}

function gltfFile(buf, file) {
  const json = JSON.parse(buf.toString('utf8'));
  const buffers = (json.buffers || []).map(b => {
    const m = String(b.uri || '').match(/^data:[^,]*;base64,(.*)$/);
    if (m) return Buffer.from(m[1], 'base64');
    const beside = path.resolve(path.dirname(file), decodeURIComponent(b.uri || ''));
    if (path.dirname(beside) !== path.dirname(file) && !beside.startsWith(path.dirname(file) + path.sep)) throw new Error('a glTF buffer outside its folder');
    return fs.readFileSync(beside);
  });
  return gltf(json, buffers);
}

/** STEP: the points it lists (a bounding box, a little generous: placements count too) and how many solids it names. */
function step(buf) {
  const text = buf.toString('latin1');
  if (!/ISO-10303-21/.test(text.slice(0, 200))) throw new Error('not a STEP file (no ISO-10303-21 header)');
  const points = [...text.matchAll(/CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/g)].flatMap(m => [+m[1], +m[2], +m[3]]);
  const solids = (text.match(/MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS/g) || []).length;
  return { points: Float64Array.from(points), solids, step: true };
}

function read(file) {
  const ext = path.extname(file).toLowerCase(), buf = fs.readFileSync(file);
  if (ext === '.stl') return stl(buf);
  if (ext === '.obj') return obj(buf);
  if (ext === '.glb') return glb(buf);
  if (ext === '.gltf') return gltfFile(buf, file);
  if (ext === '.step' || ext === '.stp') return step(buf);
  throw new Error(`a ${ext || 'file'} is not a 3D format this check reads (STL, OBJ, GLB, glTF, STEP)`);
}

module.exports = { read, stl, obj, glb, step };

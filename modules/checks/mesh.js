'use strict';

/**
 * A 3D model as a printer would take it (checks/, plan contract `{mesh, maxSize?: [x, y, z], watertight?, minParts?, maxParts?}`):
 * its size (the bounding box, in the file's units — millimetres for a print), whether it fits `maxSize` as it lies or
 * turned, whether it is closed (every edge shared by exactly two triangles, the vertices welded first), and how many
 * separate parts it is. Read in Node (checks/mesh-read.js); a STEP file gives its size only, and says so.
 */
const { read } = require('./mesh-read');
const { verdict } = require('./verdict');

function normalize(c, bad) {
  const out = { mesh: String(c.mesh).slice(0, 500) };
  if (c.maxSize !== undefined) {
    if (!Array.isArray(c.maxSize) || c.maxSize.length !== 3 || !c.maxSize.every(v => Number(v) > 0)) throw bad('maxSize is [x, y, z], each a size above 0.');
    out.maxSize = c.maxSize.map(Number);
  }
  if (c.watertight !== undefined) out.watertight = !!c.watertight;
  for (const k of ['minParts', 'maxParts']) if (c[k] !== undefined) { const n = Number(c[k]); if (!Number.isInteger(n) || n < 1) throw bad(`${k} is a whole number from 1.`); out[k] = n; }
  return out;
}

function box(p) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let j = 0; j < 3; j++) { const v = p[i + j]; if (v < lo[j]) lo[j] = v; if (v > hi[j]) hi[j] = v; }
  return hi.map((v, j) => v - lo[j]);
}

/** Welded vertices, open and over-shared edges, separate parts, triangles with no area. */
function topology({ positions: p, triangles: t }, size) {
  const eps = Math.max(1e-9, Math.hypot(...size) * 1e-6), ids = new Map(), weld = new Uint32Array(p.length / 3);
  for (let i = 0; i < p.length / 3; i++) {
    const k = `${Math.round(p[i * 3] / eps)},${Math.round(p[i * 3 + 1] / eps)},${Math.round(p[i * 3 + 2] / eps)}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    weld[i] = ids.get(k);
  }
  const parent = Uint32Array.from({ length: ids.size }, (_, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const edges = new Map();
  let degenerate = 0;
  for (let f = 0; f < t.length; f += 3) {
    const v = [weld[t[f]], weld[t[f + 1]], weld[t[f + 2]]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) { degenerate++; continue; }
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      edges.set(k, (edges.get(k) || 0) + 1);
      const ra = root(a), rb = root(b); if (ra !== rb) parent[ra] = rb;
    }
  }
  let open = 0, over = 0;
  for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) over++; }
  const used = new Set();
  for (let f = 0; f < t.length; f++) used.add(root(weld[t[f]]));
  return { vertices: ids.size, open, over, degenerate, parts: used.size };
}

const fmt = v => (Math.round(v * 10) / 10).toString();

async function check(c, file) {
  const m = read(file), problems = [], unproven = [], notes = [];
  const pts = m.step ? m.points : m.positions;
  if (!pts.length) return { ok: false, why: m.step ? 'a STEP file with no points in it' : 'it has no triangles' };
  if (pts.some(v => !Number.isFinite(v))) return { ok: false, why: 'it has coordinates that are not numbers' };
  const size = box(pts), dims = size.map(fmt).join(' × ');
  if (c.maxSize) {
    const fitsAsIs = size.every((v, i) => v <= c.maxSize[i] + 1e-6);
    const s = [...size].sort((a, b) => a - b), mx = [...c.maxSize].sort((a, b) => a - b);
    if (!s.every((v, i) => v <= mx[i] + 1e-6)) problems.push(`it is ${dims}, larger than ${c.maxSize.join(' × ')} however it is turned`);
    else if (!fitsAsIs) notes.push(`it fits ${c.maxSize.join(' × ')} only turned`);
  }
  let facts = `${dims}${m.step ? ' (from the points it lists)' : ''}`;
  if (m.step) {
    facts += `, ${m.solids} solid${m.solids === 1 ? '' : 's'}`;
    if (!m.solids) problems.push('it names no solid (MANIFOLD_SOLID_BREP)');
    if (c.watertight) unproven.push('whether it is closed — a STEP solid is read as points here; check the STL exported from it instead');
    if (c.minParts && m.solids < c.minParts) problems.push(`it has ${m.solids} solid${m.solids === 1 ? '' : 's'}, fewer than ${c.minParts}`);
    if (c.maxParts && m.solids > c.maxParts) problems.push(`it has ${m.solids} solids, more than ${c.maxParts}`);
  } else {
    const tp = topology(m, size), tris = m.triangles.length / 3;
    const closed = !tp.open && !tp.over;
    facts += `, ${tris} triangles, ${tp.parts} part${tp.parts === 1 ? '' : 's'}, ${closed ? 'closed' : `${tp.open} open edge${tp.open === 1 ? '' : 's'}${tp.over ? `, ${tp.over} shared by more than two faces` : ''}`}`;
    if (tp.degenerate) facts += `, ${tp.degenerate} faces with no area`;
    if (c.watertight && !closed) problems.push(`it is not closed: ${tp.open} edge${tp.open === 1 ? '' : 's'} belong to one face only${tp.over ? ` and ${tp.over} to more than two` : ''} — a slicer may fill or drop what is open`);
    if (c.minParts && tp.parts < c.minParts) problems.push(`it is ${tp.parts} part${tp.parts === 1 ? '' : 's'}, fewer than ${c.minParts}`);
    if (c.maxParts && tp.parts > c.maxParts) problems.push(`it is ${tp.parts} separate parts, more than ${c.maxParts} — pieces that do not touch print loose`);
  }
  return verdict({ problems, unproven, facts: `${facts}${notes.length ? `; ${notes.join('; ')}` : ''}` });
}

module.exports = { normalize, check, box, topology };

'use strict';

/**
 * Do the parts of an assembly fit what they hold, and each other? (checks/, plan contract and check_output kind `fit`;
 * round 1, 2026-10-16: a tablet mount judged by its video, its clearances never measured.)
 *   { fit: "<a part>", offset?, rotation?, parts?: ["<part>" | {path, offset?, rotation?}],
 *     held?: {box: [x, y, z], at: [x, y, z], radius?, name?}, clearance?: {min?, max?}, sides?: ["+x", …],
 *     screws?: [{at: [x, y, z], axis: [x, y, z], d, length}], maxInterference?, step?, reach? }
 * Every part placed in the assembly's frame (millimetres; `offset` and `rotation` as in the product video's spec), the
 * held object as a box from its lowest corner `at` — with `radius`, its corners rounded around its thinnest side, as a
 * tablet's or a phone's are (a pocket with filleted corners then fits it). It measures, in mm:
 *   - interference: how much of the held box lies inside a part, and of each part inside another (must be ~0)
 *   - clearance on each side of the box (+x −x +y −y +z −z): the gap to the nearest part along that side's normal,
 *     its smallest and largest over the face, and how much of the face has a part within `reach` (10 mm)
 *   - each screw: along its axis, through every part — a clear hole, thread biting into a pilot (how long), or no hole
 * Tolerance: exact along each measuring line, sampled across every `step` mm (default 0.5; at most 400 000 lines);
 * interference under `maxInterference` mm³ (default 1) is contact, not overlap. Lines that graze an edge are dropped
 * and counted ("unsure"). Meshes are read by checks/mesh-read.js (STL, OBJ, glTF; not STEP — export the STL).
 */
const path = require('path');
const { read } = require('./mesh-read');
const G = require('./fit-geom');
const { verdict } = require('./verdict');
const { topology, box } = require('./mesh');

const SIDES = ['+x', '-x', '+y', '-y', '+z', '-z'];
const vec = v => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(Number(x)));
const f2 = v => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';

function normalize(c, bad) {
  const out = { fit: String(c.fit).slice(0, 500) };
  const pose = (p, who) => {
    const o = {};
    if (p.offset !== undefined) { if (!vec(p.offset)) throw bad(`${who}: offset is [x, y, z] in mm.`); o.offset = p.offset.map(Number); }
    if (p.rotation !== undefined) { if (!vec(p.rotation)) throw bad(`${who}: rotation is [x, y, z] in degrees.`); o.rotation = p.rotation.map(Number); }
    return o;
  };
  Object.assign(out, pose(c, 'fit'));
  if (c.parts !== undefined) {
    if (!Array.isArray(c.parts) || c.parts.length > 20) throw bad('parts is a list of up to 20 files (or {path, offset, rotation}).');
    out.parts = c.parts.map((p, i) => (typeof p === 'string' ? { path: p.slice(0, 500) } : p && typeof p.path === 'string' ? { path: p.path.slice(0, 500), ...pose(p, `parts[${i}]`) } : (() => { throw bad(`parts[${i}] is a file or {path, offset?, rotation?}.`); })()));
  }
  if (c.held !== undefined) {
    const h = c.held;
    if (!h || !vec(h.box) || !h.box.every(v => Number(v) > 0) || !vec(h.at)) throw bad('held is {box: [x, y, z] sizes in mm, at: [x, y, z] its lowest corner in the assembly, name?}.');
    if (h.radius !== undefined && !(Number(h.radius) >= 0 && Number(h.radius) * 2 <= Math.min(...[...h.box].map(Number).sort((a, b) => b - a).slice(0, 2)))) throw bad('held.radius is the corner radius in mm, at most half its width.');
    out.held = { box: h.box.map(Number), at: h.at.map(Number), ...(h.radius ? { radius: Number(h.radius) } : {}), ...(h.name ? { name: String(h.name).slice(0, 60) } : {}) };
  }
  if (c.clearance !== undefined) {
    const cl = c.clearance || {}, o = {};
    for (const k of ['min', 'max']) if (cl[k] !== undefined) { const n = Number(cl[k]); if (!Number.isFinite(n) || n < 0) throw bad(`clearance.${k} is mm, 0 or more.`); o[k] = n; }
    out.clearance = o;
  }
  if (c.sides !== undefined) {
    if (!Array.isArray(c.sides) || !c.sides.every(s => SIDES.includes(s))) throw bad(`sides are some of ${SIDES.join(' ')}.`);
    out.sides = [...new Set(c.sides)];
  }
  if (c.screws !== undefined) {
    if (!Array.isArray(c.screws) || c.screws.length > 40) throw bad('screws is a list of up to 40 {at, axis, d, length}.');
    out.screws = c.screws.map((s, i) => {
      if (!s || !vec(s.at) || !vec(s.axis) || s.axis.every(x => !Number(x)) || !(Number(s.d) > 0) || !(Number(s.length) > 0)) throw bad(`screws[${i}] is {at: [x, y, z] where its head sits, axis: [x, y, z] the way it goes in, d: its diameter, length} in mm.`);
      return { at: s.at.map(Number), axis: s.axis.map(Number), d: Number(s.d), length: Number(s.length), ...(s.name ? { name: String(s.name).slice(0, 40) } : {}) };
    });
  }
  for (const [k, lo, hi] of [['maxInterference', 0, 1e6], ['step', 0.05, 5], ['reach', 0.5, 200]]) if (c[k] !== undefined) {
    const n = Number(c[k]); if (!(n >= lo && n <= hi)) throw bad(`${k} is between ${lo} and ${hi} (mm${k === 'maxInterference' ? '³' : ''}).`); out[k] = n;
  }
  if (!out.parts && !out.held) throw bad('A fit check needs something to fit: parts beside the first, or the held object as a box (held).');
  return out;
}

const AX = { x: 0, y: 1, z: 2 };

/**
 * The held box: its corners, its thinnest axis, and whether a point (the line's own axis left out) is within its
 * outline once its corners are rounded by `radius` around that axis.
 */
function heldShape(h) {
  const box = [h.at, h.at.map((v, k) => v + h.box[k])], t = h.box.indexOf(Math.min(...h.box)), r = h.radius || 0;
  const [m, n] = [0, 1, 2].filter(k => k !== t);
  const within = p => {   // p: [x, y, z], NaN on the axis the line runs along
    if (!r) return true;
    const dm = Number.isNaN(p[m]) ? 0 : Math.max(box[0][m] + r - p[m], p[m] - (box[1][m] - r), 0);
    const dn = Number.isNaN(p[n]) ? 0 : Math.max(box[0][n] + r - p[n], p[n] - (box[1][n] - r), 0);
    return Number.isNaN(p[m]) || Number.isNaN(p[n]) ? dm + dn === 0 : Math.hypot(dm, dn) <= r;
  };
  return { box, t, within };
}
const point = (axis, u, v) => { const p = [NaN, NaN, NaN]; p[(axis + 1) % 3] = u; p[(axis + 2) % 3] = v; return p; };

/** Overlap volume of the inside of `a` with `b` (a part, or the held shape), and how many lines were unsure. */
function shared(a, b, step) {
  const held = b.box && b.within ? b : null, axis = held ? held.t : 2, U = (axis + 1) % 3, V = (axis + 2) % 3;
  const A = G.bounds(a), B = held ? { lo: held.box[0], hi: held.box[1] } : G.bounds(b);
  const lo = A.lo.map((v, k) => Math.max(v, B.lo[k])), hi = A.hi.map((v, k) => Math.min(v, B.hi[k]));
  if (lo.some((v, k) => v >= hi[k])) return { volume: 0, unsure: 0 };
  const ha = G.lines(a, axis, step * 4), hb = held ? null : G.lines(b, axis, step * 4), g = G.grid(lo[U], hi[U], lo[V], hi[V], step);
  let len = 0, unsure = 0;
  for (const [x, y] of g.points) {
    if (held && !held.within(point(axis, x, y))) continue;
    const ia = G.inside(ha(x, y));
    const ib = held ? [[held.box[0][axis], held.box[1][axis]]] : G.inside(hb(x, y));
    if (!ia || !ib) { unsure++; continue; }
    len += G.overlap(ia, ib);
  }
  return { volume: len * g.area, unsure };
}

/** The gap from one face of the box to the parts outside it, along its normal, over the face; negative: a part reaches in. */
function side(all, shape, name, step, reach) {
  const box = shape.box, k = AX[name[1]], sign = name[0] === '+' ? 1 : -1, U = (k + 1) % 3, V = (k + 2) % 3;
  const face = sign > 0 ? box[1][k] : box[0][k], depth = box[1][k] - box[0][k];
  const hits = G.lines(all, k, step * 4), g = G.grid(box[0][U], box[1][U], box[0][V], box[1][V], step);
  const gaps = [];
  let unsure = 0;
  let n = 0;
  for (const [u, v] of g.points) {
    if (!shape.within(point(k, u, v))) continue;   // past a rounded corner: not this face
    n++;
    const iv = G.inside(hits(u, v));
    if (!iv) { unsure++; continue; }
    let best = Infinity;
    for (const [a, b] of iv) {
      // Seen from the face outward: 0 at the face, positive away from the box.
      const [a1, b1] = sign > 0 ? [a - face, b - face] : [face - b, face - a];
      if (b1 <= 1e-9) continue;                                  // inside the box's own span or behind it
      const gap = a1 >= -1e-9 ? Math.max(0, a1) : Math.max(a1, -depth);
      if (gap <= reach && gap < best) best = gap;
    }
    if (best !== Infinity) gaps.push(best);
  }
  return { side: name, min: gaps.length ? Math.min(...gaps) : null, max: gaps.length ? Math.max(...gaps) : null, cover: n ? gaps.length / n : 0, unsure };
}

/** A screw along its axis through each part: a clear hole, thread biting a pilot (how long), no hole, or not this part. */
function screw(s, parts) {
  const L = Math.hypot(...s.axis), d = s.axis.map(v => v / L);
  const t = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]], n1 = Math.hypot(...e1);
  const a = e1.map(v => v / n1), b = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  // Lines just inside the screw's surface (does its thread meet material?) and well outside it (is the part there?).
  const ring = r => Array.from({ length: 8 }, (_, i) => { const w = i * Math.PI / 4 + 0.13; return [0, 1, 2].map(k => s.at[k] + r * (Math.cos(w) * a[k] + Math.sin(w) * b[k])); });
  const thread = ring(s.d / 2 * 0.9), around = ring(s.d * 1.5);
  const along = (tris, o) => { const iv = G.inside(G.ray(tris, o, d)); return iv ? G.overlap(iv, [[0, s.length]]) : null; };
  return parts.map(p => {
    const core = along(p.tris, s.at), rim = thread.map(o => along(p.tris, o)).filter(v => v !== null);
    if (core === null || !rim.length) return { part: p.name, state: 'unsure' };
    if (core > 0.05) return { part: p.name, state: 'blocked', mm: core };
    if (Math.max(...rim) > 0.05) return { part: p.name, state: 'bites', mm: Math.max(...rim) };
    const out = around.map(o => along(p.tris, o)).filter(v => v !== null);
    return { part: p.name, state: out.some(v => v > 0.05) ? 'clear' : 'none' };
  });
}

async function check(c, file, { resolve = p => path.resolve(path.dirname(file), p) } = {}) {
  const step = c.step || 0.5, reach = c.reach || 10, maxI = c.maxInterference ?? 1;
  const list = [{ path: file, offset: c.offset, rotation: c.rotation }, ...(c.parts || []).map(p => (typeof p === 'string' ? { path: p } : p)).map(p => ({ ...p, path: resolve(p.path) }))];
  const parts = list.map(p => {
    if (/\.(step|stp)$/i.test(p.path)) throw new Error(`${path.basename(p.path)} is a STEP file: the fit check reads triangles — give the STL exported from it`);
    const m = read(p.path), tris = G.place(m, p);
    if (!tris.length) throw new Error(`${path.basename(p.path)} has no triangles`);
    return { name: path.basename(p.path), tris, open: topology(m, box(m.positions)).open };
  });
  const problems = [], unproven = [], facts = [];
  // Inside and outside are read from crossings, which only a closed surface has.
  for (const p of parts) if (p.open) unproven.push(`what is inside ${p.name}: it is not closed (${p.open} open edges) — export it as a closed solid`);
  let unsure = 0;
  // Parts in each other.
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const s = shared(parts[i].tris, parts[j].tris, step); unsure += s.unsure;
    if (s.volume > maxI) problems.push(`${parts[i].name} and ${parts[j].name} overlap by ${f2(s.volume)} mm³`);
  }
  if (c.held) {
    const shape = heldShape(c.held), who = c.held.name || `the ${c.held.box.join(' × ')} box`;
    let inter = 0;
    for (const p of parts) {
      const s = shared(p.tris, shape, step); unsure += s.unsure; inter += s.volume;
      if (s.volume > maxI) problems.push(`${p.name} reaches ${f2(s.volume)} mm³ into ${who}`);
    }
    facts.push(`interference with ${who}: ${f2(inter)} mm³`);
    const all = new Float64Array(parts.reduce((n, p) => n + p.tris.length, 0));
    parts.reduce((o, p) => { all.set(p.tris, o); return o + p.tris.length; }, 0);
    const res = SIDES.map(n => side(all, shape, n, step, reach));
    const checked = c.sides || res.filter(r => r.cover >= 0.5).map(r => r.side);
    for (const r of res) {
      unsure += r.unsure;
      facts.push(r.min === null ? `${r.side} open` : `${r.side} ${f2(r.min)}–${f2(r.max)} mm over ${Math.round(r.cover * 100)}%`);
      if (!checked.includes(r.side) || !c.clearance) continue;
      if (r.min === null) { problems.push(`${r.side}: no part within ${reach} mm of ${who}'s side, so it is not held there`); continue; }
      if (c.clearance.min !== undefined && r.min < c.clearance.min - 0.01) problems.push(`${r.side}: ${f2(r.min)} mm at the tightest, under the ${c.clearance.min} mm asked`);
      if (c.clearance.max !== undefined && r.max > c.clearance.max + 0.01) problems.push(`${r.side}: ${f2(r.max)} mm at the loosest, over the ${c.clearance.max} mm asked`);
    }
  }
  (c.screws || []).forEach((s, i) => {
    const name = s.name || `screw ${i + 1}`, said = screw(s, parts), met = said.filter(x => x.state !== 'none');
    for (const x of said) if (x.state === 'blocked') problems.push(`${name}: no hole in ${x.part} — ${f2(x.mm)} mm of material on its axis`);
    if (!met.length) problems.push(`${name} meets no part along its ${s.length} mm — is it placed where its holes are?`);
    facts.push(`${name}: ${met.map(x => `${x.part} ${x.state === 'bites' ? `bites ${f2(x.mm)} mm` : x.state === 'blocked' ? 'blocked' : x.state === 'clear' ? 'clear hole' : 'unsure'}`).join(', ') || 'nothing'}`);
  });
  if (unsure) facts.push(`${unsure} measuring line${unsure === 1 ? '' : 's'} grazed an edge and were left out`);
  facts.push(`sampled every ${step} mm across, exact along each line`);
  return verdict({ problems, unproven, facts: facts.join('; ') });
}

module.exports = { normalize, check, SIDES };

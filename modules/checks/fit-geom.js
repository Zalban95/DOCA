'use strict';

/**
 * The geometry behind the fit check (checks/fit.js), in Node with no dependency: triangles placed in the assembly,
 * lines cast through them, and where a line is inside a solid. A line parallel to an axis crosses a closed mesh an even
 * number of times; between the 1st and 2nd crossing, the 3rd and 4th … it is inside. Exact along the line, so a gap or
 * an overlap is measured to the float, and sampled across it every `step` mm. Each crossing carries which way the
 * surface faces, and inside is where the count of faces entered and not yet left is not zero (a winding number, not
 * parity): two solids touching face to face (a wall standing on a floor, exported as two bodies) read as one, and a
 * mesh whose normals all point inward reads the same. A line that grazes an edge can meet one crossing twice: lines
 * are set a little off the grid's round numbers, crossings of the same way closer than EPS are one, and a line whose
 * count does not come back to zero is dropped and counted as unsure, never guessed.
 */

const EPS = 1e-6, MAX_LINES = 400000;

/** [x, y, z] turned by Euler angles in degrees (X, then Y, then Z — Blender's XYZ, as the product video's spec). */
function rotator(deg = [0, 0, 0]) {
  const [a, b, c] = deg.map(d => (Number(d) || 0) * Math.PI / 180);
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  // R = Rz · Ry · Rx
  const m = [cb * cc, sa * sb * cc - ca * sc, ca * sb * cc + sa * sc,
    cb * sc, sa * sb * sc + ca * cc, ca * sb * sc - sa * cc,
    -sb, sa * cb, ca * cb];
  return p => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
}

/** A read mesh ({positions, triangles}) as a flat list of triangle corners, turned then moved. */
function place(mesh, { offset = [0, 0, 0], rotation = [0, 0, 0] } = {}) {
  const turn = rotator(rotation), p = mesh.positions, t = mesh.triangles, out = new Float64Array(t.length * 3);
  for (let i = 0; i < t.length; i++) {
    const q = turn([p[t[i] * 3], p[t[i] * 3 + 1], p[t[i] * 3 + 2]]);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = q[k] + (Number(offset[k]) || 0);
  }
  return out;
}

function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { const v = tris[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return { lo, hi };
}

/**
 * Lines along `axis` (0 x, 1 y, 2 z): triangles binned by where they lie across it, so a line meets only its cell's.
 * Returns hits(u, v) → the sorted coordinates along the axis where the line at (u, v) crosses the surface.
 */
function lines(tris, axis, cell) {
  const U = (axis + 1) % 3, V = (axis + 2) % 3, n = tris.length / 9, { lo, hi } = bounds(tris);
  const nu = Math.max(1, Math.ceil((hi[U] - lo[U]) / cell) + 1), nv = Math.max(1, Math.ceil((hi[V] - lo[V]) / cell) + 1);
  const bins = new Map();
  for (let f = 0; f < n; f++) {
    const o = f * 9, us = [tris[o + U], tris[o + 3 + U], tris[o + 6 + U]], vs = [tris[o + V], tris[o + 3 + V], tris[o + 6 + V]];
    const i0 = Math.floor((Math.min(...us) - lo[U]) / cell), i1 = Math.floor((Math.max(...us) - lo[U]) / cell);
    const j0 = Math.floor((Math.min(...vs) - lo[V]) / cell), j1 = Math.floor((Math.max(...vs) - lo[V]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * nv + j; let b = bins.get(k); if (!b) bins.set(k, b = []); b.push(f); }
  }
  return function hits(u, v) {
    const i = Math.floor((u - lo[U]) / cell), j = Math.floor((v - lo[V]) / cell);
    if (i < 0 || j < 0 || i >= nu || j >= nv) return [];
    const out = [];
    for (const f of bins.get(i * nv + j) || []) {
      const o = f * 9;
      const ax = tris[o + U], ay = tris[o + V], bx = tris[o + 3 + U], by = tris[o + 3 + V], cx = tris[o + 6 + U], cy = tris[o + 6 + V];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-14) continue;                                   // edge-on to the line
      const l1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / d, l2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-12 || l2 < -1e-12 || l3 < -1e-12) continue;
      // d > 0: the corners run counter-clockwise seen from +axis, so the face looks along +axis (a way out).
      out.push({ w: l1 * tris[o + axis] + l2 * tris[o + 3 + axis] + l3 * tris[o + 6 + axis], s: d > 0 ? 1 : -1 });
    }
    return tidy(out);
  };
}

/** Sorted crossings, one per surface: the same way within EPS is one crossing met twice (an edge, a vertex). */
function tidy(out) {
  out.sort((a, b) => a.w - b.w || b.s - a.s);
  return out.filter((h, k) => !out.slice(Math.max(0, k - 3), k).some(p => p.s === h.s && h.w - p.w <= EPS));
}

/** Crossings as inside intervals [[a, b], …] by winding number, or null when the count does not close (an open mesh). */
function inside(hits) {
  // Crossings at one place are taken together: two solids touching face to face stay one interval.
  const hs = hits;
  let wind = 0, from = null;
  const out = [];
  for (let i = 0; i < hs.length;) {
    let j = i, delta = 0;
    while (j < hs.length && hs[j].w - hs[i].w <= EPS) { delta += hs[j].s; j++; }
    const before = wind; wind -= delta;   // a face looking along the line is a way out
    if (before === 0 && wind !== 0) from = hs[i].w;
    else if (before !== 0 && wind === 0) { out.push([from, hs[j - 1].w]); from = null; }
    i = j;
  }
  return wind === 0 ? out : null;
}

/** Length of the overlap of two interval lists. */
function overlap(a, b) {
  let s = 0;
  for (const [a0, a1] of a) for (const [b0, b1] of b) s += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  return s;
}

/** Sample points across a rectangle [u0, u1] × [v0, v1], a cell's middle each, set off the round numbers a little. */
function grid(u0, u1, v0, v1, step) {
  // At most MAX_LINES lines: a larger face is sampled a little more coarsely.
  const s = Math.max(step, Math.sqrt((u1 - u0) * (v1 - v0) / MAX_LINES));
  const out = [], nu = Math.max(1, Math.round((u1 - u0) / s)), nv = Math.max(1, Math.round((v1 - v0) / s));
  const du = (u1 - u0) / nu, dv = (v1 - v0) / nv;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) out.push([u0 + (i + 0.5) * du + du * 1.3e-4, v0 + (j + 0.5) * dv + dv * 2.7e-4]);
  return { points: out, area: du * dv };
}

/** Crossings of one line through `tris` from `o` along unit `d`, as distances along it (every triangle tried). */
function ray(tris, o, d) {
  const out = [];
  for (let f = 0; f < tris.length; f += 9) {
    const a = [tris[f], tris[f + 1], tris[f + 2]], e1 = [tris[f + 3] - a[0], tris[f + 4] - a[1], tris[f + 5] - a[2]], e2 = [tris[f + 6] - a[0], tris[f + 7] - a[1], tris[f + 8] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-14) continue;
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < -1e-12 || u > 1 + 1e-12) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < -1e-12 || u + v > 1 + 1e-12) continue;
    // The face's normal (e1 × e2) against the line: along it, a way out.
    const nd = (e1[1] * e2[2] - e1[2] * e2[1]) * d[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * d[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * d[2];
    out.push({ w: (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det, s: nd > 0 ? 1 : -1 });
  }
  return tidy(out);
}

module.exports = { rotator, place, bounds, lines, inside, overlap, grid, ray, EPS };

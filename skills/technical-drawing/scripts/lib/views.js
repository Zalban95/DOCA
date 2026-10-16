'use strict';

/**
 * A projected view (project.py's JSON, in model mm) turned into paper entities at its place on the sheet, plus what a
 * drawing adds to it: centre marks and tags on holes, the section's hatched faces, the cutting line, a detail's circle.
 */

const toPaper = (pl, p) => [pl.origin[0] + p[0] * pl.scale, pl.origin[1] + p[1] * pl.scale];
const deg = r => r * 180 / Math.PI;
const ang = (c, p) => { let a = deg(Math.atan2(p[1] - c[1], p[0] - c[0])); if (a < 0) a += 360; return a; };

/** An arc through three points as centre, radius and counter-clockwise start/end angles. */
function arcOf(e) {
  const [p0, pm, p1] = e.p;
  let a0 = ang(e.c, p0), a1 = ang(e.c, p1);
  const am = ang(e.c, pm);
  const ccw = (from, to, x) => ((x - from + 360) % 360) <= ((to - from + 360) % 360);
  if (!ccw(a0, a1, am)) [a0, a1] = [a1, a0];
  return { c: e.c, r: e.r, a0, a1 };
}

/** Points along an edge, for clipping and the SVG fallback. */
function pointsOf(e) {
  if (e.t === 'l') return [e.a, e.b];
  if (e.t === 'p') return e.pts;
  const { c, r, a0, a1 } = e.t === 'c' ? { c: e.c, r: e.r, a0: 0, a1: 360 } : arcOf(e);
  const span = ((a1 - a0 + 360) % 360) || 360, n = Math.max(8, Math.ceil(span / 6));
  return Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + span * i / n) * Math.PI / 180; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
}

/** One edge as a paper entity on `layer`. */
function edgeEntity(e, pl, layer) {
  const s = pl.scale;
  if (e.t === 'l') return { k: 'line', pts: [toPaper(pl, e.a), toPaper(pl, e.b)], layer };
  if (e.t === 'c') return { k: 'circle', c: toPaper(pl, e.c), r: e.r * s, layer };
  if (e.t === 'a') { const a = arcOf(e); return { k: 'arc', c: toPaper(pl, a.c), r: a.r * s, a0: a.a0, a1: a.a1, layer }; }
  return { k: 'line', pts: e.pts.map(p => toPaper(pl, p)), layer };
}

/** The parts of a polyline inside a circle (centre c, radius r), as polylines. */
function clipToCircle(pts, c, r) {
  const out = [];
  let cur = [];
  const inside = p => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 <= r * r;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], d = [b[0] - a[0], b[1] - a[1]], f = [a[0] - c[0], a[1] - c[1]];
    const A = d[0] ** 2 + d[1] ** 2, B = 2 * (f[0] * d[0] + f[1] * d[1]), C = f[0] ** 2 + f[1] ** 2 - r * r;
    const disc = B * B - 4 * A * C;
    if (A < 1e-12 || disc <= 0) { if (inside(a) && inside(b)) { if (!cur.length) cur.push(a); cur.push(b); } continue; }
    const t0 = Math.max(0, (-B - Math.sqrt(disc)) / (2 * A)), t1 = Math.min(1, (-B + Math.sqrt(disc)) / (2 * A));
    if (t0 >= t1) { if (cur.length) { out.push(cur); cur = []; } continue; }
    const P = t => [a[0] + d[0] * t, a[1] + d[1] * t];
    if (!cur.length || t0 > 0) { if (cur.length) out.push(cur); cur = [P(t0)]; }
    cur.push(P(t1));
    if (t1 < 1) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out.filter(l => l.length > 1);
}

/** A point well inside a region (outer loop minus holes), for a hatch to start from: the grid point furthest from any edge. */
function seedOf(outer, holes = []) {
  const loops = [outer, ...holes];
  const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const segDist = (p, a, b) => { const d = [b[0] - a[0], b[1] - a[1]], L = d[0] ** 2 + d[1] ** 2;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]); };
  const xs = outer.map(p => p[0]), ys = outer.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = null, bestD = -1;
  const N = 60;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = [x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N];
    if (!inPoly(p, outer) || holes.some(h => inPoly(p, h))) continue;
    let d = Infinity;
    for (const l of loops) for (let k = 0; k < l.length; k++) d = Math.min(d, segDist(p, l[k], l[(k + 1) % l.length]));
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

/** The entities of one placed view. `opts.hidden` draws hidden edges; `opts.clip` = {c, r} keeps only a detail's circle. */
function viewEntities(view, pl, { hidden = true, clip = null } = {}) {
  const e = [];
  const add = (edges, layer) => {
    for (const ed of edges) {
      if (!clip) { e.push(edgeEntity(ed, pl, layer)); continue; }
      for (const part of clipToCircle(pointsOf(ed), clip.c, clip.r)) e.push({ k: 'line', pts: part.map(p => toPaper(pl, p)), layer });
    }
  };
  // The cut faces first: a hatch finds its boundary among what is drawn when it runs.
  for (const f of view.faces || []) {
    const loops = [f.outer, ...f.holes].map(l => l.map(p => toPaper(pl, p)));
    const seed = seedOf(loops[0], loops.slice(1));
    if (seed) e.push({ k: 'hatch', loops, seed, layer: 'HAT', scale: Math.max(0.5, Math.min(1.5, 0.6 * pl.scale)) });
  }
  add(view.visible || [], 'VIS');
  if (hidden) add(view.hidden || [], 'HID');
  if (!clip) for (const h of view.holes || []) {
    const r = h.d / 2 * pl.scale;
    if (r < 0.6) continue;
    const c = toPaper(pl, h.c), m = r + 1.8;
    e.push({ k: 'line', pts: [[c[0] - m, c[1]], [c[0] + m, c[1]]], layer: 'CEN' }, { k: 'line', pts: [[c[0], c[1] - m], [c[0], c[1] + m]], layer: 'CEN' });
    if (h.tag) e.push({ k: 'text', at: [c[0] + r * 0.75 + 0.6, c[1] + r * 0.75 + 0.6], text: h.tag, h: 2.2, justify: 'BL', layer: 'TAG' });
  }
  return e;
}

/** The cutting line on the front view: chain line, thick ends, arrows looking the way the section is seen, letters. */
function cuttingLine(cut, pl, outline, label) {
  const e = [], ext = 2.5, arrow = 6;
  const vertical = cut.axis !== 'horizontal';
  const at = toPaper(pl, vertical ? [cut.at, 0] : [0, cut.at]);
  const a = vertical ? [at[0], outline[1] - ext] : [outline[0] - ext, at[1]];
  const b = vertical ? [at[0], outline[3] + ext] : [outline[2] + ext, at[1]];
  e.push({ k: 'line', pts: [a, b], layer: 'CEN' });
  const thick = 5;
  for (const [p, dir] of [[a, 1], [b, -1]]) {
    const q = vertical ? [p[0], p[1] + dir * thick] : [p[0] + dir * thick, p[1]];
    e.push({ k: 'line', pts: [p, q], layer: 'CUT' });
    // The viewer stands on the plane's positive side and looks back: arrows point to negative x (or y).
    const tail = vertical ? [p[0] + arrow, p[1]] : [p[0], p[1] + arrow];
    e.push({ k: 'arrow', from: tail, to: p, layer: 'CUT' });
    // The letter beside the arrow's tail, level with it: clear of the dimension rows, which start further out.
    e.push({ k: 'text', at: vertical ? [tail[0] + 1.2, p[1] - 1.75] : [p[0] - 1.75, tail[1] + 1.2], text: label, h: 3.5, justify: 'BL', layer: 'TXT' });
  }
  return e;
}

module.exports = { viewEntities, cuttingLine, toPaper, arcOf, pointsOf, clipToCircle, seedOf, edgeEntity };

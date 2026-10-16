'use strict';

/**
 * Where a small label goes beside the thing it names — a hole's tag (H1, H2 …), a detail's letter — so that no drawn
 * line runs through it. A tag is set outside the outermost feature around its centre (a countersink, a counterbore, a
 * nut trap: a ring of the same centre), then tried in eight directions at growing distances until its box is clear of
 * every line, circle, dimension and word already on the sheet; a tag set further out than its feature gets a short
 * leader. A tag that finds no clear place within REACH is said, not drawn on top of something (round 1, 2026-10-16:
 * a fixed offset of r × 0.75 put H1 on the countersink's circle, and the PDF check fails a line through a word).
 *
 * Paper millimetres throughout. `CHAR` is the width of a character as a share of the text height, measured on the
 * sans fonts the sheet is drawn with (DejaVu, Liberation): wider than a guess of 0.62, which let notes run long.
 */

const CHAR = 0.78, PAD = 0.5, REACH = 16, STEP = 0.8;
// Diagonals first: a hole's centre mark is horizontal and vertical, and the hole's own dimensions run along x and y.
const DIRS = [45, 135, -45, -135, 0, 180, 90, -90].map(a => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)]);

const textWidth = (text, h) => String(text).length * h * CHAR;

/** Points around a circle or an arc (paper), for the segment test. */
function ring(c, r, a0 = 0, a1 = 360) {
  const span = ((a1 - a0 + 360) % 360) || 360, n = Math.max(12, Math.ceil(span / 8));
  return Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + span * i / n) * Math.PI / 180; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
}

/** The box a text entity covers, from its justification. */
function textBox(e) {
  const w = textWidth(e.text, e.h), j = e.justify || 'BL';
  const x = /R$/.test(j) ? e.at[0] - w : /C$/.test(j) ? e.at[0] - w / 2 : e.at[0];
  const y = /^T/.test(j) ? e.at[1] - e.h : /^M/.test(j) ? e.at[1] - e.h / 2 : e.at[1];
  return e.rot ? [e.at[0] - e.h, e.at[1] - w, e.at[0] + e.h, e.at[1] + w] : [x, y, x + w, y + e.h];
}

/** What is already on the sheet, as segments (lines, outlines, dimensions) and boxes (words). */
function obstacles(entities) {
  const segs = [], boxes = [], areas = [];
  const poly = (pts, closed) => { for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]); if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]); };
  for (const e of entities) {
    if (e.k === 'line') poly(e.pts, e.closed);
    else if (e.k === 'circle') poly(ring(e.c, e.r), false);
    else if (e.k === 'arc') poly(ring(e.c, e.r, e.a0, e.a1), false);
    else if (e.k === 'arrow') segs.push([e.from, e.to]);
    else if (e.k === 'text') boxes.push(textBox(e));
    else if (e.k === 'hatch') { for (const l of e.loops) poly(l, true); areas.push(e.loops[0]); }
    else if (e.k === 'dim') {
      const v = e.vertical, a = v ? [e.at[0], e.p1[1]] : [e.p1[0], e.at[1]], b = v ? [e.at[0], e.p2[1]] : [e.p2[0], e.at[1]];
      segs.push([e.p1, a], [e.p2, b], [a, b]);
      const w = textWidth(e.text || e.value, 2.8), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      boxes.push(v ? [m[0] - 3.8, m[1] - w / 2, m[0] + 0.2, m[1] + w / 2] : [m[0] - w / 2, m[1], m[0] + w / 2, m[1] + 3.8]);
    } else if (e.k === 'ddim') {
      segs.push([[2 * e.c[0] - e.point[0], 2 * e.c[1] - e.point[1]], e.point]);
      boxes.push([e.point[0] + 1, e.point[1] + 1, e.point[0] + 1 + textWidth(e.text || e.value, 2.8), e.point[1] + 3.8]);
    }
  }
  return { segs, boxes, areas };
}

/** Does the segment p–q touch the box [x0, y0, x1, y1]? (Liang–Barsky.) */
function segHitsBox([p, q], [x0, y0, x1, y1]) {
  let t0 = 0, t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]];
  for (const [num, den] of [[p[0] - x0, -d[0]], [x1 - p[0], d[0]], [p[1] - y0, -d[1]], [y1 - p[1], d[1]]]) {
    if (den === 0) { if (num < 0) return false; continue; }
    const t = num / den;
    if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

const boxesMeet = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
  const [xi, yi] = poly[i], [xj, yj] = poly[j];
  if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };

function clear(box, obs, within) {
  const b = [box[0] - PAD, box[1] - PAD, box[2] + PAD, box[3] + PAD];
  if (within && !(b[0] >= within[0] && b[1] >= within[1] && b[2] <= within[2] && b[3] <= within[3])) return false;
  if (obs.boxes.some(o => boxesMeet(b, o))) return false;
  const mid = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  if (obs.areas.some(a => inPoly(mid, a))) return false;
  return !obs.segs.some(s => segHitsBox(s, b));
}

/**
 * Place a tag: `c` its feature's centre, `r0` the outermost ring around it (paper mm), `text`, `h`. `within` keeps it
 * inside a box (its view's cell). Returns the entities to draw (the text, and a leader when it sits away from its
 * feature) and adds them to `obs`, so the next tag keeps clear of this one — or null when no clear place was found.
 */
function place({ c, r0, text, h, layer = 'TAG' }, obs, within) {
  const w = textWidth(text, h);
  for (let gap = 0.6; gap <= REACH; gap += STEP) for (const u of DIRS) {
    const t = r0 + gap + Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2;
    const m = [c[0] + u[0] * t, c[1] + u[1] * t], box = [m[0] - w / 2, m[1] - h / 2, m[0] + w / 2, m[1] + h / 2];
    const leader = gap > 3 ? [[c[0] + u[0] * (r0 + 0.4), c[1] + u[1] * (r0 + 0.4)], [m[0] - u[0] * (Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2 + 0.4), m[1] - u[1] * (Math.abs(u[0]) * w / 2 + Math.abs(u[1]) * h / 2 + 0.4)]] : null;
    if (!clear(box, obs, within)) continue;
    // The leader may not cross another word either.
    if (leader && obs.boxes.some(o => segHitsBox(leader, o))) continue;
    const out = [{ k: 'text', at: [box[0], box[1]], text, h, justify: 'BL', layer }];
    obs.boxes.push(box);
    if (leader) { out.push({ k: 'line', pts: leader, layer: 'DIM' }); obs.segs.push(leader); }
    return out;
  }
  return null;
}

/**
 * The radius (model mm) of the outermost feature that shares a hole's centre: circles and arcs on that centre, and
 * a polygon around it (a hex nut trap) — straight edges whose ends sit at one distance from the centre.
 */
function outerRadius(hole, edges = []) {
  const near = (p, q, tol) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
  let r = hole.d / 2;
  const tol = Math.max(0.02, hole.d * 0.01), reach = hole.d * 3;
  for (const e of edges) {
    if ((e.t === 'c' || e.t === 'a') && near(e.c, hole.c, tol) && e.r <= reach) r = Math.max(r, e.r);
    else if (e.t === 'l') {
      const da = Math.hypot(e.a[0] - hole.c[0], e.a[1] - hole.c[1]), db = Math.hypot(e.b[0] - hole.c[0], e.b[1] - hole.c[1]);
      if (da <= reach && Math.abs(da - db) <= Math.max(0.05, da * 0.03) && da > hole.d / 2) r = Math.max(r, da);
    }
  }
  return r;
}

module.exports = { place, obstacles, outerRadius, textBox, textWidth, segHitsBox, CHAR };

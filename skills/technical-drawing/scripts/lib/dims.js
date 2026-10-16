'use strict';

/**
 * Which dimensions each view carries, and how much room they take around it — decided before the layout, so the
 * layout can reserve that room. Rows stack outward from the view: the first at DIM0 from the outline, the next STEP
 * further. All numbers are paper millimetres; positions are the view's own (model mm).
 *
 * What is dimensioned on its own: the front view's overall width and height and the positions of its holes (a chain
 * from the edge, or the pattern's span when a chain would be too tight to read), the side's and the section's depth,
 * the top view's depth when there is no side view. Whatever the person asks for (`dimensions` in the spec) is added
 * on the side it names, on a row of its own.
 */

const DIM0 = 9, STEP = 7, TEXT = 4.5, LABEL = 10, EDGE = 4;

const uniq = (vals, tol = 0.05) => vals.sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > tol);

/** A point given in model coordinates (3 numbers) seen in this view (its basis rows: right, up, toward the viewer). */
function toView(p, basis) {
  if (p.length === 2) return p;
  return [basis[0][0] * p[0] + basis[0][1] * p[1] + basis[0][2] * p[2], basis[1][0] * p[0] + basis[1][1] * p[1] + basis[1][2] * p[2]];
}

/** The side a free-standing dimension goes on: along its longer direction, outside the half it sits in. */
function sideFor(p1, p2, bbox) {
  const horizontal = Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]);
  if (horizontal) return (p1[1] + p2[1]) / 2 > (bbox[1] + bbox[3]) / 2 ? 'top' : 'bottom';
  return (p1[0] + p2[0]) / 2 > (bbox[0] + bbox[2]) / 2 ? 'right' : 'left';
}

/**
 * The dimensions of one view: [{ p1, p2, side, row, text?, chain? }]. A `chain` is a list of points dimensioned
 * one after the other on the same row; the render keeps it whole or reduces it to its span (`span`).
 */
function plan(name, view, { extra = [], hasSide = true } = {}) {
  const [x0, y0, x1, y1] = view.bbox;
  const rows = { top: 0, bottom: 0, left: 0, right: 0 };
  const dims = [];
  const add = (d) => { dims.push({ ...d, row: rows[d.side]++ }); };
  const rel = view.rel || name;
  if (rel === 'front' && !view.cut) {
    add({ p1: [x0, y0], p2: [x1, y0], side: 'bottom' });
    add({ p1: [x0, y0], p2: [x0, y1], side: 'left' });
    const holes = view.holes || [];
    const hx = uniq(holes.map(h => h.c[0])), hy = uniq(holes.map(h => h.c[1]));
    if (hx.length && hx.length <= 8) {
      const yTop = Math.max(...holes.map(h => h.c[1]));
      add({ side: 'top', chain: [[x0, y1], ...hx.map(x => [x, holes.find(h => Math.abs(h.c[0] - x) < 0.06 && h.c[1] === yTop)?.c[1] ?? yTop])], span: [hx[0], hx[hx.length - 1]] });
    }
    if (hy.length && hy.length <= 8) {
      const xRight = Math.max(...holes.map(h => h.c[0]));
      add({ side: 'right', chain: [[x1, y0], ...hy.map(y => [xRight, y])], span: [hy[0], hy[hy.length - 1]] });
    }
  } else if (rel === 'right' || rel === 'left' || view.cut) {
    add({ p1: [x0, y0], p2: [x1, y0], side: 'bottom' });
  } else if ((rel === 'top' || rel === 'bottom') && !hasSide) {
    add({ p1: [x1, y0], p2: [x1, y1], side: 'right' });
  }
  for (const e of extra) {
    const basis = view.basis || [[1, 0, 0], [0, 1, 0]];
    // A diameter sits on its circle, inside the view: it takes no row.
    if (e.kind === 'diameter' || e.d) {
      dims.push({ kind: 'diameter', c: toView(e.center || e.at, basis), d: Number(e.d), angle: Number(e.angle ?? 45), ...(e.text ? { text: String(e.text) } : {}) });
      continue;
    }
    const p1 = toView(e.p1 || e.from, basis), p2 = toView(e.p2 || e.to, basis);
    const side = ['top', 'bottom', 'left', 'right'].includes(e.side) ? e.side : sideFor(p1, p2, view.bbox);
    add({ p1, p2, side, ...(e.text ? { text: String(e.text) } : {}) });
  }
  const room = n => (n ? DIM0 + (n - 1) * STEP + TEXT : EDGE);
  return { dims, margins: { t: room(rows.top), b: room(rows.bottom) + LABEL, l: room(rows.left), r: room(rows.right) } };
}

/** Where a dimension's line sits on paper: `at` for the CAD command, and whether it is drawn vertical. */
function lineAt(d, outline) {
  const off = DIM0 + d.row * STEP;
  if (d.side === 'top') return { y: outline[3] + off, vertical: false };
  if (d.side === 'bottom') return { y: outline[1] - off, vertical: false };
  if (d.side === 'right') return { x: outline[2] + off, vertical: true };
  return { x: outline[0] - off, vertical: true };
}

/** A measurement as a drawing writes it: up to two decimals, no trailing zeros. */
const fmt = v => String(+Math.abs(v).toFixed(2));

/** The hole groups of a view, lettered: same diameter and depth (or through) is one group. */
function holeGroups(holes = []) {
  const groups = [];
  for (const h of holes) {
    const key = `${h.d}|${h.through ? 'T' : h.depth}`;
    let g = groups.find(x => x.key === key);
    if (!g) groups.push(g = { key, d: h.d, through: h.through, depth: h.depth, holes: [] });
    g.holes.push(h);
  }
  return groups.map((g, i) => ({ ...g, tag: `H${i + 1}`, text: `${g.holes.length}× Ø${fmt(g.d)} ${g.through ? 'THRU' : `↧ ${fmt(g.depth)}`}` }));
}

module.exports = { plan, lineAt, fmt, holeGroups, toView, sideFor, DIM0, STEP, TEXT, LABEL, EDGE };

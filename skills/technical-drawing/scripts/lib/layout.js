'use strict';

/**
 * Where each view goes on the sheet, from the part's size alone — the part of a drawing a model gets wrong most
 * (overlapping views, leaders off the sheet). Pure arithmetic: no FreeCAD, no CADCraft.
 *
 * The sheet is a grid. Row 0 holds the front view with the views that share its vertical (the side view, the section);
 * row 1 holds the view that shares its horizontal (the top view) and the free cells (an isometric view, a detail).
 * First-angle (ISO E) puts the top view below the front and the right-side view on its left; third-angle (ASME) the
 * other way round. A view's reserved box is its outline at scale plus the room its dimensions and title take, and
 * rows and columns are sized by their widest box, so two boxes can never meet — `overlaps()` is how the tests check it.
 *
 * Coordinates are paper millimetres, origin at the sheet's lower left, y up. A view's own coordinates (model mm in its
 * 2D frame) reach paper as origin + v × scale.
 */

const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
// ISO 5455 scales, largest first.
const SCALES = [10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500, 1 / 1000];
// A pictorial view is not measured from, so it may use the in-between reductions too.
const PICTORIAL = [10, 5, 4, 3, 2.5, 2, 1.5, 1, 1 / 1.5, 1 / 2, 1 / 2.5, 1 / 3, 1 / 4, 1 / 5, 1 / 7.5, 1 / 10, 1 / 15, 1 / 20, 1 / 25, 1 / 50, 1 / 100, 1 / 200, 1 / 500, 1 / 1000];
const FRAME = { l: 20, r: 10, t: 10, b: 10 };   // ISO 5457: a wider left edge for filing
const GAP = 8;                                    // between reserved boxes and the frame
const MIN_CELL = 45;                              // a free cell smaller than this is not worth an extra view

function sheetSize(name = 'A3', orientation = 'landscape') {
  const s = SHEETS[String(name).toUpperCase()];
  if (!s) throw new Error(`Unknown sheet "${name}": ${Object.keys(SHEETS).join(', ')}.`);
  return orientation === 'portrait' ? [s[1], s[0]] : [s[0], s[1]];
}

const scaleText = s => (s >= 1 ? `${+s.toFixed(3)}:1` : `1:${+(1 / s).toFixed(3)}`);

/** The column and row each named view sits in; which side of the front the others go depends on the projection. */
function grid(names, projection) {
  const first = projection !== 'third';
  const cols = [], rows = first ? ['main', 'below'] : ['above', 'main'];
  if (names.includes('side')) cols.push('side');
  cols.splice(first ? cols.length : 0, 0, 'front');           // first-angle: side | front; third-angle: front | side
  if (names.includes('section')) cols.push('section');
  const second = first ? 'below' : 'above';
  const at = { front: ['front', 'main'], side: ['side', 'main'], section: ['section', 'main'], top: ['front', second] };
  return { cols, rows, at };
}

/**
 * Lay out the orthographic views (front, top, side, section — any present) and offer free cells.
 *   views: { name: { bbox: [x0,y0,x1,y1] (view mm), margins: { t, b, l, r } (paper mm) } }
 *   sheet: [w, h]; band: the height of the title/notes band along the bottom; scale: 'auto' | number
 */
function layout({ views, sheet = sheetSize(), band = 50, scale = 'auto', projection = 'first', frame = FRAME, gap = GAP, pack = false }) {
  const names = Object.keys(views);
  if (!names.includes('front')) throw new Error('A drawing needs a front view.');
  const g = grid(names, projection);
  const area = { x0: frame.l + gap, x1: sheet[0] - frame.r - gap, y0: frame.b + band + gap, y1: sheet[1] - frame.t - gap };

  // A column's width and its offset from the views' x=0, a row's likewise — views in one column share x, in one row y.
  const extent = (s, axis) => {
    const lines = axis === 'x' ? g.cols : g.rows;
    return lines.map(line => {
      let lo = Infinity, hi = -Infinity;
      for (const n of names) {
        if ((axis === 'x' ? g.at[n][0] : g.at[n][1]) !== line) continue;
        const v = views[n], m = v.margins || {};
        const [a, b] = axis === 'x' ? [v.bbox[0], v.bbox[2]] : [v.bbox[1], v.bbox[3]];
        lo = Math.min(lo, a * s - (axis === 'x' ? m.l || 0 : m.b || 0));
        hi = Math.max(hi, b * s + (axis === 'x' ? m.r || 0 : m.t || 0));
      }
      return { line, lo, hi, size: hi > lo ? hi - lo : 0 };
    });
  };
  const fits = s => {
    const xs = extent(s, 'x'), ys = extent(s, 'y');
    const w = xs.reduce((a, c) => a + c.size, 0) + gap * (xs.filter(c => c.size).length - 1);
    const h = ys.reduce((a, c) => a + c.size, 0) + gap * (ys.filter(c => c.size).length - 1);
    return w <= area.x1 - area.x0 && h <= area.y1 - area.y0;
  };
  let s = Number(scale);
  if (!(s > 0)) s = SCALES.find(fits);
  if (!s) throw new Error('The part does not fit this sheet at any standard scale; choose a larger sheet.');
  const fitted = fits(s);

  // Spread what is left evenly: the views look placed, not pushed into a corner.
  const place = (lines, lo, hi, reverse) => {
    const used = lines.filter(c => c.size);
    const spare = Math.max(0, hi - lo - used.reduce((a, c) => a + c.size, 0) - gap * (used.length - 1));
    // Packed (room is wanted for an extra view): views from the top left, the spare space together at the far side.
    const pad = pack ? 0 : spare / (used.length + 1);
    const out = {};
    let at = lo + (pack && reverse ? spare : pad);
    for (const c of reverse ? [...used].reverse() : used) {
      out[c.line] = { from: at, to: at + c.size, offset: at - c.lo };
      at += c.size + gap + pad;
    }
    return out;
  };
  const xs = place(extent(s, 'x'), area.x0, area.x1, false);
  const ys = place(extent(s, 'y'), area.y0, area.y1, true);   // rows run top to bottom, paper y runs up

  const out = { scale: s, scaleText: scaleText(s), fitted, area, views: {}, free: [] };
  for (const n of names) {
    const [c, r] = g.at[n], v = views[n], m = v.margins || {};
    const origin = [xs[c].offset, ys[r].offset];
    out.views[n] = {
      origin, scale: s,
      outline: [origin[0] + v.bbox[0] * s, origin[1] + v.bbox[1] * s, origin[0] + v.bbox[2] * s, origin[1] + v.bbox[3] * s],
      box: [origin[0] + v.bbox[0] * s - (m.l || 0), origin[1] + v.bbox[1] * s - (m.b || 0), origin[0] + v.bbox[2] * s + (m.r || 0), origin[1] + v.bbox[3] * s + (m.t || 0)],
    };
  }

  out.free = freeRects([area.x0, area.y0, area.x1, area.y1], Object.values(out.views).map(v => v.box), gap);
  return out;
}

/**
 * The empty rectangles left on the sheet: every rectangle whose sides lie on the boxes' edges (or the area's) and that
 * no box meets, kept when no larger one contains it. A handful of boxes make a few thousand candidates — instant.
 */
function freeRects(area, boxes, gap = GAP) {
  const grown = boxes.map(b => [b[0] - gap, b[1] - gap, b[2] + gap, b[3] + gap]);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const xs = [...new Set([area[0], area[2], ...grown.flatMap(b => [b[0], b[2]]).map(v => clamp(v, area[0], area[2]))])].sort((a, b) => a - b);
  const ys = [...new Set([area[1], area[3], ...grown.flatMap(b => [b[1], b[3]]).map(v => clamp(v, area[1], area[3]))])].sort((a, b) => a - b);
  const hit = r => grown.some(b => r[0] < b[2] - 1e-6 && b[0] < r[2] - 1e-6 && r[1] < b[3] - 1e-6 && b[1] < r[3] - 1e-6);
  const found = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    if (xs[j] - xs[i] < MIN_CELL) continue;
    for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
      if (ys[l] - ys[k] < MIN_CELL) continue;
      const r = [xs[i], ys[k], xs[j], ys[l]];
      if (!hit(r)) found.push(r);
    }
  }
  const within = (a, b) => a !== b && a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
  return found.filter(r => !found.some(o => within(r, o))).sort((a, b) => area2(b) - area2(a)).map(box => ({ box }));
}

/** Of the free rectangles, the one that holds `bbox` at the largest scale (then the roomiest), placed. */
function bestCell(bbox, free, opts = {}) {
  let best = null;
  for (const f of free) {
    const p = fitInCell(bbox, f.box, opts);
    if (p && (!best || p.scale > best.scale || (p.scale === best.scale && area2(f.box) > area2(best.cell)))) best = { ...p, cell: f.box };
  }
  return best;
}

const area2 = b => (b[2] - b[0]) * (b[3] - b[1]);

/**
 * A view placed alone in a free cell (the isometric view, a detail): the largest standard scale up to `max` at which
 * its outline plus margins fits, centred. Null when it does not fit at `min` or above.
 */
function fitInCell(bbox, cell, { margins = {}, max = 1, min = 0, pictorial = false } = {}) {
  const w = cell[2] - cell[0] - (margins.l || 0) - (margins.r || 0), h = cell[3] - cell[1] - (margins.t || 0) - (margins.b || 0);
  const bw = bbox[2] - bbox[0], bh = bbox[3] - bbox[1];
  const s = (pictorial ? PICTORIAL : SCALES).find(k => k <= max + 1e-9 && k >= min - 1e-9 && bw * k <= w && bh * k <= h);
  if (!s) return null;
  const cx = (cell[0] + (margins.l || 0) + cell[2] - (margins.r || 0)) / 2, cy = (cell[1] + (margins.b || 0) + cell[3] - (margins.t || 0)) / 2;
  const origin = [cx - (bbox[0] + bbox[2]) / 2 * s, cy - (bbox[1] + bbox[3]) / 2 * s];
  return { origin, scale: s, scaleText: scaleText(s),
    outline: [origin[0] + bbox[0] * s, origin[1] + bbox[1] * s, origin[0] + bbox[2] * s, origin[1] + bbox[3] * s],
    box: [origin[0] + bbox[0] * s - (margins.l || 0), origin[1] + bbox[1] * s - (margins.b || 0), origin[0] + bbox[2] * s + (margins.r || 0), origin[1] + bbox[3] * s + (margins.t || 0)] };
}

/** Pairs of boxes that meet (touching edges do not count). */
function overlaps(boxes) {
  const out = [];
  const list = Object.entries(boxes);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [a, A] = list[i], [b, B] = list[j];
    if (A[0] < B[2] - 1e-6 && B[0] < A[2] - 1e-6 && A[1] < B[3] - 1e-6 && B[1] < A[3] - 1e-6) out.push([a, b]);
  }
  return out;
}

const inside = (box, area) => box[0] >= area[0] - 1e-6 && box[1] >= area[1] - 1e-6 && box[2] <= area[2] + 1e-6 && box[3] <= area[3] + 1e-6;

module.exports = { layout, fitInCell, freeRects, bestCell, overlaps, inside, sheetSize, scaleText, SHEETS, SCALES, PICTORIAL, FRAME, GAP };

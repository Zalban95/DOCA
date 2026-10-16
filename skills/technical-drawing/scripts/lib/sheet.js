'use strict';

/**
 * The sheet around the views: the frame, the title block (ISO 7200's fields), the notes block with the hole table,
 * and the projection symbol. Entities in paper millimetres (see render-*.js for what an entity is).
 */

const { CHAR } = require('./tags');

const TITLE_W = 180, TITLE_H = 44, ROW = 11, MIN_H = 1.8;

/** Lines of at most `chars` characters, broken at spaces — and a word longer than a line broken inside it. */
function wrap(text, chars) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (let w of para.split(/\s+/).filter(Boolean)) {
      while (w.length > chars) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, chars - 1) + '-'); w = w.slice(chars - 1); }
      if (line && (line + ' ' + w).length > chars) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    }
    out.push(line);
  }
  return out;
}

/**
 * A title block value in a cell `width` mm wide: at its height when it fits, smaller down to MIN_H, else cut with "…".
 * `cut` says it was cut, so the report can name the field (round 1: a long project name ran into the next cell).
 */
function fit(value, width, h) {
  const s = String(value), room = width - 3;
  if (s.length * h * CHAR <= room) return { text: s, h };
  const smaller = room / (s.length * CHAR);
  if (smaller >= MIN_H) return { text: s, h: +smaller.toFixed(2) };
  const n = Math.max(1, Math.floor(room / (MIN_H * CHAR)) - 1);
  return { text: s.slice(0, n).trimEnd() + '…', h: MIN_H, cut: true };
}

const rect = (x0, y0, x1, y1, layer) => ({ k: 'line', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true, layer });
const seg = (a, b, layer) => ({ k: 'line', pts: [a, b], layer });
const text = (at, s, h, justify = 'BL', layer = 'TXT') => ({ k: 'text', at, text: String(s), h, justify, layer });

/** ISO 128 projection symbol: a truncated cone and its end view; the end view's side says first or third angle. */
function projectionSymbol(cx, cy, projection) {
  const e = [];
  const r1 = 2.2, r2 = 4.4, len = 8, gap = 4.5;
  const circlesX = projection === 'third' ? cx - (len + gap) / 2 : cx + (len + gap) / 2;
  const coneX = projection === 'third' ? cx + gap / 2 : cx - (len + gap / 2) - 0;
  e.push({ k: 'circle', c: [circlesX, cy], r: r1, layer: 'VIS' }, { k: 'circle', c: [circlesX, cy], r: r2, layer: 'VIS' });
  const x0 = projection === 'third' ? coneX : cx - gap / 2 - len, x1 = x0 + len;
  e.push({ k: 'line', pts: [[x0, cy - r1], [x1, cy - r2], [x1, cy + r2], [x0, cy + r1]], closed: true, layer: 'VIS' });
  e.push(seg([x0 - 1.5, cy], [x1 + 1.5, cy], 'CEN'), seg([circlesX - r2 - 1.5, cy], [circlesX + r2 + 1.5, cy], 'CEN'), seg([circlesX, cy - r2 - 1.5], [circlesX, cy + r2 + 1.5], 'CEN'));
  return e;
}

/**
 * The title block, its lower right corner at (x1, y0). Fields: project, title (the part), material, finish or
 * general tolerance, scale, drawn, date, number, revision, sheet, and the projection.
 */
function titleBlock(x1, y0, t, { scaleText, projection, units = 'mm' }) {
  const x0 = x1 - TITLE_W, e = [rect(x0, y0, x1, y0 + TITLE_H, 'FRAME')], cut = [];
  const lab = (x, y, s) => text([x + 1.5, y + ROW - 3.2], s.toUpperCase(), 1.8, 'BL', 'TXT');
  // Each value fits its own cell: the cell's width is up to the next column line.
  const val = (x, y, s, h = 3.2, w = 40, name = '') => {
    const f = fit(s || '—', w, h);
    if (f.cut) cut.push(name);
    return text([x + 1.5, y + 2.2], f.text, f.h, 'BL', 'TXT');
  };
  // Row lines.
  for (let i = 1; i < 4; i++) e.push(seg([x0, y0 + i * ROW], [i >= 2 ? x1 - 40 : x1, y0 + i * ROW], 'DIM'));
  // Columns: rows 0-1 are split into fields; rows 2-3 hold the title; the right 40 mm of rows 2-3 is the projection.
  e.push(seg([x1 - 40, y0], [x1 - 40, y0 + TITLE_H], 'DIM'));
  const r0 = [[x0, 'drawn', t.drawn], [x0 + 45, 'date', t.date], [x0 + 80, 'number', t.number], [x0 + 118, 'rev', t.revision]];
  const r1 = [[x0, 'material', t.material], [x0 + 70, t.finish ? 'finish' : 'tolerance', t.finish || t.tolerance]];
  const cells = (row, y) => row.forEach(([x, l, v], i) => {
    if (x > x0) e.push(seg([x, y], [x, y + ROW], 'DIM'));
    e.push(lab(x, y, l), val(x, y, v, 2.8, (row[i + 1] ? row[i + 1][0] : x1 - 40) - x, l));
  });
  cells(r0, y0);
  cells(r1, y0 + ROW);
  e.push(lab(x1 - 40, y0, 'sheet'), val(x1 - 40, y0, t.sheet || '1 / 1', 2.8, 40, 'sheet'));
  e.push(lab(x1 - 40, y0 + ROW, `scale · ${units}`), val(x1 - 40, y0 + ROW, scaleText, 2.8, 40, 'scale'));
  e.push(lab(x0, y0 + 3 * ROW, 'project'), val(x0, y0 + 3 * ROW, t.project, 3.2, TITLE_W - 40, 'project'));
  const name = fit(String(t.part || 'Part').toUpperCase(), TITLE_W - 40, 4.2);
  if (name.cut) cut.push('part');
  e.push(lab(x0, y0 + 2 * ROW, 'title'), text([x0 + 1.5, y0 + 2 * ROW + 2], name.text, name.h, 'BL', 'TXT'));
  e.push(seg([x1 - 40, y0 + 2 * ROW], [x1, y0 + 2 * ROW], 'DIM'));
  e.push(text([x1 - 38.5, y0 + 4 * ROW - 3.2], `${projection === 'third' ? 'THIRD' : 'FIRST'} ANGLE`, 1.8, 'BL', 'TXT'));
  e.push(...projectionSymbol(x1 - 20, y0 + 2 * ROW + 8, projection));
  return { entities: e, box: [x0, y0, x1, y0 + TITLE_H], cut };
}

/**
 * The notes block beside the title block: numbered notes, then the holes by tag. Returns its height too, so the
 * band along the bottom is tall enough for whichever of the two is taller.
 */
function notesBlock(x0, y0, width, { notes = [], holes = [], tolerance }) {
  const h = 2.6, lh = 4.3, chars = Math.max(20, Math.floor(width / (h * CHAR)));
  const lines = [];
  const all = [...notes];
  if (tolerance) all.push(`Unless stated: dimensions in mm, general tolerances ${tolerance}.`);
  all.forEach((n, i) => wrap(n, chars - 4).forEach((l, j) => lines.push([j ? '    ' + l : `${i + 1}.  ${l}`, h])));
  if (holes.length) {
    lines.push(['', h]);
    lines.push(['HOLES', 2.4]);
    for (const g of holes) wrap(g.tag ? `${g.tag}    ${g.text}` : g.text, chars).forEach(l => lines.push([l, h]));
  }
  const height = lines.length ? 8 + lines.length * lh : 0;
  const e = [];
  if (lines.length) {
    e.push(text([x0, y0 + height - 3.5], 'NOTES', 2.4));
    lines.forEach(([l, hh], i) => { if (l) e.push(text([x0, y0 + height - 8 - (i + 1) * lh + 1], l, hh)); });
  }
  return { entities: e, height, box: [x0, y0, x0 + width, y0 + height] };
}

module.exports = { titleBlock, notesBlock, projectionSymbol, wrap, fit, rect, seg, text, TITLE_W, TITLE_H };

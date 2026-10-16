'use strict';

/**
 * One sheet from a spec and the projected views: the layout, every entity in paper millimetres, the dimension styles
 * by scale, and a report of what was placed and what was left out. No tool is run here — drawing.js runs FreeCAD
 * before and CADCraft after — so the tests compose sheets from made-up views.
 */

const L = require('./layout');
const D = require('./dims');
const S = require('./sheet');
const V = require('./views');
const T = require('./tags');

const ORTHO = ['front', 'top', 'side', 'section'];
const LABELS = { front: 'FRONT VIEW', top: 'TOP VIEW', side: 'SIDE VIEW', section: 'SECTION' };

const boxOf = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];

function entityBox(e) {
  if (e.k === 'line') return boxOf(e.pts);
  if (e.k === 'circle' || e.k === 'arc') return [e.c[0] - e.r, e.c[1] - e.r, e.c[0] + e.r, e.c[1] + e.r];
  if (e.k === 'text') return T.textBox(e);
  if (e.k === 'arrow') return boxOf([e.from, e.to]);
  if (e.k === 'hatch') return boxOf(e.loops.flat());
  if (e.k === 'dim') return boxOf([e.p1, e.p2, e.at]);
  if (e.k === 'ddim') return [e.c[0] - e.r, e.c[1] - e.r, e.c[0] + e.r, e.c[1] + e.r];
  return null;
}

/** Dimensions of one placed view as entities. */
function dimEntities(planned, pl, style) {
  const out = [];
  const P = p => V.toPaper(pl, p);
  for (const d of planned) {
    if (d.kind === 'diameter') {
      const c = P(d.c), r = d.d / 2 * pl.scale, a = d.angle * Math.PI / 180;
      out.push({ k: 'ddim', c, r, point: [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], style, value: `Ø${D.fmt(d.d)}`, ...(d.text ? { text: d.text } : {}), layer: 'DIM' });
      continue;
    }
    const at = D.lineAt(d, pl.outline);
    const one = (a, b, text) => {
      const pa = P(a), pb = P(b);
      const vertical = at.vertical;
      const value = D.fmt(vertical ? b[1] - a[1] : b[0] - a[0]);
      if (value === '0') return;
      out.push({ k: 'dim', p1: pa, p2: pb, at: vertical ? [at.x, (pa[1] + pb[1]) / 2] : [(pa[0] + pb[0]) / 2, at.y], vertical, style, value, ...(text ? { text } : {}), layer: 'DIM' });
    };
    if (!d.chain) { one(d.p1, d.p2, d.text); continue; }
    const axis = at.vertical ? 1 : 0;
    const pts = d.chain;
    const tight = pts.slice(1).some((p, i) => Math.abs(p[axis] - pts[i][axis]) * pl.scale < 9);
    if (!tight) for (let i = 1; i < pts.length; i++) one(pts[i - 1], pts[i]);
    else if (pts.length > 2) one(pts[1], pts[pts.length - 1]);
    else one(pts[0], pts[1]);
  }
  return out;
}

function label(pl, text) {
  return { k: 'text', at: [(pl.outline[0] + pl.outline[2]) / 2, pl.box[1] + 2.5], text, h: 3.2, justify: 'BC', layer: 'TXT' };
}

/**
 * spec: { sheet, orientation, projection, scale, hidden ('front' | 'all' | 'none'), title {…}, notes [], tolerance,
 *         dimensions [{view, p1, p2, side?, text?}], detail {at, radius, scale?, label?}, section {label?} }
 * proj: project.py's output. sheetNo / sheets: this sheet's number and the count.
 */
function compose(spec, proj, { sheetNo = 1, sheets = 1, date = new Date().toISOString().slice(0, 10) } = {}) {
  const sheet = L.sheetSize(spec.sheet || 'A3', spec.orientation || 'landscape');
  const projection = spec.projection === 'third' ? 'third' : 'first';
  const hidden = spec.hidden || 'front';
  const report = { sheet: `${spec.sheet || 'A3'} ${spec.orientation || 'landscape'}`, views: [], left_out: [], warnings: [] };
  const views = proj.views;
  const front = views.front;
  if (!front) throw new Error('The projection has no front view.');

  // Holes: lettered groups, the letters drawn beside each hole of the front view (`hole_tags: false` leaves the
  // letters off the views; the notes still list the holes by size).
  const tagHoles = spec.hole_tags !== false;
  const groups = D.holeGroups(front.holes || []).map(g => (tagHoles ? g : { ...g, tag: '' }));
  for (const g of groups) for (const h of g.holes) h.tag = g.tag;
  const tags = [];

  const names = ORTHO.filter(n => views[n]);
  const planned = {}, layoutViews = {};
  for (const n of names) {
    const extra = (spec.dimensions || []).filter(d => (d.view || 'front') === n);
    planned[n] = D.plan(n, views[n], { extra, hasSide: !!views.side });
    layoutViews[n] = { bbox: views[n].bbox, margins: planned[n].margins };
  }

  // The bottom band: the title block on the right, the notes and holes on its left.
  const frame = L.FRAME, inner = [frame.l, frame.b, sheet[0] - frame.r, sheet[1] - frame.t];
  const notesW = inner[2] - inner[0] - S.TITLE_W - 2 * L.GAP;
  const t = { date, sheet: `${sheetNo} / ${sheets}`, tolerance: spec.tolerance ?? 'ISO 2768-m', ...(spec.title || {}) };
  const notes = S.notesBlock(inner[0] + L.GAP, inner[1] + 4, notesW, { notes: spec.notes || [], holes: groups, tolerance: spec.tolerance ?? 'ISO 2768-m' });
  const band = Math.max(S.TITLE_H, notes.height + 4);
  const wantsMore = !!(views.iso || spec.detail);
  let lay = L.layout({ views: layoutViews, sheet, band, scale: spec.scale || 'auto', projection, pack: wantsMore });
  // The top view of a part the side view already shows in depth often costs a whole scale step for a thin strip:
  // when leaving it out lets the sheet go one scale larger, it is left out (asked for by name, it stays).
  if (!spec.scale && layoutViews.top && layoutViews.side && !(spec.views || []).includes('top')) {
    const { top, ...rest } = layoutViews;
    const without = L.layout({ views: rest, sheet, band, projection, pack: wantsMore });
    if (without.scale > lay.scale) {
      lay = without; delete layoutViews.top;
      names.splice(names.indexOf('top'), 1);
      report.left_out.push(`top: left out so the views fit at ${without.scaleText} — the side view shows the same depth`);
      void top;
    }
  }
  if (!lay.fitted) report.warnings.push(`At ${lay.scaleText} the views do not fit the sheet; choose a larger sheet or leave the scale to the template.`);

  const entities = [];
  const styles = { DIM_MAIN: lay.scale };
  const placed = { ...lay.views };
  for (const n of names) {
    const pl = lay.views[n], v = views[n];
    entities.push(...V.viewEntities(v, pl, { hidden: hidden === 'all' || (hidden === 'front' && n === 'front') }));
    entities.push(...dimEntities(planned[n].dims, pl, 'DIM_MAIN'));
    if (n === 'front') tags.push(...V.holeTags(v, pl).map(t => ({ ...t, within: pl.box })));
    const cutLabel = (spec.section && spec.section.label) || 'A';
    entities.push(label(pl, n === 'section' ? `SECTION ${cutLabel}–${cutLabel}` : LABELS[n]));
    if (n === 'section' && v.cut) entities.push(...V.cuttingLine(v.cut, lay.views.front, lay.views.front.outline, cutLabel));
    report.views.push(n);
  }

  // The free cells: a detail first (it is measured from, so it must be legible), then the isometric view.
  let free = lay.free;
  const boxes = () => Object.values(placed).map(p => p.box);
  if (spec.detail) {
    const dt = spec.detail, c = D.toView(dt.at || dt.center, front.basis), r = Number(dt.radius) || 10, tag = dt.label || 'B';
    const bbox = [c[0] - r, c[1] - r, c[0] + r, c[1] + r];
    const max = Number(dt.scale) || lay.scale * 5;
    const dplan = D.plan('detail', { rel: 'detail', bbox, basis: front.basis }, { extra: (spec.dimensions || []).filter(d => d.view === 'detail') });
    const pl = L.bestCell(bbox, free, { margins: dplan.margins, max, min: lay.scale * 1.5 });
    if (pl) {
      placed.detail = pl;
      styles.DIM_DETAIL = pl.scale;
      entities.push(...V.viewEntities(front, pl, { hidden: false, clip: { c, r } }));
      entities.push({ k: 'circle', c: V.toPaper(pl, c), r: r * pl.scale, layer: 'DIM' });
      const fc = V.toPaper(lay.views.front, c);
      entities.push({ k: 'circle', c: fc, r: r * lay.scale, layer: 'DIM' });
      tags.push({ c: fc, r0: r * lay.scale, text: tag, h: 3.5, layer: 'TXT', within: lay.views.front.box, detail: true });
      entities.push(...dimEntities(dplan.dims, pl, 'DIM_DETAIL'));
      entities.push(label(pl, `DETAIL ${tag} (${pl.scaleText})`));
      report.views.push('detail');
      free = L.freeRects([lay.area.x0, lay.area.y0, lay.area.x1, lay.area.y1], boxes());
    } else report.left_out.push(`detail ${tag}: no free cell holds it at ${L.scaleText(lay.scale * 1.5)} or more`);
  }

  if (views.iso) {
    const pl = L.bestCell(views.iso.bbox, free, { margins: { t: 3, b: D.LABEL, l: 3, r: 3 }, max: lay.scale, pictorial: true });
    if (pl) {
      placed.iso = pl;
      entities.push(...V.viewEntities(views.iso, pl, { hidden: false }));
      entities.push(label(pl, pl.scale === lay.scale ? 'ISOMETRIC VIEW' : `ISOMETRIC VIEW (${pl.scaleText})`));
      report.views.push('iso');
      free = L.freeRects([lay.area.x0, lay.area.y0, lay.area.x1, lay.area.y1], boxes());
    } else report.left_out.push('iso: no free cell large enough at or below the sheet scale');
  }
  // The tags last, each clear of everything drawn so far — the detail's letter first, as it names a whole circle.
  const obs = T.obstacles(entities);
  for (const t of tags.sort((a, b) => (b.detail ? 1 : 0) - (a.detail ? 1 : 0))) {
    const got = T.place(t, obs, t.within);
    if (got) { entities.push(...got); continue; }
    const where = `${Math.round(t.c[0])},${Math.round(t.c[1])} mm from the sheet's lower left`;
    if (t.detail) report.left_out.push(`the letter of detail ${t.text} on the front view (at ${where}): no place clear of the line work beside its circle`);
    else report.left_out.push(`tag ${t.text} at ${where}: no place clear of the line work within ${16} mm of its hole — the hole table still lists it; set "hole_tags": false to leave every tag off`);
  }

  // The sheet itself: frame, centring marks (ISO 5457), title block, notes.
  entities.push(S.rect(...inner, 'FRAME'));
  const mx = sheet[0] / 2, my = sheet[1] / 2;
  entities.push(S.seg([mx, 5], [mx, inner[1]], 'FRAME'), S.seg([mx, sheet[1] - 5], [mx, inner[3]], 'FRAME'),
    S.seg([5, my], [inner[0], my], 'FRAME'), S.seg([sheet[0] - 5, my], [inner[2], my], 'FRAME'));
  const tb = S.titleBlock(inner[2], inner[1], t, { scaleText: lay.scaleText, projection, units: spec.units || 'mm' });
  entities.push(...tb.entities, ...notes.entities);
  if (tb.cut.length) report.warnings.push(`title block: ${tb.cut.join(', ')} too long for its cell even in small text, cut with "…" — shorten it, or put the rest in "notes"`);

  // The checks a drawing is judged by: nothing off the sheet, no two parts of it on top of each other.
  const all = { ...Object.fromEntries(Object.entries(placed).map(([k, p]) => [k, p.box])), title: tb.box, notes: notes.box };
  for (const [a, b] of L.overlaps(all)) report.warnings.push(`${a} and ${b} overlap`);
  const off = entities.filter(e => { const b = entityBox(e); return b && !L.inside(b, [inner[0] - 0.01, inner[1] - 0.01, inner[2] + 0.01, inner[3] + 0.01]) && e.layer !== 'FRAME'; });
  if (off.length) report.warnings.push(`${off.length} item(s) reach outside the frame`);
  report.scale = lay.scaleText;
  return { entities, styles, sheet, report, placed, boxes: all, inner };
}

module.exports = { compose, entityBox, dimEntities };

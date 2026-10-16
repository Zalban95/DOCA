'use strict';

/**
 * Paper entities → a CADCraft script (one `command {json}` per line), run headless by `cadcraft-cli run`, which saves
 * the DXF and exports the PDF itself. Dimensions are real dimension objects: the sheet is drawn at paper size and each
 * view's dimension style scales what it measures back to the part (DIMLFAC = 1 / the view's scale).
 *
 * Entities: line {pts, closed?}, circle {c, r}, arc {c, r, a0, a1}, text {at, text, h, justify}, arrow {from, to},
 * hatch {loops, seed, scale}, dim {p1, p2, at, vertical, style, text?}. Each has a layer.
 */

const LAYERS = [
  // name, lineweight (mm), linetype
  ['FRAME', 0.7, null], ['VIS', 0.5, null], ['HID', 0.25, 'HIDDEN2'], ['CEN', 0.18, 'CENTER2'], ['CUT', 0.7, null],
  ['DIM', 0.18, null], ['TXT', 0.25, null], ['TAG', 0.25, null], ['HAT', 0.13, null],
];

const r4 = v => Math.round(v * 1e4) / 1e4;
const P = p => [r4(p[0]), r4(p[1])];
const line = (id, args) => `${id} ${JSON.stringify(args)}`;

function dimStyle(name, scale, font) {
  return line('dimstyle', { name, DIMLFAC: r4(1 / scale), DIMTXT: 2.8, DIMASZ: 2.6, DIMEXO: 1.2, DIMEXE: 1.6, DIMGAP: 0.9,
    DIMDLI: 7, DIMTAD: 1, DIMTIH: 0, DIMTOH: 0, DIMDEC: 2, DIMZIN: 8, DIMDSEP: '.', DIMCLRD: 7, DIMCLRE: 7, DIMCLRT: 7,
    ...(font ? { DIMTXSTY: 'SHEET' } : {}), current: false });
}

/** The script for the whole sheet, ending with the PDF export (A-size, 1:1, from the sheet's lower left). */
function script(entities, { sheet, paper, landscape = true, pdf, font, styles }) {
  const out = [line('linetype', { load: '*' }), line('setvar', { name: 'LTSCALE', value: 1 }), line('setvar', { name: 'PSLTSCALE', value: 0 })];
  for (const [name, lw, lt] of LAYERS) out.push(line('layer.new', { name, color: '7', lineweight: lw, ...(lt ? { linetype: lt } : {}) }));
  if (font) out.push(line('style', { name: 'SHEET', font, current: true }));
  for (const [name, scale] of Object.entries(styles)) out.push(dimStyle(name, scale, font));
  let layer = null, style = null;
  const on = l => { if (l !== layer) { out.push(line('layer.current', { name: l })); layer = l; } };
  // Hatches before anything else: each finds its boundary among what is drawn so far, which is then only its loops.
  const hatches = entities.filter(e => e.k === 'hatch');
  if (hatches.length) {
    on('VIS');
    for (const h of hatches) for (const l of h.loops) out.push(line('line', { points: l.map(P), closed: true }));
    on(hatches[0].layer);
    // One hatch for every region, so no hatch's own lines become another's boundary.
    out.push(line('hatch', { points: hatches.map(h => P(h.seed)), pattern: 'ANSI31', scale: r4(hatches[0].scale || 1), style: 'normal' }));
  }
  for (const e of entities) {
    if (e.k === 'hatch') continue;
    on(e.layer);
    if (e.k === 'line') out.push(line('line', { points: e.pts.map(P), ...(e.closed ? { closed: true } : {}) }));
    else if (e.k === 'circle') out.push(line('circle', { center: P(e.c), radius: r4(e.r) }));
    else if (e.k === 'arc') out.push(line('arc', { center: P(e.c), radius: r4(e.r), start: r4(e.a0), end: r4(e.a1) }));
    else if (e.k === 'text') out.push(line('text', { at: P(e.at), text: e.text, height: e.h, justify: e.justify || 'BL', ...(e.rot ? { rotation: e.rot } : {}) }));
    else if (e.k === 'arrow') {
      const L = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]), head = Math.min(3.2, L * 0.6);
      const u = [(e.to[0] - e.from[0]) / L, (e.to[1] - e.from[1]) / L], base = [e.to[0] - u[0] * head, e.to[1] - u[1] * head];
      out.push(line('line', { points: [P(e.from), P(base)] }));
      out.push(line('pline', { vertices: [{ p: P(base), startWidth: 1.3, endWidth: 0 }, { p: P(e.to) }] }));
    } else if (e.k === 'ddim') {
      if (e.style !== style) { out.push(line('dimstyle.current', { name: e.style })); style = e.style; }
      out.push(line('dimdiameter', { center: P(e.c), point: P(e.point) }));
    } else if (e.k === 'dim') {
      if (e.style !== style) { out.push(line('dimstyle.current', { name: e.style })); style = e.style; }
      out.push(line('dimlinear', { p1: P(e.p1), p2: P(e.p2), at: P(e.at), rotation: e.vertical ? 90 : 0, ...(e.text ? { text: e.text } : {}) }));
    }
  }
  out.push(line('exportpdf', { path: pdf, layout: 'Model', paper, landscape, scale: 1, center: false, offset: [0, 0], lineweights: true }));
  void sheet;
  return out.join('\n') + '\n';
}

module.exports = { script, LAYERS };

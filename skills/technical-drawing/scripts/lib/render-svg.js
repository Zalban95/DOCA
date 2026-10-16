'use strict';

/**
 * The same paper entities as an SVG sheet — the fallback when CADCraft is not installed, and a quick preview. Lines,
 * text and hatching look as in the CAD sheet; dimensions are drawn (extension lines, arrows, the value) rather than
 * being dimension objects, so a CAD program reading the SVG sees lines, not dimensions.
 */

const LW = { FRAME: 0.7, VIS: 0.5, HID: 0.25, CEN: 0.18, CUT: 0.7, DIM: 0.18, TXT: 0.25, TAG: 0.25, HAT: 0.13 };
const DASH = { HID: '3 1.5', CEN: '8 1.5 1.5 1.5' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = v => +v.toFixed(3);

function svg(entities, { sheet, font = 'DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif' }) {
  const [W, H] = sheet;
  const Y = y => n(H - y);
  const stroke = l => `stroke="#000" stroke-width="${LW[l] || 0.25}" fill="none"${DASH[l] ? ` stroke-dasharray="${DASH[l]}"` : ''}`;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`,
    '<defs><pattern id="hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<line x1="0" y1="0" x2="0" y2="3" stroke="#000" stroke-width="0.15"/></pattern></defs>',
    `<rect width="${W}" height="${H}" fill="#fff"/>`];
  const anchor = j => (/R$/.test(j) ? 'end' : /C$|M$/.test(j) ? 'middle' : 'start');
  const base = j => (/^T/.test(j) ? 'hanging' : /^M/.test(j) ? 'middle' : 'alphabetic');
  const textAt = (p, t, h, j = 'BL', rot = 0) => `<text x="${n(p[0])}" y="${Y(p[1])}" font-family="${font}" font-size="${n(h * 1.4)}" text-anchor="${anchor(j)}" dominant-baseline="${base(j)}"${rot ? ` transform="rotate(${-rot} ${n(p[0])} ${Y(p[1])})"` : ''}>${esc(t).replace(/ {2,}/g, m => '\u00a0'.repeat(m.length))}</text>`;
  const head = (tip, from, size = 2.6) => {
    const L = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1, u = [(tip[0] - from[0]) / L, (tip[1] - from[1]) / L];
    const b = [tip[0] - u[0] * size, tip[1] - u[1] * size], w = size * 0.18;
    return `<path d="M${n(tip[0])} ${Y(tip[1])} L${n(b[0] - u[1] * w)} ${Y(b[1] + u[0] * w)} L${n(b[0] + u[1] * w)} ${Y(b[1] - u[0] * w)}Z" fill="#000"/>`;
  };
  for (const e of entities) {
    if (e.k === 'hatch') {
      const d = e.loops.map(l => 'M' + l.map(p => `${n(p[0])} ${Y(p[1])}`).join(' L') + 'Z').join(' ');
      out.push(`<path d="${d}" fill="url(#hatch)" fill-rule="evenodd" stroke="#000" stroke-width="${LW.VIS}"/>`);
    } else if (e.k === 'line') {
      out.push(`<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map(p => `${n(p[0])},${Y(p[1])}`).join(' ')}" ${stroke(e.layer)}/>`);
    } else if (e.k === 'circle') out.push(`<circle cx="${n(e.c[0])}" cy="${Y(e.c[1])}" r="${n(e.r)}" ${stroke(e.layer)}/>`);
    else if (e.k === 'arc') {
      const p = a => [e.c[0] + e.r * Math.cos(a * Math.PI / 180), e.c[1] + e.r * Math.sin(a * Math.PI / 180)];
      const s = p(e.a0), t = p(e.a1), span = (e.a1 - e.a0 + 360) % 360;
      out.push(`<path d="M${n(s[0])} ${Y(s[1])} A${n(e.r)} ${n(e.r)} 0 ${span > 180 ? 1 : 0} 0 ${n(t[0])} ${Y(t[1])}" ${stroke(e.layer)}/>`);
    } else if (e.k === 'text') out.push(textAt(e.at, e.text, e.h, e.justify, e.rot));
    else if (e.k === 'arrow') out.push(`<line x1="${n(e.from[0])}" y1="${Y(e.from[1])}" x2="${n(e.to[0])}" y2="${Y(e.to[1])}" ${stroke(e.layer)}/>`, head(e.to, e.from, 3.2));
    else if (e.k === 'ddim') {
      const o = [2 * e.c[0] - e.point[0], 2 * e.c[1] - e.point[1]];
      out.push(`<line x1="${n(o[0])}" y1="${Y(o[1])}" x2="${n(e.point[0])}" y2="${Y(e.point[1])}" ${stroke('DIM')}/>`, head(e.point, o), head(o, e.point));
      out.push(textAt([e.point[0] + 1, e.point[1] + 1], e.text || e.value, 2.8, 'BL'));
    }
    else if (e.k === 'dim') {
      const v = e.vertical, a = v ? [e.at[0], e.p1[1]] : [e.p1[0], e.at[1]], b = v ? [e.at[0], e.p2[1]] : [e.p2[0], e.at[1]];
      const ext = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
        return `<line x1="${n(p[0] + u[0] * 1.2)}" y1="${Y(p[1] + u[1] * 1.2)}" x2="${n(q[0] + u[0] * 1.6)}" y2="${Y(q[1] + u[1] * 1.6)}" ${stroke('DIM')}/>`; };
      out.push(ext(e.p1, a), ext(e.p2, b), `<line x1="${n(a[0])}" y1="${Y(a[1])}" x2="${n(b[0])}" y2="${Y(b[1])}" ${stroke('DIM')}/>`, head(a, b), head(b, a));
      const mid = [(a[0] + b[0]) / 2 + (v ? -0.9 : 0), (a[1] + b[1]) / 2 + (v ? 0 : 0.9)];
      out.push(textAt(mid, e.text || e.value, 2.8, 'BC', v ? 90 : 0));
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

module.exports = { svg };

'use strict';

/**
 * Server-side rasterisation with @resvg/resvg-wasm (pure wasm, no native
 * toolchain). Produces:
 *   - metric charts from the sampler's history ring (SVG composed here)
 *   - static PNGs of agent-supplied SVG figures
 *   - sprite sheets (N frames side by side) sampled from a small SMIL subset
 *     of an animated SVG, for clients without a runtime SVG renderer
 *
 * All output is PNG. Sizes default to the requesting device's screen.
 */
const fs   = require('fs');
const path = require('path');
const sampler = require('./sampler');
const L = require('./limits');

let _ready = null;
let _Resvg = null;
let _font = null;   // { buffer, family, file } or null when no TTF was found

/**
 * The wasm build cannot enumerate system fonts, so one TTF is loaded
 * explicitly and mapped to the generic `sans-serif` family. Override with
 * DOCA_FONT=/path/to/font.ttf (family name is read from the file name).
 */
const FONT_CANDIDATES = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/TTF/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'Liberation Sans'],
  ['/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', 'Noto Sans'],
  ['/usr/share/fonts/truetype/freefont/FreeSans.ttf', 'FreeSans'],
  ['/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf', 'Liberation Sans'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', 'Arial'],
];

function loadFont() {
  const custom = process.env.DOCA_FONT;
  const list = custom ? [[custom, path.basename(custom).replace(/[-_.]?(Regular)?\.[ot]tf$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2')], ...FONT_CANDIDATES] : FONT_CANDIDATES;
  for (const [file, family] of list) {
    try { return { buffer: fs.readFileSync(file), family, file }; } catch {}
  }
  return null;
}

function init() {
  if (_ready) return _ready;
  _ready = (async () => {
    const mod = require('@resvg/resvg-wasm');
    const wasmPath = path.join(path.dirname(require.resolve('@resvg/resvg-wasm')), 'index_bg.wasm');
    await mod.initWasm(fs.readFileSync(wasmPath));
    _Resvg = mod.Resvg;
    _font = loadFont();
    if (!_font) console.warn('[api-v1/render] no TTF font found; text in server-rendered images will be dropped (set DOCA_FONT)');
  })();
  return _ready;
}

function fontOptions() {
  if (!_font) return { loadSystemFonts: false, defaultFontFamily: 'sans-serif' };
  return { loadSystemFonts: false, fontBuffers: [_font.buffer], defaultFontFamily: _font.family, sansSerifFamily: _font.family, serifFamily: _font.family, monospaceFamily: _font.family };
}

/** Whether text will appear in rendered images (for capabilities). */
function textSupported() { return !!_font; }

const THEMES = {
  dark:  { bg: '#0b0f14', fg: '#e6edf3', muted: '#7d8590', grid: '#1f2731', ok: '#3fb950', warn: '#d29922', crit: '#f85149', accent: '#58a6ff' },
  light: { bg: '#ffffff', fg: '#1f2328', muted: '#656d76', grid: '#d0d7de', ok: '#1a7f37', warn: '#9a6700', crit: '#cf222e', accent: '#0969da' },
};
function theme(name) { return THEMES[name] || THEMES.dark; }

/** Rasterise an SVG string to PNG at the given pixel width (height follows aspect unless given). */
async function svgToPng(svg, { w, h } = {}) {
  await init();
  const fitTo = w ? { mode: 'width', value: Math.round(w) } : h ? { mode: 'height', value: Math.round(h) } : { mode: 'original' };
  const r = new _Resvg(svg, { fitTo, font: fontOptions() });
  const png = Buffer.from(r.render().asPng());
  if (png.length > L.IMAGE_BYTES) throw Object.assign(new Error(`rendered image is ${png.length} bytes (limit ${L.IMAGE_BYTES})`), { code: 'image_too_large', status: 413 });
  return png;
}

// ─── Charts ──────────────────────────────────────────────────────────────────

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Compose a line chart SVG for one or more metric ids from sampler history.
 * @param {object} o  { metrics: string[], w, h, theme, rangeSec, title, thresholds }
 */
function chartSvg(o) {
  const t = theme(o.theme);
  const w = o.w || 320, h = o.h || 160;
  const pad = { l: 8, r: 8, t: o.title ? 22 : 8, b: 18 };
  const now = Date.now();
  const since = now - (o.rangeSec || 3600) * 1000;
  const series = (o.metrics || []).slice(0, 4).map((id, i) => ({
    id, color: [t.accent, t.ok, t.warn, t.crit][i % 4],
    points: sampler.history(id).filter(p => p.t >= since),
  }));
  const all = series.flatMap(s => s.points.map(p => p.v));
  let min = Math.min(...all), max = Math.max(...all);
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (o.min != null) min = Math.min(min, o.min);
  if (o.max != null) max = Math.max(max, o.max);
  if (max === min) max = min + 1;
  // Fit the x axis to the data actually held (a fresh server has seconds of history, not an hour).
  const times = series.flatMap(s => s.points.map(p => p.t));
  let t0 = times.length ? Math.min(...times) : since;
  if (now - t0 < 30000) t0 = now - 30000;
  const x = ts => pad.l + (ts - t0) / Math.max(1, now - t0) * (w - pad.l - pad.r);
  const y = v  => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);

  const grid = [0, 0.5, 1].map(f => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(min + f * (max - min)).toFixed(1)}" y2="${y(min + f * (max - min)).toFixed(1)}" stroke="${t.grid}" stroke-width="1"/>`).join('');
  const thr = (o.thresholds || []).map(th => th.gte != null && th.gte >= min && th.gte <= max
    ? `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(th.gte).toFixed(1)}" y2="${y(th.gte).toFixed(1)}" stroke="${t[th.level] || t.warn}" stroke-dasharray="3 3" stroke-width="1"/>` : '').join('');
  const lines = series.map(s => s.points.length > 1
    ? `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${s.points.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>`
    : s.points.length === 1 ? `<circle cx="${x(s.points[0].t).toFixed(1)}" cy="${y(s.points[0].v).toFixed(1)}" r="2.5" fill="${s.color}"/>` : '').join('');
  const last = series.map(s => s.points.length ? s.points[s.points.length - 1].v : null);
  const legend = series.map((s, i) => `<text x="${pad.l + i * (w / series.length)}" y="${h - 5}" font-size="10" fill="${s.color}" font-family="sans-serif">${esc(o.labels?.[i] || s.id)}${last[i] != null ? ` ${esc(fmt(last[i], o.unit))}` : ''}</text>`).join('');
  const title = o.title ? `<text x="${pad.l}" y="15" font-size="12" fill="${t.fg}" font-family="sans-serif">${esc(o.title)}</text>` : '';
  const range = `<text x="${w - pad.r}" y="${pad.t + 10}" font-size="9" fill="${t.muted}" text-anchor="end" font-family="sans-serif">${esc(fmt(max, o.unit))}</text><text x="${w - pad.r}" y="${h - pad.b - 2}" font-size="9" fill="${t.muted}" text-anchor="end" font-family="sans-serif">${esc(fmt(min, o.unit))}</text>`;
  const empty = all.length ? '' : `<text x="${w / 2}" y="${h / 2}" font-size="11" fill="${t.muted}" text-anchor="middle" font-family="sans-serif">no data yet</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${t.bg}" rx="${o.round ? Math.min(w, h) / 2 : 6}"/>${grid}${thr}${lines}${title}${range}${legend}${empty}</svg>`;
}

function fmt(v, unit) {
  if (v == null) return '';
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return unit === 'B' || unit === 'B/s' ? require('./surfaces').fmtBytes(v) + (unit === 'B/s' ? '/s' : '') : `${n}${unit || ''}`;
}

// ─── SMIL subset sampler → sprite sheet ──────────────────────────────────────

function parseDur(s) {
  if (!s) return 1000;
  const m = /^([\d.]+)\s*(ms|s|min)?$/.exec(String(s).trim());
  if (!m) return 1000;
  const v = parseFloat(m[1]);
  return m[2] === 'ms' ? v : m[2] === 'min' ? v * 60000 : v * 1000;
}
function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
const isNum = s => /^-?[\d.]+$/.test(String(s).trim());
const lerp = (a, b, f) => a + (b - a) * f;
function lerpList(a, b, f) {
  const A = a.trim().split(/[\s,]+/), B = b.trim().split(/[\s,]+/);
  return A.map((x, i) => isNum(x) && isNum(B[i]) ? lerp(parseFloat(x), parseFloat(B[i]), f).toFixed(3) : x).join(' ');
}

/**
 * Find <animate>/<animateTransform> elements and their parents. Returns a
 * list of { parentStart, parentEnd, parentAttrs, parentName, anims: [...] }.
 */
function scanAnimations(svg) {
  const tagRe = /<\/?([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  const stack = [];
  const parents = new Map();
  let m;
  while ((m = tagRe.exec(svg))) {
    const [full, name, attrStr, selfClose] = m;
    const closing = full.startsWith('</');
    if (closing) { while (stack.length && stack.pop().name !== name) {} continue; }
    if (name === 'animate' || name === 'animateTransform' || name === 'set') {
      const parent = stack[stack.length - 1];
      if (parent) {
        const a = attrs(attrStr);
        const spec = { kind: name, attr: a.attributeName, type: a.type, from: a.from, to: a.to, values: a.values ? a.values.split(';').map(s => s.trim()) : null,
                       durMs: parseDur(a.dur), beginMs: parseDur(a.begin || '0s') || 0, repeat: a.repeatCount || '1', freeze: a.fill === 'freeze', to_set: a.to };
        if (!parents.has(parent)) parents.set(parent, []);
        parents.get(parent).push(spec);
      }
      if (!selfClose) stack.push({ name, attrStr, start: m.index, end: m.index + full.length });
      continue;
    }
    if (!selfClose) stack.push({ name, attrStr, start: m.index, end: m.index + full.length, full });
    else if (parents.size === 0) { /* leaf, nothing */ }
  }
  return [...parents.entries()].map(([p, anims]) => ({ ...p, anims }));
}

function valueAt(spec, tMs) {
  let local = tMs - spec.beginMs;
  if (local < 0) return null;
  const repeats = spec.repeat === 'indefinite' ? Infinity : parseFloat(spec.repeat) || 1;
  const total = spec.durMs * repeats;
  if (local >= total) { if (!spec.freeze && repeats !== Infinity) return null; local = spec.durMs; }
  else local = local % spec.durMs;
  const f = Math.min(1, local / spec.durMs);
  if (spec.kind === 'set') return spec.to_set;
  if (spec.values && spec.values.length > 1) {
    const seg = f * (spec.values.length - 1);
    const i = Math.min(spec.values.length - 2, Math.floor(seg));
    const a = spec.values[i], b = spec.values[i + 1], lf = seg - i;
    return isNum(a) && isNum(b) ? lerp(parseFloat(a), parseFloat(b), lf).toFixed(3) : lerpList(a, b, lf);
  }
  if (spec.from == null || spec.to == null) return spec.to ?? null;
  return isNum(spec.from) && isNum(spec.to) ? lerp(parseFloat(spec.from), parseFloat(spec.to), f).toFixed(3) : lerpList(spec.from, spec.to, f);
}

/** Produce a static SVG for time t by applying sampled attribute values and stripping animation elements. */
function frameAt(svg, parents, tMs) {
  const edits = [];
  for (const p of parents) {
    const a = attrs(p.attrStr);
    for (const spec of p.anims) {
      const v = valueAt(spec, tMs);
      if (v == null) continue;
      if (spec.kind === 'animateTransform') a.transform = `${spec.type || 'translate'}(${v})`;
      else if (spec.attr) a[spec.attr] = v;
    }
    const rebuilt = `<${p.name} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}>`;
    edits.push({ start: p.start, end: p.end, text: rebuilt });
  }
  edits.sort((x, y) => y.start - x.start);
  let out = svg;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out.replace(/<(animate|animateTransform|animateMotion|set)\b[^>]*\/>/g, '').replace(/<(animate|animateTransform|animateMotion|set)\b[^>]*>[\s\S]*?<\/\1>/g, '');
}

/** Extract the inner content and viewBox of an SVG root. */
function splitRoot(svg) {
  const open = /<svg\b([^>]*)>/i.exec(svg);
  if (!open) return null;
  const a = attrs(open[1]);
  const inner = svg.slice(open.index + open[0].length).replace(/<\/svg>\s*$/i, '');
  let viewBox = a.viewBox;
  if (!viewBox) viewBox = `0 0 ${parseFloat(a.width) || 100} ${parseFloat(a.height) || 100}`;
  return { inner, viewBox, rootAttrs: a };
}

/** Suffix every id (and its references) so frames can be nested side by side. */
function suffixIds(inner, sfx) {
  return inner.replace(/\bid="([^"]+)"/g, (_, id) => `id="${id}${sfx}"`)
              .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${id}${sfx})`)
              .replace(/href="#([^"]+)"/g, (_, id) => `href="#${id}${sfx}"`);
}

/**
 * Sprite sheet: `frames` frames of the animation laid out horizontally,
 * each `w`×`h`. Total animation length = longest (begin + dur × repeat≤4).
 */
function spriteSvg(svg, { frames = 8, w = 200, h = 200 }) {
  const parents = scanAnimations(svg);
  const totalMs = Math.max(500, ...parents.flatMap(p => p.anims.map(a => a.beginMs + a.durMs * Math.min(4, a.repeat === 'indefinite' ? 1 : parseFloat(a.repeat) || 1))));
  const cells = [];
  for (let i = 0; i < frames; i++) {
    const t = (i / frames) * totalMs;
    const frame = frameAt(svg, parents, t);
    const root = splitRoot(frame);
    if (!root) continue;
    cells.push(`<svg x="${i * w}" y="0" width="${w}" height="${h}" viewBox="${root.viewBox}" preserveAspectRatio="xMidYMid meet">${suffixIds(root.inner, `_f${i}`)}</svg>`);
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w * frames}" height="${h}">${cells.join('')}</svg>`, totalMs, frames: cells.length };
}

/** Render one static frame (t=0) of a possibly animated SVG at w×h. */
function posterSvg(svg, { w = 200, h = 200 }) {
  const parents = scanAnimations(svg);
  const frame = parents.length ? frameAt(svg, parents, 0) : svg;
  const root = splitRoot(frame);
  if (!root) return frame;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${root.viewBox}" preserveAspectRatio="xMidYMid meet">${root.inner}</svg>`;
}

module.exports = { init, svgToPng, chartSvg, spriteSvg, posterSvg, scanAnimations, frameAt, textSupported, THEMES };

'use strict';

/**
 * The promo's timing and its ffmpeg edit, from the spec alone — pure, so the tests can hold the arithmetic: the
 * shots add up to exactly the duration asked for, every part has its moment, every caption sits inside its shot.
 *
 * The cut is four shots joined by crossfades: a title card over the product blurred, the product turning, the parts
 * coming together in list order (each named as it lands), and an end card. A one-part product has no assembly shot.
 */

const RES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160], square: [1080, 1080], vertical: [1080, 1920] };
const WEIGHTS = { title: 3.5, turntable: 6.5, assemble: 7.5, end: 4 };
const PALETTE = ['#d9dce0', '#ff7a2f', '#5b8def', '#3fbf8a', '#c05bd8', '#e5c04a'];
const PALETTE_LIGHT = ['#4a5361', '#ff7a2f', '#3a6fd8', '#2f9e6f', '#9c46b5', '#c99a14'];   // dark first: a light part on a light floor vanishes

function resolution(r) {
  if (Array.isArray(r) && r.length === 2) return r.map(v => Math.round(v / 2) * 2);
  return RES[String(r || '1080p').toLowerCase()] || RES['1080p'];
}

/** Shot lengths in seconds; fades overlap neighbours, so the shots sum to duration + fades. */
function shots(spec) {
  const duration = Number(spec.duration) || 20, fade = spec.fade ?? 0.5;
  const parts = spec.parts || [];
  const order = ['title', 'turntable', ...(parts.length > 1 ? ['assemble'] : []), 'end'];
  const total = duration + fade * (order.length - 1);
  const sum = order.reduce((a, k) => a + WEIGHTS[k], 0);
  const fps = Number(spec.fps) || 30;
  // Whole frames for every shot, the last one taking what rounding left, so the cut is exactly `duration`.
  const out = order.map(k => ({ shot: k, seconds: Math.round(WEIGHTS[k] / sum * total * fps) / fps }));
  const used = out.slice(0, -1).reduce((a, s) => a + s.seconds, 0);
  out[out.length - 1].seconds = Math.round((total - used) * fps) / fps;
  let t = 0;
  for (const s of out) { s.start = +t.toFixed(4); s.frames = Math.round(s.seconds * fps); t += s.seconds - fade; }
  return { order, list: out, duration, fade, fps };
}

/**
 * The assembly shot's schedule: a beat with the parts spread out, then each part after the first moves onto its
 * place in turn, and the finished product holds at the end. moves[i-1] = [start, end] of part i, in shot seconds.
 */
function schedule(n, seconds) {
  const hold0 = Math.min(1.2, seconds * 0.15), hold1 = Math.min(1.6, seconds * 0.2);
  const each = Math.max(0.4, (seconds - hold0 - hold1) / Math.max(1, n - 1));
  const moves = [];
  for (let i = 1; i < n; i++) moves.push([+(hold0 + (i - 1) * each).toFixed(3), +(hold0 + (i - 1) * each + each * 0.8).toFixed(3)]);
  // Captions: the first part from the start, each next one from when it starts moving to when the next does.
  const captions = [];
  for (let i = 0; i < n; i++) {
    // A short gap between one caption and the next, so two never fade through each other.
    const a = i === 0 ? 0.25 : moves[i - 1][0] + 0.15;
    const b = i < n - 1 ? moves[i][0] - 0.1 : seconds - 0.25;
    captions.push([+a.toFixed(3), +Math.min(b, seconds - 0.25).toFixed(3)]);
  }
  return { moves, captions };
}

/** Parts with defaults filled: a name, a colour from the palette in order. */
function parts(spec) {
  const pal = spec.style === 'light' ? PALETTE_LIGHT : PALETTE;
  return (spec.parts || []).map((p, i) => ({ ...p, name: p.name || `Part ${i + 1}`, color: p.color || pal[i % pal.length] }));
}

const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(Number(x)));

/**
 * How each part after the first comes to its place, checked before anything renders. Without a word of its own a part
 * comes along the spec's `explode_axis` (default +Z), as every part always did; `axis` [x, y, z] gives it a way of its
 * own (it starts out on that side and moves against it: `[-1, 0, 0]` slides it on along +X), `distance` (mm) how far
 * out it starts, and `via` [[x, y, z], …] a path — offsets in mm from its place, travelled in order, then its place
 * (a clip lifted over a panel edge, then pushed down onto it). Returns one line per moving part, for `plan`.
 */
function motion(spec) {
  const out = [];
  (spec.parts || []).forEach((p, i) => {
    const who = `part ${i + 1}${p.name ? ` (${p.name})` : ''}`;
    if (p.axis !== undefined && (!vec3(p.axis) || p.axis.every(x => !Number(x)))) throw new Error(`${who}: "axis" is a direction, three numbers not all 0, such as [1, 0, 0].`);
    if (p.distance !== undefined && !(Number(p.distance) > 0)) throw new Error(`${who}: "distance" is millimetres, a number above 0.`);
    if (p.via !== undefined && (!Array.isArray(p.via) || !p.via.length || !p.via.every(vec3))) throw new Error(`${who}: "via" is a list of points [x, y, z] in mm from where it sits, such as [[0, 0, 40], [0, -10, 40]].`);
    if (p.via !== undefined && p.axis !== undefined) throw new Error(`${who}: give "axis" or "via", not both.`);
    if (i === 0) { if (p.axis || p.via) throw new Error(`${who}: the first part stays where it is, so it takes no "axis" or "via" — list the part that moves after it.`); return; }
    out.push({ part: i + 1, name: p.name || `Part ${i + 1}`, from: p.via ? `via ${p.via.map(v => `[${v.join(', ')}]`).join(' → ')}` : `along ${JSON.stringify(p.axis || spec.explode_axis || [0, 0, 1])}${p.distance ? `, ${p.distance} mm out` : ''}` });
  });
  return out;
}

// ffmpeg filter values: a path or text in single quotes, with what the filter parser reads specially escaped.
const q = s => `'${String(s).replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')}'`;

/** One drawtext from a text file (so no text needs escaping), fading in at `from` and out at `to` (shot seconds). */
function text({ file, font, size, color, x, y, from = 0, to = null, fade = 0.35, alpha = 1 }) {
  const a = to == null
    ? `if(lt(t,${from}),0,min(1,(t-${from})/${fade}))*${alpha}`
    : `if(lt(t,${from}),0,if(gt(t,${to}),0,min(1,min((t-${from})/${fade},(${to}-t)/${fade}))))*${alpha}`;
  return `drawtext=textfile=${q(file)}:fontfile=${q(font)}:fontsize=${Math.round(size)}:fontcolor=${color}:x=${x}:y=${y}:alpha='${a}'`;
}

const box = ({ x, y, w, h, color, from = 0, to = null }) => `drawbox=x=${Math.round(x)}:y=${Math.round(y)}:w=${Math.round(w)}:h=${Math.round(h)}:color=${color}:t=fill:enable='${to == null ? `gte(t,${from})` : `between(t,${from},${to})`}'`;

module.exports = { shots, schedule, parts, motion, resolution, text, box, q, RES, WEIGHTS, PALETTE };

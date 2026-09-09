'use strict';

/**
 * Rich content: blocks, figure representations, and the motion vocabulary.
 *
 * Agent-authored content is described once as a list of blocks. A `figure`
 * block carries several *representations* of the same thing (svg, motion
 * scene, sprite, image, text). The server picks the best one the requesting
 * device declared it can render and sends only that — a watch never
 * receives an SVG string it cannot use.
 *
 * Motion vocabulary v1 — five primitives a client maps onto its own native
 * animation APIs: morph, ring, reveal, pulse, sequence.
 */
const crypto = require('crypto');
const L = require('./limits');

const MOTION_VOCAB = '1';
const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring'];
const COLOR_ROLES = ['ok', 'warn', 'crit', 'accent', 'muted'];
const BLOCK_TYPES = ['text', 'metric', 'figure', 'image', 'media', 'artifact', 'list', 'kv'];

const clamp = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const easing = e => EASINGS.includes(e) ? e : 'ease-in-out';
const role = c => COLOR_ROLES.includes(c) ? c : 'accent';
const str = (s, n) => typeof s === 'string' ? s.slice(0, n) : undefined;

// ─── Motion vocabulary ───────────────────────────────────────────────────────

function normalizePrimitive(p, depth = 0) {
  if (!p || typeof p !== 'object') return null;
  switch (p.type) {
    case 'morph':  return { type: 'morph', target: str(p.target, 64), from: Number(p.from) || 0, to: Number(p.to) || 0, durationMs: clamp(p.durationMs, 50, 10000, 600), easing: easing(p.easing), unit: str(p.unit, 8) };
    case 'ring':   return { type: 'ring', target: str(p.target, 64), from: clamp(p.from, 0, 1, 0), to: clamp(p.to, 0, 1, 1), durationMs: clamp(p.durationMs, 50, 10000, 800), easing: easing(p.easing), color: role(p.color) };
    case 'reveal': return { type: 'reveal', target: str(p.target, 64), mode: ['fade', 'slide-up', 'slide-in'].includes(p.mode) ? p.mode : 'fade', durationMs: clamp(p.durationMs, 50, 5000, 300), delayMs: clamp(p.delayMs, 0, 10000, 0) };
    case 'pulse':  return { type: 'pulse', target: str(p.target, 64), count: clamp(p.count, 1, 20, 3), periodMs: clamp(p.periodMs, 100, 5000, 800), color: role(p.color) };
    case 'sequence': {
      if (depth > 2) return null;
      const steps = (Array.isArray(p.steps) ? p.steps : []).slice(0, 16).map(s => normalizePrimitive(s, depth + 1)).filter(Boolean);
      return steps.length ? { type: 'sequence', steps, loop: !!p.loop } : null;
    }
    default: return null;                 // unknown primitive: dropped, rest kept
  }
}

/** Validate a motion scene. Returns { vocab, tracks, durationMs, caption } or null. */
function normalizeScene(scene) {
  if (!scene || typeof scene !== 'object') return null;
  const tracks = (Array.isArray(scene.tracks) ? scene.tracks : []).slice(0, 16).map(t => normalizePrimitive(t)).filter(Boolean);
  if (!tracks.length) return null;
  const dur = t => t.type === 'sequence' ? t.steps.reduce((a, s) => a + dur(s), 0) : (t.durationMs || 0) + (t.delayMs || 0) + (t.type === 'pulse' ? t.count * t.periodMs : 0);
  return { vocab: MOTION_VOCAB, tracks, durationMs: Math.max(...tracks.map(dur)), loop: !!scene.loop, caption: str(scene.caption, 200) };
}

// ─── Figures ─────────────────────────────────────────────────────────────────

const _figures = new Map(); // figureId → { svg, motion, createdAt }
const FIGURE_TTL_MS = 6 * 3600 * 1000;

function registerFigure(fig) {
  const id = fig.id || `fig_${crypto.randomBytes(6).toString('hex')}`;
  _figures.set(id, { svg: fig.svg || null, motion: fig.motion || null, createdAt: Date.now() });
  if (_figures.size > 500) for (const [k, v] of _figures) { if (Date.now() - v.createdAt > FIGURE_TTL_MS) _figures.delete(k); }
  return id;
}
function getFigure(id) {
  const f = _figures.get(id);
  if (!f) return null;
  if (Date.now() - f.createdAt > FIGURE_TTL_MS) { _figures.delete(id); return null; }
  return f;
}

const hasSmil = svg => /<(animate|animateTransform|animateMotion|set)\b/.test(svg);

/**
 * Normalise an authored figure block into its canonical stored form:
 * { type:'figure', id, alt, svg?, motion?, image?, sizeHint? }.
 */
function normalizeFigure(b) {
  const fig = { type: 'figure', alt: str(b.alt, 200) || 'figure' };
  if (typeof b.svg === 'string' && b.svg.length <= 64 * 1024 && /^\s*<svg[\s>]/.test(b.svg)) fig.svg = b.svg;
  const motion = normalizeScene(b.motion);
  if (motion) fig.motion = motion;
  if (b.image && typeof b.image === 'object' && typeof b.image.url === 'string') fig.image = { url: b.image.url.slice(0, 512), w: clamp(b.image.w, 1, 4096, undefined), h: clamp(b.image.h, 1, 4096, undefined) };
  if (b.sizeHint && typeof b.sizeHint === 'object') fig.sizeHint = { w: clamp(b.sizeHint.w, 16, 2048, 240), h: clamp(b.sizeHint.h, 16, 2048, 120) };
  if (typeof b.text === 'string') fig.text = b.text.slice(0, 400);
  if (!fig.svg && !fig.motion && !fig.image && !fig.text) return null;
  fig.id = registerFigure({ id: b.id, svg: fig.svg, motion: fig.motion });
  return fig;
}

/** Normalise a whole block list (agent input → stored form). */
function normalizeBlocks(blocks) {
  const out = [];
  for (const b of (Array.isArray(blocks) ? blocks : []).slice(0, 24)) {
    if (!b || typeof b !== 'object') continue;
    switch (b.type) {
      case 'text':     if (typeof b.text === 'string') out.push({ type: 'text', text: b.text.slice(0, 2000), style: ['body', 'title', 'caption', 'code'].includes(b.style) ? b.style : 'body' }); break;
      case 'metric':   if (typeof b.metric === 'string') out.push({ type: 'metric', metric: b.metric.slice(0, 64), label: str(b.label, 48) }); break;
      case 'figure':   { const f = normalizeFigure(b); if (f) out.push(f); break; }
      case 'image':    if (b.url) out.push({ type: 'image', url: String(b.url).slice(0, 512), alt: str(b.alt, 200), w: clamp(b.w, 1, 4096, undefined), h: clamp(b.h, 1, 4096, undefined) }); break;
      case 'media':    if (b.mediaId) out.push({ type: 'media', mediaId: String(b.mediaId).slice(0, 64), alt: str(b.alt, 200) }); break;
      case 'artifact': if (b.artifactId) out.push({ type: 'artifact', artifactId: String(b.artifactId).slice(0, 64), runtime: str(b.runtime, 32), alt: str(b.alt, 200) }); break;
      case 'list':     if (Array.isArray(b.items)) out.push({ type: 'list', items: b.items.slice(0, 20).map(i => String(i).slice(0, 200)) }); break;
      case 'kv':       if (Array.isArray(b.items)) out.push({ type: 'kv', items: b.items.slice(0, 20).filter(i => i && typeof i === 'object').map(i => ({ k: String(i.k ?? '').slice(0, 48), v: String(i.v ?? '').slice(0, 120) })) }); break;
      default: break; // unknown block types are dropped at authoring time
    }
    if (b.ext && typeof b.ext === 'object' && JSON.stringify(b.ext).length <= L.EXT_BYTES && out.length) out[out.length - 1].ext = b.ext;
  }
  return out;
}

// ─── Tailoring to a device ───────────────────────────────────────────────────

/**
 * Pick one representation of a figure for a device's capabilities.
 * Order of preference: svg (with smil if animated and supported) →
 * motion → sprite (animated svg only) → image → text.
 */
function pickRepresentation(fig, caps, opts = {}) {
  // `compact` (event budget exceeded): never inline SVG, let the client fetch an image instead.
  const render = (caps?.render || ['text']).filter(r => !opts.compact || (r !== 'svg' && r !== 'svg.smil'));
  const motion = caps?.motion || [];
  const screen = caps?.screen;
  const w = opts.w || fig.sizeHint?.w || (screen ? Math.min(screen.w, 480) : 240);
  const h = opts.h || fig.sizeHint?.h || (screen ? Math.min(screen.h, 480) : 120);
  const animated = !!fig.svg && hasSmil(fig.svg);

  if (fig.svg && render.includes('svg') && (!animated || render.includes('svg.smil'))) {
    return { kind: 'svg', svg: fig.svg, animated };
  }
  if (fig.motion && motion.includes(fig.motion.vocab)) {
    return { kind: 'motion', scene: fig.motion };
  }
  if (fig.svg && animated && render.includes('sprite')) {
    const frames = 8;
    return { kind: 'sprite', url: `/api/v1/render/figure/${fig.id}?w=${w}&h=${h}&frames=${frames}`, frames, fps: 8, w, h, loop: true };
  }
  if (fig.svg && render.includes('image')) {
    return { kind: 'image', url: `/api/v1/render/figure/${fig.id}?w=${w}&h=${h}`, w, h };
  }
  if (fig.image && render.includes('image')) {
    return { kind: 'image', url: fig.image.url, w: fig.image.w, h: fig.image.h };
  }
  return { kind: 'text', text: fig.text || fig.motion?.caption || fig.alt };
}

/**
 * Tailor stored blocks for one device: figures collapse to a single
 * representation, artifacts are dropped unless the device declares the
 * runtime, everything else passes through.
 */
function tailorBlocks(blocks, caps, opts = {}) {
  const exec = caps?.exec || [];
  const out = [];
  for (const b of blocks || []) {
    if (b.type === 'figure') {
      out.push({ type: 'figure', id: b.id, alt: b.alt, representation: pickRepresentation(b, caps, opts), ext: b.ext });
    } else if (b.type === 'artifact') {
      if (b.runtime && !exec.includes(b.runtime)) { out.push({ type: 'text', text: b.alt || `(artifact requires ${b.runtime} runtime)`, style: 'caption', ext: b.ext }); }
      else out.push({ ...b, url: `/api/v1/artifacts/${b.artifactId}`, contentUrl: `/api/v1/artifacts/${b.artifactId}/content` });
    } else if (b.type === 'media') {
      out.push({ ...b, url: `/api/v1/media/${b.mediaId}` });
    } else {
      out.push(b);
    }
  }
  return out;
}

module.exports = { MOTION_VOCAB, EASINGS, COLOR_ROLES, BLOCK_TYPES, normalizeScene, normalizeBlocks, normalizeFigure, registerFigure, getFigure, pickRepresentation, tailorBlocks, hasSmil };

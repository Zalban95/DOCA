/* ═══════════════════════════════════════════════════════
   The face (docs/design/hive.md §5; TODO H8.1): a field of luminous dots that
   drifts like noise when nothing is happening and coalesces into a face — two
   eye clusters and a mouth line — when the hive pays attention. Order out of
   noise. Canvas 2D, so it runs on an old tablet, a TV in kiosk mode, the
   panel's corner and (later) a watch.

   A face is a small JSON (FACE_DEFAULT): palette, dot count, eye and mouth
   geometry, HUD and grain, and per-state overrides — editable, and a pack.
   faceMount(canvas, spec) → { set(state, detail), level(0..1), shape(points, color, ms), resize(), stop() }

   Motion is eased, never set: each dot has a velocity and springs toward where it should be, and drifts a little
   always, so nothing snaps and nothing is ever still. shape() gathers every dot into a silhouette (a concept the
   voice is about to name — face/concept-engine.js) in that concept's colour, then lets them flow back.
   ═══════════════════════════════════════════════════════ */

const FACE_DEFAULT = {
  name: 'Protolab',
  palette: { bg: '#050507', ink: '#e8edf2', dim: '#707a85', accent: '#57c9c2', steel: '#6f8aa3', ask: '#e8a020', error: '#e85050', field: '#a6bfd6' },
  dots: 760,
  form: 'poly',
  point: 1, glow: 1, speed: 1, concepts: true,   // tunable in Settings → Voice → The face (settings/face-editor.js)   // a polyhedron of light (face/poly.js); 'face' is the earlier eyes and mouth
  eyes: { y: -0.16, gap: 0.40, r: 0.10 },
  mouth: { y: 0.30, w: 0.46, curve: 0.06 },
  hud: true,
  grain: false,   // scanlines read as low resolution on a dense screen; a spec may still ask for them
  states: {},
};

/** How each state draws: coherence (0 noise … 1 form), eye openness and mouth motion (the 'face' form), spin, colour,
 *  drift speed; for the polyhedron, breath (how much it swells and shrinks) and scale. */
const FACE_STATES = {
  idle:     { c: 0.55, eye: 1.0, mouth: 0.0, spin: 0.00, color: 'accent', drift: 0.25, blink: true, breath: 0.09, scale: 1 },
  thinking: { c: 0.85, eye: 0.55, mouth: 0.0, spin: 0.55, color: 'accent', drift: 0.35, orbit: true, breath: 0.04, scale: 0.92 },
  working:  { c: 0.78, eye: 0.8, mouth: 0.0, spin: 0.9, color: 'steel', drift: 0.3, breath: 0.03, scale: 0.95 },
  speaking: { c: 0.95, eye: 1.0, mouth: 1.0, spin: 0.1, color: 'accent', drift: 0.2, breath: 0.05, scale: 1.04 },
  asking:   { c: 0.95, eye: 1.25, mouth: 0.0, spin: 0.05, color: 'ask', drift: 0.15, lookUp: true, breath: 0.12, scale: 1.06 },
  listening:{ c: 0.95, eye: 1.0, mouth: 0.0, spin: 0.05, color: 'accent', drift: 0.15, pulse: true, breath: 0.06, scale: 1.08 },
  error:    { c: 0.35, eye: 0.6, mouth: 0.0, spin: 0.2, color: 'error', drift: 0.9, flicker: true, breath: 0.02, scale: 0.9 },
  quiet:    { c: 0.4, eye: 0.3, mouth: 0.0, spin: 0.0, color: 'dim', drift: 0.05, breath: 0.04, scale: 0.85 },
};

function _faceRand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function faceMount(canvas, specIn = {}) {
  const spec = { ...FACE_DEFAULT, ...specIn, palette: { ...FACE_DEFAULT.palette, ...(specIn.palette || {}) },
    eyes: { ...FACE_DEFAULT.eyes, ...(specIn.eyes || {}) }, mouth: { ...FACE_DEFAULT.mouth, ...(specIn.mouth || {}) } };
  const states = Object.fromEntries(Object.entries(FACE_STATES).map(([k, v]) => [k, { ...v, ...(spec.states?.[k] || {}) }]));
  const ctx = canvas.getContext('2d');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, unit = 0, dpr = 1, raf = 0, stopped = false;
  let target = states.idle, state = 'idle', detail = '', level = 0, lastEvent = performance.now();
  const cur = { ...states.idle, colorRGB: null };
  let grainTile = null;
  let shapeOn = null, shapeMix = 0;   // {pts, rgb, until}: a silhouette the dots gather into for a moment

  // Dots: a role (left eye, right eye, mouth, field), a seat in the face and a wandering point in the noise.
  const rnd = _faceRand(7);
  const n = Math.max(40, Math.min(1200, spec.dots | 0));
  const eyeN = Math.round(n * 0.16), mouthN = Math.round(n * 0.14);
  const poly = spec.form !== 'face' && typeof facePolyForm === 'function';
  const formN = Math.round(n * 0.62);
  const form = poly ? facePolyForm(formN, _faceRand(11)) : null;
  const dots = Array.from({ length: n }, (_, i) => ({ i, ...seat(i) }));
  function seat(i) {
    const role = poly ? (i < formN ? 'p' : 'f') : i < eyeN ? 'le' : i < eyeN * 2 ? 're' : i < eyeN * 2 + mouthN ? 'm' : 'f';
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
    let fx, fy;
    if (role === 'le' || role === 're') { fx = Math.cos(a) * r * spec.eyes.r; fy = Math.sin(a) * r * spec.eyes.r; }
    else if (role === 'm') { const t = (i - eyeN * 2) / Math.max(1, mouthN - 1); fx = (t - 0.5) * spec.mouth.w; fy = (rnd() - 0.5) * 0.02; }
    else { const ang = rnd() * Math.PI * 2, rr = 0.72 + rnd() * 0.22; fx = Math.cos(ang) * rr; fy = Math.sin(ang) * rr * 1.08; }
    // z is depth, as on protolab.tech: near points larger, softer and dimmer, far ones small and bright.
    const z = Math.pow(rnd(), 1.6);
    return { role, fx, fy, t: (i - eyeN * 2) / Math.max(1, mouthN - 1), nx: (rnd() * 2 - 1) * 1.6, ny: (rnd() * 2 - 1) * 1.6, ph: rnd() * 1000, sp: 0.4 + rnd(), z,
      size: 0.7 + z * 2.6 + rnd() * 0.4, glow: 0.95 - z * 0.55, x: NaN, y: NaN, vx: 0, vy: 0, k: 0.025 + rnd() * 0.02 };
  }

  // A point of light, not a disc: a soft radial sprite per colour (quantised, so a colour that eases makes a few).
  const sprites = new Map();
  const sprite = (r, g, b) => {
    const key = `${r >> 3},${g >> 3},${b >> 3}`;
    let s = sprites.get(key);
    if (!s) {
      // A mountain, not a hill (asked 2026-10-06): a small, intense, nearly white core that falls off steeply, over a
      // faint glow as wide as before — drawn pixel by pixel at 128 px, so it stays sharp at any screen's density.
      const S = 128, h2 = S / 2;
      s = document.createElement('canvas'); s.width = s.height = S;
      const c = s.getContext('2d'), img = c.createImageData(S, S), px = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - h2, y + 0.5 - h2) / h2;
        if (d >= 1) continue;
        // A firefly with a contour (asked 2026-10-06): a flat-topped core with a crisp edge, then a dim close bloom and
        // a faint wide glow — the light around a point must never be bright enough to swallow its edge.
        const P = Math.max(0.3, Number(spec.point) || 1), G = Math.max(0, Number(spec.glow ?? 1));
        const core = Math.exp(-Math.pow(d / (0.048 * P), 4)), bloom = 0.13 * G * Math.exp(-Math.pow(d / 0.19, 2)), halo = 0.2 * G * Math.exp(-d / 0.3) * (1 - d * d);
        const a = Math.min(1, core + bloom + halo), white = core / Math.max(a, 1e-6) * 0.75;   // the peak whitens, the glow keeps the colour
        const o = (y * S + x) * 4;
        px[o] = r + (255 - r) * white; px[o + 1] = g + (255 - g) * white; px[o + 2] = b + (255 - b) * white; px[o + 3] = a * 255;
      }
      c.putImageData(img, 0, 0);
      if (sprites.size > 64) sprites.clear();
      sprites.set(key, s);
    }
    return s;
  };
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const v = m ? parseInt(m[1], 16) : 0xffffff; return [v >> 16, (v >> 8) & 255, v & 255]; };

  function resize() {
    dpr = Math.min(3, window.devicePixelRatio || 1);   // a phone is 2.6–3.5: drawn at its own density, not upscaled
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    unit = Math.min(w, h) / 2.3;
    if (spec.grain) {
      grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 4;
      const g = grainTile.getContext('2d'); g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(0, 0, 4, 1);
    }
  }

  function frame(now) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const t = now / 1000 * Math.max(0.1, Number(spec.speed) || 1);
    const k = reduced ? 1 : 0.06;
    for (const key of ['c', 'eye', 'mouth', 'spin', 'drift', 'breath', 'scale']) cur[key] += ((target[key] ?? 0) - (cur[key] ?? 0)) * k;
    form?.frame(t, { spin: cur.spin, breath: cur.breath, scale: cur.scale, level: target.mouth || target.pulse ? level : 0 });
    if (shapeOn && now > shapeOn.until) shapeOn = null;
    shapeMix += ((shapeOn ? 1 : 0) - shapeMix) * (reduced ? 1 : 0.05);
    const want = shapeOn ? shapeOn.rgb : hex(spec.palette[target.color] || spec.palette.accent);
    cur.colorRGB = cur.colorRGB ? cur.colorRGB.map((v, i) => v + (want[i] - v) * 0.06) : want;
    // A blink every few seconds when idle; error flickers; listening pulses with the level.
    let eyeOpen = cur.eye;
    if (target.blink && !reduced) { const b = (t % 4.3); if (b < 0.14) eyeOpen *= Math.abs(b - 0.07) / 0.07 * 0.9 + 0.1; }
    if (target.pulse) eyeOpen *= 1 + level * 0.4;
    const flicker = target.flicker && !reduced ? (Math.sin(t * 40) > 0.3 ? 1 : 0.35) : 1;
    const cx = w / 2, cy = h / 2 + (target.lookUp ? -unit * 0.05 : 0);
    const P = spec.palette;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, w, h);
    const [r, g, b] = cur.colorRGB.map(Math.round);
    const spr = sprite(r, g, b), fieldSpr = sprite(...hex(P.field || P.ink));
    ctx.globalCompositeOperation = 'lighter';   // points of light add up where they cross
    ctx.imageSmoothingQuality = 'high';
    const dotR = Math.max(0.8, unit * 0.011);
    const spin = t * cur.spin;
    const ax = w / 2 / unit, ay = h / 2 / unit;
    for (const d of dots) {
      // The noise: each dot wanders on its own slow curve.
      const dr = reduced ? 0 : cur.drift;
      // The field spans the whole canvas, whatever its shape; the face keeps its proportions in the middle.
      const sx = d.role === 'f' ? ax / 1.6 : 1, sy = d.role === 'f' ? ay / 1.6 : 1;
      const nx = d.nx * sx + Math.sin(t * 0.21 * d.sp + d.ph) * 0.35 * dr * 2;
      const ny = d.ny * sy + Math.cos(t * 0.17 * d.sp + d.ph * 1.3) * 0.35 * dr * 2;
      // The face.
      let fx = d.fx, fy = d.fy, depth = 0.5;
      if (d.role === 'p') [fx, fy, depth] = form.at(d.i);
      else if (d.role === 'le' || d.role === 're') {
        fx += (d.role === 'le' ? -1 : 1) * spec.eyes.gap / 2; fy = spec.eyes.y + d.fy * eyeOpen + (target.lookUp ? -0.04 : 0);
      } else if (d.role === 'm') {
        const curve = spec.mouth.curve * (1 - Math.pow(d.t * 2 - 1, 2));
        const talk = cur.mouth * (0.05 + level * 0.12) * Math.sin(t * 14 + d.t * 6) * (1 - Math.abs(d.t * 2 - 1));
        fy = spec.mouth.y + curve + talk + d.fy;
      } else {
        const a = Math.atan2(d.fy, d.fx) + spin + (target.orbit ? t * 0.1 : 0), rr = Math.hypot(d.fx, d.fy);
        fx = Math.cos(a) * rr; fy = Math.sin(a) * rr;
      }
      const c = d.role === 'f' ? cur.c * 0.3 : cur.c;   // the field stays a field of light; only the face gathers
      let tx = nx + (fx - nx) * c, ty = ny + (fy - ny) * c;
      if (shapeMix > 0.001 && shapeOn) {   // gathering into a silhouette: every dot, the field included
        const p = shapeOn.pts[d.i % shapeOn.pts.length];
        tx += (p[0] - tx) * shapeMix; ty += (p[1] - ty) * shapeMix;
      }
      // Always a little alive: a slow private wobble on top of wherever it is going.
      const wob = reduced ? 0 : 0.012 + 0.01 * (1 - c);
      tx += Math.sin(t * 0.9 * d.sp + d.ph) * wob; ty += Math.cos(t * 0.7 * d.sp + d.ph * 1.7) * wob;
      tx = cx + tx * unit; ty = cy + ty * unit;
      if (reduced || Number.isNaN(d.x)) { d.x = tx; d.y = ty; }
      else {   // a soft spring: eased in, a breath of overshoot, never a snap
        d.vx = d.vx * 0.86 + (tx - d.x) * d.k; d.vy = d.vy * 0.86 + (ty - d.y) * d.k;
        d.x += d.vx; d.y += d.vy;
      }
      const lit = d.role !== 'f' || shapeMix > 0.3;
      // A form's near side is brighter and larger than its far side: depth reads without lines.
      const near = d.role === 'p' ? 0.45 + depth * 0.75 : 1;
      ctx.globalAlpha = Math.min(1, (lit ? 0.95 : 0.5) * (d.role === 'p' ? 0.9 : d.glow) * near * flicker);
      const sz = dotR * (d.role === 'p' ? 0.8 + depth * 1.1 : d.size * 0.8) * (lit ? 4.6 : 4.2);
      ctx.drawImage(lit ? spr : fieldSpr, d.x - sz / 2, d.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Vignette and scanlines.
    const vg = ctx.createRadialGradient(cx, h / 2, unit * 0.6, cx, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    if (grainTile && w > 120) { ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, w, h); }
    if (spec.hud && w > 220) {
      const m = Math.max(10, Math.round(unit * 0.07));
      ctx.font = `500 ${Math.max(10, Math.round(unit * 0.055))}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.textBaseline = 'top';
      ctx.fillText(`[ ${state.toUpperCase()} ]`, m, m);
      if (detail) { ctx.fillStyle = P.dim; ctx.textBaseline = 'bottom'; ctx.fillText(detail, m, h - m); }
      ctx.fillStyle = P.dim; ctx.textBaseline = 'top'; ctx.textAlign = 'right';
      ctx.fillText(spec.name.toUpperCase(), w - m, m); ctx.textAlign = 'left';
    }
    // Long idle on a quiet screen: settle further toward noise.
    if (state === 'idle' && now - lastEvent > 120000) target = { ...states.idle, c: 0.3 };
  }

  function set(next, info = '') {
    state = states[next] ? next : 'idle';
    target = states[state];
    detail = info || '';
    lastEvent = performance.now();
  }

  resize();
  // A turned phone or a resized window: re-measure, so the face stays round and centred and only the field widens.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);
  raf = requestAnimationFrame(frame);
  /** Gather into `pts` ([x, y] in face units, about -1…1) in `color` for `ms`, then flow back. */
  const shape = (pts, color, ms = 1800) => { if (pts?.length) shapeOn = { pts, rgb: hex(color || spec.palette.accent), until: performance.now() + ms }; };
  return { set, shape, level: v => { level = Math.max(0, Math.min(1, Number(v) || 0)); }, resize, stop: () => { stopped = true; cancelAnimationFrame(raf); ro?.disconnect(); }, spec, get state() { return state; } };
}

/** The hive's state for this viewer, from /api/face/stream; calls back with {state, detail}. Returns a closer. */
function faceFeed(onState) {
  let es = null, closed = false;
  const open = () => {
    if (closed) return;
    es = new EventSource('/api/face/stream');
    es.onmessage = e => { try { onState(JSON.parse(e.data)); } catch { /* a heartbeat it could not read */ } };
    es.onerror = () => { es.close(); if (!closed) setTimeout(open, 5000); };
  };
  open();
  return () => { closed = true; es?.close(); };
}

/** This screen's face: the hive's or this screen's (`face.spec`, settings-schema.js — an edition carries one), under
 *  a spec kept in this browser (localStorage `doca.face.spec`), over the default. Fetched without the panel's helpers,
 *  since /face loads only this file. */
async function faceSpec() {
  let shared = {}, local = {};
  try { const r = await fetch('/api/screen', { credentials: 'same-origin' }); if (r.ok) shared = (await r.json()).settings?.face?.spec || {}; } catch { /* the default */ }
  try { local = JSON.parse(localStorage.getItem('doca.face.spec') || '{}'); } catch { /* the default */ }
  return { ...shared, ...local };
}


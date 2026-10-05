/* ═══════════════════════════════════════════════════════
   The face (docs/design/hive.md §5; TODO H8.1): a field of luminous dots that
   drifts like noise when nothing is happening and coalesces into a face — two
   eye clusters and a mouth line — when the hive pays attention. Order out of
   noise. Canvas 2D, so it runs on an old tablet, a TV in kiosk mode, the
   panel's corner and (later) a watch.

   A face is a small JSON (FACE_DEFAULT): palette, dot count, eye and mouth
   geometry, HUD and grain, and per-state overrides — editable, and a pack.
   faceMount(canvas, spec) → { set(state, detail), level(0..1), resize(), stop() }
   ═══════════════════════════════════════════════════════ */

const FACE_DEFAULT = {
  name: 'Protolab',
  palette: { bg: '#050507', ink: '#e8edf2', dim: '#707a85', accent: '#57c9c2', steel: '#6f8aa3', ask: '#e8a020', error: '#e85050' },
  dots: 220,
  eyes: { y: -0.16, gap: 0.40, r: 0.10 },
  mouth: { y: 0.30, w: 0.46, curve: 0.06 },
  hud: true,
  grain: true,
  states: {},
};

/** How each state draws: coherence (0 noise … 1 face), eye openness, mouth motion, ring spin, colour, drift speed. */
const FACE_STATES = {
  idle:     { c: 0.42, eye: 1.0, mouth: 0.0, spin: 0.00, color: 'accent', drift: 0.25, blink: true },
  thinking: { c: 0.80, eye: 0.55, mouth: 0.0, spin: 0.15, color: 'accent', drift: 0.35, orbit: true },
  working:  { c: 0.72, eye: 0.8, mouth: 0.0, spin: 0.9, color: 'steel', drift: 0.3 },
  speaking: { c: 0.92, eye: 1.0, mouth: 1.0, spin: 0.0, color: 'accent', drift: 0.2 },
  asking:   { c: 0.95, eye: 1.25, mouth: 0.0, spin: 0.0, color: 'ask', drift: 0.15, lookUp: true },
  listening:{ c: 0.95, eye: 1.0, mouth: 0.0, spin: 0.0, color: 'accent', drift: 0.15, pulse: true },
  error:    { c: 0.30, eye: 0.6, mouth: 0.0, spin: 0.0, color: 'error', drift: 0.9, flicker: true },
  quiet:    { c: 0.35, eye: 0.3, mouth: 0.0, spin: 0.0, color: 'dim', drift: 0.05 },
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

  // Dots: a role (left eye, right eye, mouth, field), a seat in the face and a wandering point in the noise.
  const rnd = _faceRand(7);
  const n = Math.max(40, Math.min(600, spec.dots | 0));
  const eyeN = Math.round(n * 0.16), mouthN = Math.round(n * 0.14);
  const dots = Array.from({ length: n }, (_, i) => {
    const role = i < eyeN ? 'le' : i < eyeN * 2 ? 're' : i < eyeN * 2 + mouthN ? 'm' : 'f';
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
    let fx, fy;
    if (role === 'le' || role === 're') { fx = Math.cos(a) * r * spec.eyes.r; fy = Math.sin(a) * r * spec.eyes.r; }
    else if (role === 'm') { const t = (i - eyeN * 2) / Math.max(1, mouthN - 1); fx = (t - 0.5) * spec.mouth.w; fy = (rnd() - 0.5) * 0.02; }
    else { const ang = rnd() * Math.PI * 2, rr = 0.72 + rnd() * 0.22; fx = Math.cos(ang) * rr; fy = Math.sin(ang) * rr * 1.08; }
    return { role, fx, fy, t: (i - eyeN * 2) / Math.max(1, mouthN - 1), nx: rnd() * 2 - 1, ny: rnd() * 2 - 1, ph: rnd() * 1000, sp: 0.4 + rnd(), size: 0.6 + rnd() * 0.8, x: 0, y: 0 };
  });

  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const v = m ? parseInt(m[1], 16) : 0xffffff; return [v >> 16, (v >> 8) & 255, v & 255]; };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
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
    const t = now / 1000;
    const k = reduced ? 1 : 0.06;
    for (const key of ['c', 'eye', 'mouth', 'spin', 'drift']) cur[key] += (target[key] - cur[key]) * k;
    const want = hex(spec.palette[target.color] || spec.palette.accent);
    cur.colorRGB = cur.colorRGB ? cur.colorRGB.map((v, i) => v + (want[i] - v) * 0.08) : want;
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
    const ink = hex(P.ink);
    const dotR = Math.max(0.8, unit * 0.011);
    const spin = t * cur.spin;
    for (const d of dots) {
      // The noise: each dot wanders on its own slow curve.
      const dr = reduced ? 0 : cur.drift;
      const nx = d.nx + Math.sin(t * 0.21 * d.sp + d.ph) * 0.35 * dr * 2;
      const ny = d.ny + Math.cos(t * 0.17 * d.sp + d.ph * 1.3) * 0.35 * dr * 2;
      // The face.
      let fx = d.fx, fy = d.fy;
      if (d.role === 'le' || d.role === 're') {
        fx += (d.role === 'le' ? -1 : 1) * spec.eyes.gap / 2; fy = spec.eyes.y + d.fy * eyeOpen + (target.lookUp ? -0.04 : 0);
      } else if (d.role === 'm') {
        const curve = spec.mouth.curve * (1 - Math.pow(d.t * 2 - 1, 2));
        const talk = cur.mouth * (0.05 + level * 0.12) * Math.sin(t * 14 + d.t * 6) * (1 - Math.abs(d.t * 2 - 1));
        fy = spec.mouth.y + curve + talk + d.fy;
      } else {
        const a = Math.atan2(d.fy, d.fx) + spin + (target.orbit ? t * 0.1 : 0), rr = Math.hypot(d.fx, d.fy);
        fx = Math.cos(a) * rr; fy = Math.sin(a) * rr;
      }
      const c = d.role === 'f' ? cur.c * 0.8 : cur.c;
      d.x = cx + (nx + (fx - nx) * c) * unit;
      d.y = cy + (ny + (fy - ny) * c) * unit;
      const a = (d.role === 'f' ? 0.4 : 0.95) * flicker;
      if (d.role !== 'f') {   // only the face glows; the field stays fine grain
        ctx.fillStyle = `rgba(${r},${g},${b},${0.1 * a})`;
        ctx.beginPath(); ctx.arc(d.x, d.y, dotR * 2.6 * d.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = d.role === 'f' ? `rgba(${ink[0]},${ink[1]},${ink[2]},${0.3 * a})` : `rgba(${r},${g},${b},${a})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, dotR * (d.role === 'f' ? 0.7 : 1) * d.size, 0, Math.PI * 2); ctx.fill();
    }
    // Vignette and scanlines.
    const vg = ctx.createRadialGradient(cx, h / 2, unit * 0.6, cx, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)');
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
  raf = requestAnimationFrame(frame);
  return { set, level: v => { level = Math.max(0, Math.min(1, Number(v) || 0)); }, resize, stop: () => { stopped = true; cancelAnimationFrame(raf); }, spec, get state() { return state; } };
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


/* The face at rest on an ambient screen (asked 2026-10-06): a galaxy turning slowly in the bottom fifth of the screen,
   seen from about ten degrees above its plane, its light gathered at the centre and thinning along two soft arms.
   When the screen is called the points rise to the middle and become the polyhedron (face/poly.js) a call shows;
   when nothing more is asked they go back down and turn again. face.js asks the form where each point should be:
   `rise` (0 resting … 1 called) is eased there, so the journey is a spring, never a jump. */

/** `n` stars of a two-armed disc galaxy: radius (dense at the centre), angle, height above the plane, size, drift. */
function faceGalaxyStars(n, rnd) {
  const gauss = () => { let s = 0; for (let k = 0; k < 4; k++) s += rnd(); return (s - 2) / 1.15; };
  return Array.from({ length: n }, (_, i) => {
    const kind = i % 20 < 3 ? 'bulge' : i % 20 < 7 ? 'haze' : 'arm';   // the round heart, the light between the arms, the arms
    if (kind === 'bulge') {
      const r = Math.abs(gauss()) * 0.09;
      return { r, a: rnd() * 6.283, h: gauss() * 0.05 * Math.max(0.2, 1 - r / 0.2), size: 1.05, w: 0.6 + rnd() * 0.8, ph: rnd() * 6.283 };
    }
    const r = Math.min(1, 0.05 + -Math.log(1 - rnd() * 0.95) * 0.3);
    const arm = i % 2 ? Math.PI : 0, wind = Math.log(r + 0.08) * 1.9;   // a logarithmic spiral, tighter towards the centre
    const a = kind === 'haze' ? rnd() * 6.283 : arm + wind + gauss() * (0.22 + (1 - r) * 0.25);
    return { r, a, h: gauss() * 0.018 * (1.1 - r), size: 0.95 - r * 0.45, w: 0.6 + rnd() * 0.8, ph: rnd() * 6.283 };
  });
}

/** The galaxy alone: at(i) → [x, y, depth 0..1] in face units, centred where frame() puts it. */
function faceGalaxyForm(n, rnd) {
  const stars = faceGalaxyStars(n, rnd);
  const TILT = 10 * Math.PI / 180, sinT = Math.sin(TILT), cosT = Math.cos(TILT);
  let angle = 0, last = 0;
  return {
    frame(t, { spin = 0, level = 0, ax = 1.15, ay = 1.15, breath = 0.08 } = {}) {
      const dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      angle += dt * (0.05 + spin * 0.25);   // slow: a galaxy is not a wheel
      // As wide as the screen allows, sitting in its bottom fifth.
      this.R = Math.min(ax * 0.86, ay * 1.1) * (1 + Math.sin(t * 0.4) * breath * 0.12 + level * 0.06);
      this.cy = ay - ay * 2 * 0.1;   // the middle of the bottom fifth
      this.t = t;
      this.halo = { x: 0, y: this.cy, rx: this.R * 0.3, ry: this.R * 0.3 * 0.32, a: 0.16 };   // the heart's soft light
    },
    at(i) {
      const s = stars[i % n];
      // Inner stars go round faster (a little differential turning on a rigid pattern, so the arms stay arms).
      const a = s.a + angle * (1 + 0.6 / (0.35 + s.r * 3)) + Math.sin(this.t * 0.3 * s.w + s.ph) * 0.01;
      const x = Math.cos(a) * s.r, z = Math.sin(a) * s.r;   // the disc's plane: x across, z towards the viewer
      const sy = -s.h * cosT + z * sinT, depth = (z * cosT + 1) / 2;
      const persp = 1 / (1 - z * cosT * 0.12);
      return [x * this.R * persp, this.cy + sy * this.R * persp, depth, s.size];
    },
  };
}

/** Resting as a galaxy, called as the polyhedron: each point travels between its two places by `rise`, staggered. */
function faceAmbientForm(n, rnd) {
  const galaxy = faceGalaxyForm(n, rnd), poly = facePolyForm(n, rnd);
  const lag = Array.from({ length: n }, () => rnd() * 0.35);
  const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  return {
    frame(t, o = {}) {
      this.rise = Math.max(0, Math.min(1, o.rise || 0)); galaxy.frame(t, o); poly.frame(t, o);
      this.halo = this.rise < 0.98 ? { ...galaxy.halo, a: galaxy.halo.a * (1 - this.rise) } : null;
    },
    at(i) {
      const g = galaxy.at(i);
      if (this.rise < 0.001) return g;
      const p = poly.at(i), m = ease(Math.max(0, Math.min(1, (this.rise - lag[i]) / 0.65)));
      if (m >= 1) return p;   // (the polyhedron's points keep their own size)
      const swirl = Math.sin(m * Math.PI) * 0.25;   // a little sideways on the way, so they flow rather than slide
      return [g[0] + (p[0] - g[0]) * m + swirl * (i % 2 ? 1 : -1) * 0.4, g[1] + (p[1] - g[1]) * m, g[2] + (p[2] - g[2]) * m, g[3] + (1 - g[3]) * m];
    },
  };
}

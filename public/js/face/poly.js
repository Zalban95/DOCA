/* The face as a form of light (asked 2026-10-05, after protolab.tech): a polyhedron drawn by points along its edges,
   turning in 3D, breathing in and out, and slowly becoming another — tetrahedron, cube, octahedron, icosahedron.
   face.js asks it where each point should be; the states change how fast it turns, how much it breathes, how tightly
   it holds together. `spec.form: "face"` keeps the earlier eyes-and-mouth face. */
const FACE_POLYHEDRA = (() => {
  const p = (1 + Math.sqrt(5)) / 2, s = [-1, 1];
  const cube = [], ico = [];
  for (const x of s) for (const y of s) for (const z of s) cube.push([x, y, z]);
  for (const a of s) for (const b of s) ico.push([0, a, b * p], [a, b * p, 0], [b * p, 0, a]);
  return {
    tetra: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    cube,
    octa: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
    icosa: ico,
  };
})();

/** `n` points spread evenly along the edges of a polyhedron (its shortest vertex-to-vertex links), radius ~1. */
function facePolyPoints(vertices, n, rnd) {
  const norm = Math.max(...vertices.map(v => Math.hypot(...v)));
  const vs = vertices.map(v => v.map(c => c / norm));
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let min = Infinity;
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) min = Math.min(min, d(vs[i], vs[j]));
  const edges = [];
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) if (d(vs[i], vs[j]) < min * 1.01) edges.push([vs[i], vs[j]]);
  const total = edges.length * min;
  return Array.from({ length: n }, (_, k) => {
    const at = (k + rnd() * 0.5) / n * total, e = edges[Math.min(edges.length - 1, Math.floor(at / min))], f = (at % min) / min;
    const j = () => (rnd() - 0.5) * 0.035;   // a little thickness: a line of light, not a wire
    return [e[0][0] + (e[1][0] - e[0][0]) * f + j(), e[0][1] + (e[1][1] - e[0][1]) * f + j(), e[0][2] + (e[1][2] - e[0][2]) * f + j()];
  });
}

/** The form for `n` points: at(i, t, motion) → [x, y, depth 0..1] in face units. */
function facePolyForm(n, rnd) {
  const names = Object.keys(FACE_POLYHEDRA);
  const sets = names.map(k => facePolyPoints(FACE_POLYHEDRA[k], n, rnd));
  const HOLD = 9, MORPH = 3.5;   // seconds as one shape, seconds becoming the next
  let angle = 0, last = 0;
  const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  return {
    /** Called once a frame before at(): turning speed, breathing and the voice's level move the whole form. */
    frame(t, { spin = 0, breath = 0.08, level = 0, scale = 1 } = {}) {
      const dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      angle += dt * (0.22 + spin * 0.9);
      const cycle = HOLD + MORPH, k = Math.floor(t / cycle), within = t - k * cycle;
      this.a = sets[k % sets.length]; this.b = sets[(k + 1) % sets.length];
      this.mix = within < HOLD ? 0 : ease((within - HOLD) / MORPH);
      this.s = 0.62 * scale * (1 + Math.sin(t * 0.75) * breath + level * 0.22);
      const ax = angle * 0.7 + Math.sin(t * 0.13) * 0.4, ay = angle;
      this.cx = Math.cos(ax); this.sx = Math.sin(ax); this.cy = Math.cos(ay); this.sy = Math.sin(ay);
    },
    at(i) {
      const A = this.a[i % n], B = this.b[i % n], m = this.mix;
      let x = A[0] + (B[0] - A[0]) * m, y = A[1] + (B[1] - A[1]) * m, z = A[2] + (B[2] - A[2]) * m;
      [x, z] = [x * this.cy + z * this.sy, -x * this.sy + z * this.cy];   // turn about y
      [y, z] = [y * this.cx - z * this.sx, y * this.sx + z * this.cx];   // and about x
      const persp = 1 / (1 + z * 0.28);
      return [x * this.s * persp, y * this.s * persp, (z + 1) / 2];
    },
  };
}

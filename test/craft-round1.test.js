'use strict';

/**
 * The craft templates after round 1 of 2026-10-16, held without FreeCAD, CADCraft or Blender: hole tags clear of the
 * line work around them (a countersink's ring, a nut trap's hexagon) or left off on request, notes and title block
 * values that stay in their room, a STEP with no geometry said as such, a part's own way into a promo, and a promo's
 * frames kept out of the video's folder. The FreeCAD runner refuses a script a snap could not see.
 */
const H      = require('./helpers');   // first: it points the data folder at a temporary one
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const DRAW = path.join(ROOT, 'skills/technical-drawing/scripts/lib');
const VIDEO = path.join(ROOT, 'skills/product-video/scripts/lib');
const { compose } = require(path.join(DRAW, 'compose'));
const T = require(path.join(DRAW, 'tags'));
const S = require(path.join(DRAW, 'sheet'));
const P = require(path.join(VIDEO, 'plan'));
void H;

test.after(() => H.stop());

/** A plate with holes, each with a countersink ring and a hexagonal nut trap around it, as project.py writes them. */
function plate({ holes = 4, w = 120, h = 80 } = {}) {
  const rect = [[-w / 2, -h / 2, w / 2, -h / 2], [w / 2, -h / 2, w / 2, h / 2], [w / 2, h / 2, -w / 2, h / 2], [-w / 2, h / 2, -w / 2, -h / 2]].map(([a, b, c, d]) => ({ t: 'l', a: [a, b], b: [c, d] }));
  const hs = Array.from({ length: holes }, (_, i) => ({ c: [-w / 2 + 8 + (i % 2) * (w - 16), -h / 2 + 8 + Math.floor(i / 2) * (h - 16)], d: 3.4, depth: 6, through: true }));
  const rings = hs.flatMap(x => [{ t: 'c', c: x.c, r: 1.7 }, { t: 'c', c: x.c, r: 3.2 },
    ...Array.from({ length: 6 }, (_, k) => { const a0 = k * Math.PI / 3, a1 = (k + 1) * Math.PI / 3, R = 3.3;
      return { t: 'l', a: [x.c[0] + R * Math.cos(a0), x.c[1] + R * Math.sin(a0)], b: [x.c[0] + R * Math.cos(a1), x.c[1] + R * Math.sin(a1)] }; })]);
  const view = (bw, bh, extra = {}) => ({ bbox: [-bw / 2, -bh / 2, bw / 2, bh / 2], visible: [], hidden: [], ...extra });
  return { views: {
    front: view(w, h, { rel: 'front', basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], holes: hs, visible: [...rect, ...rings] }),
    side: view(6, h, { rel: 'right' }), iso: view(w, h, { rel: 'iso' }),
  } };
}

test('a hole tag sits outside the outermost ring around its hole, and no line or word runs through it', () => {
  const proj = plate();
  const c = compose({ sheet: 'A3', title: { part: 'Plate' } }, proj);
  const tags = c.entities.filter(e => e.k === 'text' && e.layer === 'TAG');
  assert.equal(tags.length, 4, c.report.left_out.join('; '));
  const others = c.entities.filter(e => !tags.includes(e) && !(e.k === 'line' && e.layer === 'DIM' && e.pts.length === 2 && tags.some(t => Math.hypot(e.pts[1][0] - t.at[0], e.pts[1][1] - t.at[1]) < 20)));
  const obs = T.obstacles(others);
  const front = c.placed.front;
  for (const t of tags) {
    const b = T.textBox(t);
    assert.ok(!obs.segs.some(s => T.segHitsBox(s, b)), `a line runs through ${t.text} at ${t.at.map(Math.round)}`);
    // Outside the nut trap: no corner of the tag within the ring's radius of a hole centre.
    for (const h of proj.views.front.holes) {
      const cc = [front.origin[0] + h.c[0] * front.scale, front.origin[1] + h.c[1] * front.scale];
      const near = Math.min(...[[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(p => Math.hypot(p[0] - cc[0], p[1] - cc[1])));
      assert.ok(near > 3.3 * front.scale - 0.01, `${t.text} sits inside a nut trap (${near.toFixed(2)} mm from its centre)`);
    }
  }
  assert.ok(Math.abs(T.outerRadius(proj.views.front.holes[0], proj.views.front.visible) - 3.3) < 1e-9, 'the hexagon is the outermost ring');
});

test('hole_tags: false leaves the tags off and the hole table without letters', () => {
  const c = compose({ sheet: 'A3', hole_tags: false }, plate());
  assert.equal(c.entities.filter(e => e.layer === 'TAG').length, 0);
  const table = c.entities.filter(e => e.k === 'text' && /THRU/.test(e.text));
  assert.equal(table.length, 1);
  assert.match(table[0].text, /^4× Ø3\.4 THRU$/);
});

test('notes wrap inside their room, a long word too; a title block value too long is set smaller, then cut and said', () => {
  const long = 'Keyholes 120 mm apart: entry dia 9, slide 12 mm down to lock on the screw shank; '.repeat(3) + 'X'.repeat(140);
  const c = compose({ sheet: 'A3', notes: [long], title: { part: 'Plate', project: 'P'.repeat(200), material: 'PETG or PLA, black, 0.2 mm layers' } }, plate());
  const notes = c.entities.filter(e => e.k === 'text' && e.h === 2.6 && e.at[0] < c.boxes.title[0]);
  for (const n of notes) assert.ok(T.textBox(n)[2] <= c.boxes.title[0] + 0.01, `a note line runs into the title block: "${n.text.slice(0, 30)}…"`);
  assert.match(c.report.warnings.join(' '), /title block: project too long for its cell/);
  const material = c.entities.find(e => e.k === 'text' && /^PETG or PLA/.test(e.text));
  assert.ok(material.h < 2.8 && T.textBox(material)[2] <= c.boxes.title[0] + 70, 'the material is set smaller to fit its cell');
  assert.deepEqual(S.wrap('a ' + 'b'.repeat(25), 10), ['a', 'bbbbbbbbb-', 'bbbbbbbbb-', 'bbbbbbb']);
});

test('a STEP with a header and no geometry is said as such, before FreeCAD runs', () => {
  const { assertPart } = require(path.join(DRAW, 'part-check'));
  const dir = fs.mkdtempSync(path.join(H.tmp, 'step-'));
  const empty = path.join(dir, 'empty.step'), full = path.join(dir, 'full.step');
  const head = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('FreeCAD Model'),'2;1');\nENDSEC;\nDATA;\n#1 = APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#2);\n";
  fs.writeFileSync(empty, head + 'ENDSEC;\nEND-ISO-10303-21;\n');
  fs.writeFileSync(full, head + "#2 = MANIFOLD_SOLID_BREP('',#3);\n#4 = ADVANCED_FACE('',(#5),#6,.F.);\nENDSEC;\nEND-ISO-10303-21;\n");
  assert.throws(() => assertPart(empty), /no geometry in empty\.step: the STEP file has its header and 1 record\(s\) but no face or solid.*Import\.export/);
  assert.doesNotThrow(() => assertPart(full));
  assert.throws(() => assertPart(path.join(dir, 'none.step')), /no part at/);
});

test('a promo part may come its own way; a one-axis spec is unchanged, a wrong one is refused before rendering', () => {
  assert.deepEqual(P.motion({ parts: [{ path: 'a' }, { path: 'b' }] }).map(m => m.from), ['along [0,0,1]']);
  const m = P.motion({ explode_axis: [0, 1, 0], parts: [{ path: 'panel' }, { path: 'clip', via: [[0, 0, 40], [0, -12, 40]] }, { path: 'fan', axis: [-1, 0, 0], distance: 60 }, { path: 'lid' }] });
  assert.deepEqual(m.map(x => x.from), ['via [0, 0, 40] → [0, -12, 40]', 'along [-1,0,0], 60 mm out', 'along [0,1,0]']);
  assert.throws(() => P.motion({ parts: [{ path: 'a', axis: [1, 0, 0] }, { path: 'b' }] }), /the first part stays/);
  assert.throws(() => P.motion({ parts: [{ path: 'a' }, { path: 'b', axis: [0, 0, 0] }] }), /"axis" is a direction/);
  assert.throws(() => P.motion({ parts: [{ path: 'a' }, { path: 'b', via: [[1, 2]] }] }), /"via" is a list of points/);
  assert.throws(() => P.motion({ parts: [{ path: 'a' }, { path: 'b', via: [[1, 2, 3]], axis: [1, 0, 0] }] }), /not both/);
  const scene = fs.readFileSync(path.join(ROOT, 'skills/product-video/scripts/scene.py'), 'utf8');
  assert.match(scene, /def route\(i\)/, 'the scene reads each part\'s own way');
});

test('a promo\'s frames are kept out of the video\'s folder, in the data folder, the newest few', () => {
  const W = require(path.join(VIDEO, 'work'));
  const out = path.join(H.tmp, 'deliver', 'promo.mp4');
  const dir = W.dirFor({ out });
  assert.ok(!dir.startsWith(path.dirname(out)), `frames beside the video: ${dir}`);
  assert.ok(dir.startsWith(path.join(process.env.DOCA_DATA_DIR, 'renders')), dir);
  assert.equal(W.dirFor({ out, work: '/x/frames' }), '/x/frames');
  for (let i = 0; i < W.KEEP + 2; i++) { const d = W.dirFor({ out: `/v/${i}.mp4` }); fs.mkdirSync(d, { recursive: true }); const t = new Date(Date.now() - (10 - i) * 1000); fs.utimesSync(d, t, t); }
  assert.equal(W.prune().length, 2);
  assert.equal(fs.readdirSync(W.root()).length, W.KEEP);
});

test('the FreeCAD runner refuses a script a snap FreeCAD cannot see, before running anything', () => {
  const { execFileSync } = require('node:child_process');
  const fake = path.join(H.tmp, 'snap', 'bin', 'freecad.cmd');   // never run: the refusal comes first
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const script = path.join(require('node:os').tmpdir(), `fc-${process.pid}.py`);
  fs.writeFileSync(script, 'print(1)\n');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'skills/freecad-modelling/scripts/run.js'), '--freecad', fake, script], { stdio: 'pipe' });
    assert.fail('it ran');
  } catch (e) {
    assert.equal(e.status, 2);
    assert.match(String(e.stderr), /a snap FreeCAD has a \/tmp of its own/);
  } finally { fs.rmSync(script, { force: true }); }
});

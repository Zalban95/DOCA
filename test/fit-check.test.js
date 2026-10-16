'use strict';

/**
 * The fit check (modules/checks/fit.js): an assembly's parts and the thing they hold, measured in millimetres — overlap,
 * the clearance on each side, screws through their holes. The parts are made here as boxes written as STL bytes: a
 * tray of a floor and four walls (separate bodies touching face to face, as a multi-body export is), a tablet as a box.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const fs     = require('node:fs');
const path   = require('node:path');
const checks = require('../modules/checks');
const G      = require('../modules/checks/fit-geom');

test.after(() => H.stop());

const DIR = path.join(H.tmp, 'fit-check');
fs.mkdirSync(DIR, { recursive: true });
const at = f => path.join(DIR, f);

// A box's twelve triangles, outward-facing, from its lowest corner o and its size s.
const CUBE = (s, o = [0, 0, 0]) => {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(p => p.map((c, i) => c * s[i] + o[i]));
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.map(t => t.map(i => v[i]));
};
function stl(tris) {
  const b = Buffer.alloc(84 + tris.length * 50);
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, j) => p.forEach((c, k) => b.writeFloatLE(c, 84 + i * 50 + 12 + j * 12 + k * 4))));
  return b;
}

// The tray: floor 210 × 135 × 2, walls 3 mm thick and 10 high standing on it; the pocket inside is 204 × 129.
const TRAY = [...CUBE([210, 135, 2]), ...CUBE([3, 135, 10], [0, 0, 2]), ...CUBE([3, 135, 10], [207, 0, 2]),
  ...CUBE([204, 3, 10], [3, 0, 2]), ...CUBE([204, 3, 10], [3, 132, 2])];
fs.writeFileSync(at('tray.stl'), stl(TRAY));
// An ear with a gap a screw goes through: 3.4 wide (a clear hole for M3), and one 2.5 wide (a pilot it bites).
fs.writeFileSync(at('ear-clear.stl'), stl([...CUBE([10, 10, 3], [0, 0, 0]), ...CUBE([10, 10, 3], [13.4, 0, 0])]));
fs.writeFileSync(at('ear-pilot.stl'), stl([...CUBE([10, 10, 3], [0, 0, 3]), ...CUBE([10, 10, 3], [12.5, 0, 3])]));
fs.writeFileSync(at('block.stl'), stl(CUBE([30, 10, 3], [0, 0, 6])));

test('the geometry: winding, not parity — two bodies touching face to face read as one solid', () => {
  const tris = G.place({ positions: Float64Array.from(TRAY.flat(2)), triangles: Uint32Array.from({ length: TRAY.length * 3 }, (_, i) => i) });
  const hits = G.lines(tris, 2, 2);
  assert.deepEqual(G.inside(hits(1.5, 50)), [[0, 12]], 'floor and wall are one interval along z');
  assert.deepEqual(G.inside(hits(100, 50)), [[0, 2]], 'only the floor in the pocket');
  const turned = G.rotator([0, 0, 90])([1, 0, 0]).map(v => Math.round(v * 1e9) / 1e9);
  assert.deepEqual(turned, [0, 1, 0], 'rotation is degrees about X, Y, Z');
});

test('a tablet in the pocket: no overlap, 2 mm a side, the back resting on the floor, the front open', async () => {
  const r = await checks.run({ fit: at('tray.stl'), held: { box: [200, 125, 8], at: [5, 5, 2], name: 'the tablet' }, clearance: { min: 0.2, max: 2.5 }, sides: ['+x', '-x', '+y', '-y'] });
  assert.equal(r.ok, true, r.why);
  assert.match(r.why, /interference with the tablet: 0 mm³/);
  assert.match(r.why, /\+x 2–2 mm over 100%/);
  assert.match(r.why, /-z 0–0 mm over 100%/);
  assert.match(r.why, /\+z open/);
  const tight = await checks.run({ fit: at('tray.stl'), held: { box: [200, 125, 8], at: [5, 5, 2] }, clearance: { max: 0.6 }, sides: ['+x'] });
  assert.equal(tight.ok, false);
  assert.match(tight.why, /\+x: 2 mm at the loosest, over the 0\.6 mm asked/);
});

test('a tablet too large for the pocket is said with how much of it is inside the walls', async () => {
  const r = await checks.run({ fit: at('tray.stl'), held: { box: [206, 125, 8], at: [2, 5, 2], name: 'the tablet' } });
  assert.equal(r.ok, false);
  const m = r.why.match(/tray\.stl reaches ([\d.]+) mm³ into the tablet/);
  assert.ok(m, r.why);
  assert.ok(Math.abs(Number(m[1]) - 2 * 1 * 125 * 8) < 40, `about 2000 mm³: ${m[1]}`);
  assert.match(r.why, /-x -1–-1 mm/, 'a part reaching into the box reads as a negative gap');
});

test('parts overlapping each other, and placed by offset and rotation', async () => {
  let r = await checks.run({ fit: at('ear-clear.stl'), parts: [{ path: 'block.stl', offset: [0, 0, -4] }] , maxInterference: 1 }, { cwd: DIR });
  assert.equal(r.ok, false);
  assert.match(r.why, /ear-clear\.stl and block\.stl overlap by \d+/);
  r = await checks.run({ fit: at('ear-clear.stl'), parts: ['block.stl'] }, { cwd: DIR });
  assert.equal(r.ok, true, r.why);
});

test('screws: a clear hole, thread biting a pilot, and a screw with no hole under it', async () => {
  const screw = (x, name) => ({ at: [x, 5, 10], axis: [0, 0, -1], d: 3, length: 12, name });
  let r = await checks.run({ fit: at('ear-clear.stl'), parts: ['ear-pilot.stl'], screws: [screw(11.7, 'M3')] }, { cwd: DIR });
  assert.equal(r.ok, true, r.why);
  assert.match(r.why, /M3: ear-clear\.stl clear hole, ear-pilot\.stl bites 3 mm/);
  r = await checks.run({ fit: at('ear-clear.stl'), parts: ['block.stl'], screws: [screw(11.7, 'M3')] }, { cwd: DIR });
  assert.equal(r.ok, false);
  assert.match(r.why, /M3: no hole in block\.stl — 3 mm of material on its axis/);
  r = await checks.run({ fit: at('ear-clear.stl'), parts: ['block.stl'], screws: [{ ...screw(100, 'lost') }] }, { cwd: DIR });
  assert.match(r.why, /lost meets no part along its 12 mm/);
});

test('a fit check is a plan contract and a check_output kind, refusing what it cannot measure', async () => {
  assert.throws(() => checks.normalize({ fit: 'a.stl' }), /needs something to fit/);
  assert.throws(() => checks.normalize({ fit: 'a.stl', held: { box: [1, 2], at: [0, 0, 0] } }), /held is/);
  assert.throws(() => checks.normalize({ fit: 'a.stl', parts: ['b.stl'], sides: ['up'] }), /sides are/);
  const pc = require('../modules/harness/plan-contracts');
  assert.deepEqual(pc.split({ title: 'Fits', check: { fit: 'a.stl', parts: ['b.stl'], junk: 1 } }).contract.check, { fit: 'a.stl', parts: [{ path: 'b.stl' }] });
  fs.writeFileSync(at('open.stl'), stl(CUBE([10, 10, 10]).slice(0, 10)));
  const r = await checks.run({ fit: at('open.stl'), parts: ['block.stl'] }, { cwd: DIR });
  assert.equal(r.ok, false);
  assert.match(r.why, /could not verify what is inside open\.stl: it is not closed/);
  const tool = require('../modules/harness/toolbox/checks').find(t => t.name === 'check_output');
  const out = await tool.run({ kind: 'fit', path: at('tray.stl'), held: { box: [200, 125, 8], at: [5, 5, 2] } }, { cwd: DIR });
  assert.match(out, /^Holds — tray\.stl: interference with the 200 × 125 × 8 box: 0 mm³/);
});

test('a held object with rounded corners fits a pocket whose corners are filled', async () => {
  fs.writeFileSync(at('tray-corner.stl'), stl([...TRAY, ...CUBE([4, 4, 10], [3, 3, 2])]));   // a block in one corner, as a fillet would be
  const held = { box: [200, 125, 8], at: [5, 5, 2] };
  let r = await checks.run({ fit: at('tray-corner.stl'), held });
  assert.equal(r.ok, false, 'a square corner runs into it');
  assert.match(r.why, /reaches (\d+(\.\d+)?) mm³ into the 200 × 125 × 8 box/);
  r = await checks.run({ fit: at('tray-corner.stl'), held: { ...held, radius: 10 } });
  assert.equal(r.ok, true, r.why);
  assert.throws(() => checks.normalize({ fit: 'a.stl', held: { ...held, radius: 80 } }), /held.radius/);
});

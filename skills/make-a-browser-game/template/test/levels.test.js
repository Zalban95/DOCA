// The game's content, checked without a browser: every level is well formed, names only entities that exist, and can
// be finished with the jump the player really has (config.js REACH). A level a change makes impossible fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Entities extend Phaser's classes; stand-ins let the registry load outside a browser.
const Stand = class {};
globalThis.Phaser = { Physics: { Arcade: { Sprite: Stand, Image: Stand } }, GameObjects: { Sprite: Stand, Image: Stand, Container: Stand, Zone: Stand, Rectangle: Stand }, Scene: Stand };
const { LEVELS } = await import('../src/levels/index.js');
const { LEGEND, SOLID, STAND } = await import('../src/levels/legend.js');
const { ENTITIES } = await import('../src/entities/index.js');
const { STORY } = await import('../src/story.js');
const { REACH } = await import('../src/config.js');
const KINDS = new Set(['enemy', 'item', 'hazard', 'solid']);

test('there are levels, and every entity says what kind it is', () => {
  assert.ok(LEVELS.length > 0, 'no levels at all');
  for (const [name, Cls] of Object.entries(ENTITIES)) assert.ok(KINDS.has(Cls.kind), `entity "${name}" has static kind "${Cls.kind}" — one of ${[...KINDS].join(', ')}`);
});

for (const [i, level] of LEVELS.entries()) {
  const label = `level ${i + 1} "${level.name}"`;

  test(`${label} is well formed`, () => {
    const rows = level.rows;
    assert.ok(Array.isArray(rows) && rows.length >= 10, `${label}: rows is a list of at least 10 strings`);
    const width = rows[0].length;
    rows.forEach((r, n) => assert.equal(r.length, width, `${label}: row ${n} is ${r.length} wide, the first is ${width}`));
    const all = rows.join('');
    assert.equal(all.split('P').length - 1, 1, `${label}: exactly one P (the start)`);
    assert.ok(all.includes('E'), `${label}: at least one E (the exit)`);
    for (const ch of new Set(all)) {
      if (LEGEND[ch]) continue;
      assert.ok(/[a-z]/.test(ch) && level.spawns?.[ch], `${label}: "${ch}" is not in legend.js and not one of its spawns`);
      assert.ok(ENTITIES[level.spawns[ch]], `${label}: "${ch}" spawns "${level.spawns[ch]}", which is not in entities/index.js`);
    }
    if (level.story) assert.ok(STORY[level.story], `${label}: story beat "${level.story}" is not in story.js`);
  });

  test(`${label} can be finished with the player's jump (${REACH.up} up, ${REACH.across} across)`, () => {
    assert.ok(finishable(level), `${label}: no way from P to E with a jump of ${REACH.up} rows up and ${REACH.across} columns across. Lower a ledge, close a gap, or add a bridge cell where a moving platform carries the player.`);
  });
}

test('every story beat has lines to show', () => {
  for (const [k, b] of Object.entries(STORY)) assert.ok(Array.isArray(b.lines) && b.lines.length && b.lines.every(l => typeof l === 'string' && l.trim()), `story beat "${k}" needs lines`);
});

/** A walk over the map: standing places, joined by walking, falling and jumps within REACH. Enemies are ignored. */
function finishable(level) {
  const rows = level.rows, H = rows.length, W = rows[0].length;
  const bridges = new Set((level.bridges || []).map(([c, r]) => `${c},${r}`));
  const at = (c, r) => (c < 0 || c >= W ? '#' : r < 0 ? '.' : r >= H ? null : rows[r][c]);
  const free = (c, r) => r < H && c >= 0 && c < W && !SOLID.has(at(c, r)) && at(c, r) !== '^';
  const stands = (c, r) => free(c, r) && r + 1 < H && (STAND.has(at(c, r + 1)) || bridges.has(`${c},${r + 1}`));
  const land = (c, r) => { while (r < H && free(c, r) && !stands(c, r)) r++; return r < H && stands(c, r) ? r : null; };
  const start = rows.findIndex(r => r.includes('P'));
  const s = { c: rows[start].indexOf('P'), r: land(rows[start].indexOf('P'), start) };
  if (s.r == null) return false;
  const seen = new Set([`${s.c},${s.r}`]), queue = [s];
  const goal = (c, r) => at(c, r) === 'E' || at(c, r - 1) === 'E';
  const clear = (c, from, to) => { for (let r = Math.min(from, to); r <= Math.max(from, to); r++) if (!free(c, r)) return false; return true; };
  while (queue.length) {
    const { c, r } = queue.shift();
    if (goal(c, r)) return true;
    const next = [];
    for (const d of [-1, 1]) if (free(c + d, r)) { const l = land(c + d, r); if (l != null) next.push({ c: c + d, r: l }); }
    for (let up = 0; up <= REACH.up; up++) {
      const peak = r - up - 1;
      if (peak < 0 || !clear(c, r, peak)) break;
      for (const d of [-1, 1]) {
        for (let dx = 1; dx <= REACH.across + 2; dx++) {
          const x = c + d * dx;
          if (!free(x, peak)) break;
          for (let ty = peak + 1; ty < H; ty++) {
            if (!free(x, ty)) break;
            const drop = ty - r;
            if (stands(x, ty) && (r - ty <= up) && dx <= REACH.across + Math.max(0, Math.floor(drop / 2))) { next.push({ c: x, r: ty }); break; }
          }
        }
      }
    }
    for (const n of next) { const k = `${n.c},${n.r}`; if (!seen.has(k)) { seen.add(k); queue.push(n); } }
  }
  return false;
}

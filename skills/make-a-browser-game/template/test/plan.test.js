// The game against its plan (docs/plan.json): every planned enemy, item and boss made (not a stand-in), every world
// with its levels, every picture drawn, every sound and tune, every story beat. While the parts are being made, a
// missing one is a todo — listed, not failed; `npm run test:full` fails on any.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const Stand = class {};
globalThis.Phaser = { Physics: { Arcade: { Sprite: Stand, Image: Stand } }, GameObjects: { Sprite: Stand, Image: Stand, Container: Stand, Zone: Stand, Rectangle: Stand }, Scene: Stand };
const file = new URL('../docs/plan.json', import.meta.url);
const plan = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const full = process.env.GAME_PLAN === 'full';

if (!plan) test('the plan', { skip: 'no docs/plan.json yet — copy docs/plan.example.json and make it the game\'s plan' }, () => {});
else {
  const { ENTITIES } = await import('../src/entities/index.js');
  const { WORLDS } = await import('../src/levels/index.js');
  const { ART } = await import('../src/systems/art.js');
  const { names } = await import('../src/systems/audio.js');
  const { STORY } = await import('../src/story.js');
  const { sfx, tunes } = names();
  const item = (label, ok, why) => test(label, { todo: !ok && !full ? why : false }, () => assert.ok(ok, why));
  for (const family of ['enemies', 'items', 'bosses']) for (const e of plan[family] || []) {
    const C = ENTITIES[e.name];
    item(`${family}: ${e.name}`, C && !C.stub, C ? `${e.name} is still a stand-in (static stub in src/entities/${family}/${e.name}.js)` : `${e.name} is not in src/entities/${family}/ — run node scripts/plan.js`);
  }
  for (const w of plan.worlds || []) {
    const got = WORLDS.find(x => x.name === w.name)?.levels.length || 0;
    item(`world "${w.name}": ${w.levels} levels`, got >= w.levels, `${got} of ${w.levels} levels in src/levels/${w.folder}/ (run node scripts/plan.js after adding one)`);
  }
  for (const t of plan.textures || []) item(`picture: ${t}`, !!ART[t], `"${t}" is not drawn in src/systems/art.js`);
  for (const s of plan.sounds || []) item(`sound: ${s}`, sfx.includes(s), `"${s}" is not in SFX (src/systems/audio.js)`);
  for (const s of plan.tunes || []) item(`tune: ${s}`, tunes.includes(s), `"${s}" is not in TUNES (src/systems/audio.js)`);
  for (const b of plan.story || []) item(`story: ${b}`, !!STORY[b]?.lines?.length, `"${b}" is not in src/story.js`);
}

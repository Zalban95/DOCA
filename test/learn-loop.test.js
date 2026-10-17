'use strict';

/**
 * The learning loop (harness/learn-loop.js; the owner, 2026-10-17): a work chat's job that ends done after real work is
 * read once with no tools, and what it learned is kept as a skill with a notice — routine work, a job that kept a
 * skill itself, a NONE, a name already taken and the switch off keep nothing.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

const call = (id, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const result = (id, content) => ({ role: 'tool', tool_call_id: id, content });

function job(rows, title = 'Export the Blender scene for the engine') {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession(title, { kind: 'work' });
  for (const r of [{ role: 'user', content: 'Export the scene as glTF and load it in the engine.' }, ...rows]) memory.append(s.id, r);
  memory.updateSession(s.id, { brief: 'Exported scene.glb; the engine loads it; scale fixed with apply-transforms.' });
  return s.id;
}
const work = n => Array.from({ length: n }, (_, i) => [call(`c${i}`, 'shell', { command: `blender -b scene.blend --python step${i}.py` }), result(`c${i}`, 'exit 0')]).flat();
const SKILL = `---\nname: export-blender-to-engine\ndescription: Export a Blender scene as glTF that a game engine loads at the right scale.\n---\n# Export Blender to an engine\nUse it when a scene must reach an engine.\n## Steps\n1. Apply transforms.\n2. Export glTF binary.\n## Pitfalls\n- Unapplied scale: the engine reads object scale, so it arrives 100× off.\n## Done when\nThe engine shows it at 1:1.`;

test('a job done after real work is read once, and what it learned is kept as a skill with a notice', async () => {
  const learn = require('../modules/harness/learn-loop');
  const asked = [];
  const id = job([...work(12), call('f', 'shell', { command: 'godot --headless --import' }), result('f', 'exit 1 scale error'), call('g', 'shell', { command: 'godot --import' }), result('g', 'exit 2 again'), ...work(3)]);
  const r = await learn.learn(id, { ask: async o => { asked.push(o); return SKILL; } });
  assert.deepEqual(r, { skill: 'export-blender-to-engine', why: 'kept' });
  assert.match(asked[0].user, /## Setbacks\nshell → exit 1 scale error/);
  assert.match(asked[0].system, /lessons, not a log/);
  const s = require('../modules/harness/skills').read('export-blender-to-engine');
  const file = require('node:fs').readFileSync(require('node:path').join(s.dir, 'SKILL.md'), 'utf8');
  assert.match(file, /Unapplied scale[\s\S]*learned \d{4}-\d\d-\d\d from the work chat "/, 'where it was learned stays in the file');
  assert.deepEqual(await learn.learn(id, { ask: async () => SKILL }), { skill: null, why: 'a skill called export-blender-to-engine exists already' });
});

test('routine work, a job that kept a skill, a NONE and the switch off keep nothing', async () => {
  const learn = require('../modules/harness/learn-loop');
  const never = async () => { throw new Error('not asked'); };
  assert.equal((await learn.learn(job(work(5)), { ask: never })).why, 'routine work');
  assert.equal((await learn.learn(job([...work(25), call('w', 'skill', { action: 'write', name: 'x' }), result('w', 'kept')]), { ask: never })).why, 'it kept a skill itself');
  assert.equal((await learn.learn(job(work(25)), { ask: async () => 'NONE — routine.' })).why, 'the model found nothing new to keep');
  assert.equal((await learn.learn(job(work(25)), { ask: async () => 'Sure! Here are some thoughts.' })).why, 'what came back was not a skill');
  const prefs = require('../modules/utils');
  const p = prefs.loadPrefs(); prefs.savePrefs({ ...p, skillSuggest: { ...(p.skillSuggest || {}), learn: false } });
  assert.equal((await learn.learn(job(work(25)), { ask: never })).why, 'switched off');
});

'use strict';

/**
 * Skills (harness/skills.js): Agent Skills folders, as a manifest in the prompt
 * and loaded on demand.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H      = require('./helpers');
const skills = require('../modules/harness/skills');
const tools  = require('../modules/harness/tools');
const agent  = require('../modules/harness/agent');
const memory = require('../modules/harness/memory');

test.before(() => H.start());
test.after(() => H.stop());

test('the shipped skills load, each with a name and a description', () => {
  const shipped = skills.list().filter(s => s.source === 'shipped');
  assert.deepEqual(shipped.map(s => s.name).sort(), ['android-app', 'make-a-specialist']);
  for (const s of shipped) assert.ok(s.description.length > 20, `${s.name} says when to use it`);
});

test('the prompt carries the manifest, not the bodies; the tool loads a body on demand', async () => {
  const prompt = agent.preview({ message: 'x', sessionId: memory.mainSession().id });
  assert.match(prompt, /# Skills — procedures you load/);
  assert.match(prompt, /- android-app: Build, install, test and debug an Android app/);
  assert.doesNotMatch(prompt, /FATAL EXCEPTION/, 'the body is not in the prompt');
  const work = require('../modules/harness/organization').create({ title: 'W' });
  assert.match(agent.preview({ message: 'x', sessionId: work.id }), /- make-a-specialist:/);

  const body = await tools.call('skill', { action: 'read', name: 'android-app' });
  assert.match(body, /FATAL EXCEPTION/);
  assert.match(await tools.call('skill', { action: 'read', name: 'nope' }), /^Error: No skill called "nope"/);
  assert.match(await tools.call('skill', { action: 'file', name: 'android-app', path: '../make-a-specialist/SKILL.md' }), /outside the skill/);
});

test('the agent keeps a skill; one made here wins over a shipped one; a Claude Code folder imports', async () => {
  assert.match(await tools.call('skill', { action: 'write', name: 'release-doca', description: 'Release DOCA: tests, version, tag, deploy.', body: '1. npm test\n2. bump' }), /kept on this machine/);
  assert.equal(skills.read('release-doca').source, 'local');
  skills.write('android-app', { description: 'My own Android steps.', body: 'Mine.' });
  assert.equal(skills.read('android-app').body, 'Mine.');

  const src = fs.mkdtempSync(path.join(H.tmp, 'claude-skills-'));
  fs.mkdirSync(path.join(src, 'pdf'));
  fs.writeFileSync(path.join(src, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: Fill and read PDF forms.\n---\nUse the script.');
  fs.writeFileSync(path.join(src, 'pdf', 'fill.py'), 'print("fill")');
  fs.mkdirSync(path.join(src, 'not-a-skill'));
  const r = await H.api(null, 'POST', '/api/harness/skills/import', { folder: src });
  assert.deepEqual(r.body.imported.map(x => x.name), ['pdf']);
  assert.match(await tools.call('skill', { action: 'file', name: 'pdf', path: 'fill.py' }), /print\("fill"\)/);
  assert.match((await H.api(null, 'POST', '/api/harness/skills/import', { folder: src })).body.imported[0].skipped, /exists/);
});

test('a specialist sees only the skills its definition names', () => {
  const p = agent.preview({ message: 'x', profile: { id: 'droid', label: 'Droid', systemPrompt: 'Android.', kits: ['shell'], skills: ['android-app'], environment: 'minimal' } });
  assert.match(p, /- android-app:/);
  assert.doesNotMatch(p, /- make-a-specialist:/);
  const none = agent.preview({ message: 'x', profile: { id: 'plain', label: 'Plain', systemPrompt: 'x', kits: ['shell'], environment: 'minimal' } });
  assert.doesNotMatch(none, /# Skills/);
});

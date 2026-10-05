'use strict';

// Every agent knows every tool it holds (TODO H15): what a type holds is what its prompt names, every tool
// says what it is for, shipped specialists name only tools and kits that exist, and the panel can list what
// a type holds and why (modules/harness/tool-roster.js).

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const H      = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('every built-in tool says what it is for in its first sentence — that sentence is all "Your tools" shows', () => {
  const { firstSentence } = require('../modules/harness/turn/tools-section');
  const vague = require('../modules/harness/tools').TOOLS
    .map(t => [t.name, firstSentence(t.description)])
    .filter(([, s]) => s.length < 25);
  assert.deepEqual(vague, [], 'give these tools a first sentence that says what they are for');
});

test('shipped specialists name only tools and kits that exist, and each holds something', () => {
  const registry = require('../modules/agents/registry');
  const { KITS } = require('../modules/harness/kits');
  const names = new Set(require('../modules/harness/tools').describe().map(t => t.name));
  for (const a of registry.list().filter(x => x.builtin)) {
    for (const t of a.tools || []) assert.ok(names.has(t), `${a.id} names ${t}, which is no tool`);
    for (const k of a.kits || []) assert.ok(KITS[k], `${a.id} names kit ${k}, which is no kit`);
    assert.ok(require('../modules/harness/tool-roster').roster(a.id).held.length > 0, `${a.id} holds nothing`);
  }
});

test('a project chat is told about the project tools', () => {
  const projects = require('../modules/projects/store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-aware-'));
  const p = projects.create({ root, name: 'aware' });
  const s = projects.newChat(p.id);
  const prompt = require('../modules/harness/agent').preview({ message: 'x', sessionId: s.id });
  for (const n of ['project', 'git', 'search_files', 'replace_in_files', 'repo_rules'])
    assert.match(prompt, new RegExp(`\\n  ${n}: `), `${n} named to a project chat`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the panel lists what a type holds and why — the same set its turns get', async () => {
  const orch = await H.api(null, 'GET', '/api/harness/agents/orchestrator/tools');
  assert.equal(orch.status, 200);
  const held = Object.fromEntries(orch.body.held.map(t => [t.name, t]));
  assert.ok(held.work_chats && held.computer, 'the Orchestrator coordinates and makes computers');
  assert.match(held.work_chats.why, /every kit/);

  const coder = (await H.api(null, 'GET', '/api/harness/agents/coder/tools')).body;
  const c = Object.fromEntries(coder.held.map(t => [t.name, t]));
  for (const n of ['project', 'git', 'search_files', 'replace_in_files', 'repo_rules', 'shell']) assert.ok(c[n], `coder holds ${n}`);
  assert.match(c.git.why, /Code kit/);
  assert.match(c.mission_plan.why, /every specialist/);
  assert.ok(!c.agent_dispatch && !c.http_fetch, 'nor delegates nor reads the web');

  const tester = (await H.api(null, 'GET', '/api/harness/agents/tester/tools')).body;
  assert.equal(tester.held.find(t => t.name === 'show_media')?.why, 'named in its definition');

  const p = require('../modules/harness/agent').params();
  const { disabledFor } = require('../modules/harness/turn/prompt');
  const profile = { ...require('../modules/agents/missions').profileOf(require('../modules/agents/registry').get('coder')), level: 'specialist' };
  const all = require('../modules/harness/tools').describe().map(t => t.name);
  const off = new Set(disabledFor(profile, p));
  assert.deepEqual(coder.held.map(t => t.name).sort(), all.filter(n => !off.has(n)).sort(), 'the roster is disabledFor\'s answer');

  assert.equal((await H.api(null, 'GET', '/api/harness/agents/nobody/tools')).status, 404);
});

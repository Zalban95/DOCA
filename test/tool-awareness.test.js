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

test('every built-in tool\'s line in "Your tools" says what it is for, whole, in at most 150 characters (audit 2026-10-06, aw 16)', () => {
  const { lineFor } = require('../modules/harness/turn/tools-section');
  const { LEADS } = require('../modules/harness/turn/tool-leads');
  const TOOLS = require('../modules/harness/tools').TOOLS;
  const lines = TOOLS.map(t => [t.name, lineFor(t.name, t.description)]);
  assert.deepEqual(lines.filter(([, s]) => s.length < 25), [], 'give these tools a line that says what they are for');
  assert.deepEqual(lines.filter(([, s]) => s.length > 150 || s.endsWith('…') || !/[.!?]$/.test(s) || /\b(e\.g|i\.e)\.$/.test(s)), [],
    'cut mid-sentence: write a lead for it in turn/tool-leads.js');
  for (const n of Object.keys(LEADS)) assert.ok(TOOLS.some(t => t.name === n), `a lead for ${n}, which is no tool`);
  for (const n of ['work_chats', 'project', 'schedule', 'recipe', 'shell_job']) assert.match(LEADS[n], / — /, `${n} says when to use it`);
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

test('a many-action tool names the field an action is missing (audit 2026-10-06, aw 18)', async () => {
  const tools = require('../modules/harness/tools');
  assert.equal(await tools.call('work_chats', { action: 'send' }), 'Error: work_chats send needs sessionId and message.');
  assert.equal(await tools.call('recipe', { action: 'run' }), 'Error: recipe run needs id.');
  assert.equal(await tools.call('project', { action: 'run' }), 'Error: project run needs command.');
  const wc = tools.TOOLS.find(t => t.name === 'work_chats').parameters.properties;
  for (const k of Object.keys(wc).filter(k => k !== 'action')) assert.ok(wc[k].description, `work_chats.${k} is described`);
});

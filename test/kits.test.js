'use strict';

/**
 * Agents that know their tools (docs/design/agents-and-tools.md, phase 1).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');

const H      = require('./helpers');
const tools  = require('../modules/harness/tools');
const kits   = require('../modules/harness/kits');
const agent  = require('../modules/harness/agent');
const memory = require('../modules/harness/memory');
const paths  = require('../modules/paths');

test.before(() => H.start());
test.after(() => H.stop());

test('every built-in tool is in a kit — adding a tool means placing it, or this fails', () => {
  const loose = tools.TOOLS.map(t => t.name).filter(n => !kits.KIT_OF[n]);
  assert.deepEqual(loose, [], 'add each new tool to KIT_OF in modules/harness/kits.js');
  for (const k of Object.values(kits.KIT_OF)) assert.ok(kits.KITS[k], `unknown kit ${k}`);
});

test('a fresh install\'s prompt names the tools it is offered — canvas and the project tools included (audit N7)', () => {
  const work = require('../modules/harness/organization').create({ title: 'Fresh' });
  for (const sessionId of [work.id, memory.mainSession().id]) {
    const prompt = agent.preview({ message: 'x', sessionId });
    assert.match(prompt, /# Your tools — \d+, by kit/);
    for (const n of ['canvas', 'search_files', 'replace_in_files', 'git', 'project', 'shell', 'work_chats'])
      assert.match(prompt, new RegExp(`\\n  ${n}: `), `${n} in the prompt of ${sessionId}`);
  }
});

test('a specialist type holds its kits: the whole family, a later tool included, and never a forbidden one', () => {
  const coder = { id: 'coder', label: 'Coder', systemPrompt: 'You change code.', kits: ['code'], tools: ['read_file'], environment: 'minimal' };
  const prompt = agent.preview({ message: 'x', profile: coder });
  for (const n of ['search_files', 'replace_in_files', 'git', 'project', 'repo_rules', 'read_file', 'mission_plan'])
    assert.match(prompt, new RegExp(`\\n  ${n}: `), n);
  assert.doesNotMatch(prompt, /\n  shell: /, 'not in its kits');
  const greedy = { ...coder, kits: ['organization', 'panel', 'devices'] };
  const g = agent.preview({ message: 'x', profile: greedy });
  for (const n of ['agent_dispatch', 'settings_propose', 'install_propose', 'ask_device']) assert.doesNotMatch(g, new RegExp(`\\n  ${n}: `), `${n} stays withheld`);
  // A definition saved with kits keeps them.
  const def = require('../modules/agents/registry').normalize({ id: 'blender-eng', role: 'Blender.', kits: ['files', 'shell', '*'] });
  assert.deepEqual(def.kits, ['files', 'shell'], 'no "every kit" for a specialist');
});

test('after an update, the next turn is told what changed in its tools — once', () => {
  const news = require('../modules/harness/turn/tool-news');
  const schema = (name, description) => ({ type: 'function', function: { name, description } });
  assert.equal(news.news('specialist:t', [schema('a', 'A.'), schema('b', 'B.')]), '', 'the first turn: the list says it all');
  const n = news.news('specialist:t', [schema('a', 'A, now better.'), schema('c', 'C.')]);
  assert.match(n, /New: c/);
  assert.match(n, /Changed \(read their description again\): a/);
  assert.match(n, /Gone: b\. If your memory says to use them, correct it/);
  assert.equal(news.news('specialist:t', [schema('a', 'A, now better.'), schema('c', 'C.')]), '', 'said once');
});

test('the control plane asks — in every mode, Unattended included, never "always" — and the tool writes only with that yes', async () => {
  const approval = require('../modules/harness/approval');
  const prefs = JSON.parse(fs.existsSync(paths.PREFS_FILE) ? fs.readFileSync(paths.PREFS_FILE, 'utf8') : '{}');
  prefs.harness = { ...(prefs.harness || {}), approval: { mode: 'unattended', always: ['write_file'] } };
  fs.writeFileSync(paths.PREFS_FILE, JSON.stringify(prefs));
  const g = approval.gate('write_file', { path: paths.PREFS_FILE, content: '{}' });
  assert.ok(g?.forced, 'asked even in Unattended with write_file always allowed');
  assert.equal(g.keys, null, 'and it cannot be remembered as "always"');
  assert.equal(approval.gate('write_file', { path: `${H.tmp}/plain.txt`, content: 'x' }), null, 'an ordinary file does not ask');

  assert.match(await tools.call('write_file', { path: paths.PREFS_FILE, content: '{}' }), /this call was not put to them/);
  const next = JSON.stringify({ ...prefs, note: 'written with a yes' });
  assert.match(await tools.call('write_file', { path: paths.PREFS_FILE, content: next }, [], { approved: true }), /^Wrote/);
  assert.match(fs.readFileSync(paths.PREFS_FILE, 'utf8'), /written with a yes/);
});

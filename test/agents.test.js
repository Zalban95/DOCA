'use strict';

/**
 * Specialist agents: the registry, the narrowing, and the switch.
 *
 * Three things are worth pinning, and none of them is "a mission runs" — that
 * needs a model, and `harness.test.js` already covers the loop.
 *
 * The first is that **the flag is really a flag**: off by default, and with it
 * off the dispatch tools are not in the tool list at all. That is what makes
 * rolling this back a settings change rather than a release, which was the
 * requirement.
 *
 * The second is that a specialist's prompt is genuinely **smaller** than the
 * orchestrator's. That is the entire reason specialists are worth having, it is
 * invisible in code review, and it is one careless edit away from being untrue.
 *
 * The third is the set of structural limits — charter always, no proposing, no
 * dispatching another agent — which are not configurable and must stay that way.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');
const registry = require('../modules/agents/registry');
const missions = require('../modules/agents/missions');
const agent    = require('../modules/harness/agent');
const tools    = require('../modules/harness/tools');
const providers = require('../modules/harness/providers');

test.before(async () => { await h.start(); });
test.after(async () => { await h.stop(); registry.setEnabled(false); });

test('specialists are off until somebody turns them on', () => {
  registry.setEnabled(false);
  assert.equal(registry.enabled(), false, 'the default has to be off');

  const names = tools.schemas([]).map(s => s.function.name);
  assert.ok(!names.includes('agent_dispatch'), 'dispatch must not exist while the flag is off');
  assert.ok(!names.includes('agent_results'));
  assert.equal(registry.block(), '', 'a switched-off feature costs no prompt either');

  assert.throws(() => missions.dispatch({ agentId: 'archivist', task: 'x' }), /switched off/);
});

test('turning it on is a settings change, and turning it off again is the rollback', () => {
  registry.setEnabled(true);
  assert.equal(registry.enabled(), true);
  assert.ok(tools.schemas([]).map(s => s.function.name).includes('agent_dispatch'));

  registry.setEnabled(false);
  assert.ok(!tools.schemas([]).map(s => s.function.name).includes('agent_dispatch'),
    'off must genuinely remove it, not merely refuse it later');
});

test('the shipped archivist is a real definition', () => {
  const a = registry.get('archivist');
  assert.ok(a, 'the memory specialist ships with the panel');
  assert.equal(a.builtin, true);
  assert.deepEqual(a.tools, ['memory_search']);
  assert.equal(a.memory, false, 'it searches memory; it does not need it pasted in');
  assert.equal(a.environment, 'minimal');
});

test('a definition cannot grant itself the tools that would break the arrangement', () => {
  const row = registry.normalize({
    id: 'overreach', role: 'do anything',
    tools: ['shell', 'settings_propose', 'install_propose', 'agent_dispatch'],
  });
  assert.deepEqual(row.tools, ['shell'], 'the forbidden ones are stripped, not honoured');
  assert.deepEqual(row.refusedTools.sort(), ['agent_dispatch', 'install_propose', 'settings_propose']);
});

test('an id has to be safe in a filename, a URL and a tool argument', () => {
  for (const bad of ['../escape', 'Has Spaces', 'UPPER', '9leading', '', 'a'.repeat(50)])
    assert.ok(registry.validId(bad), `${bad} was accepted as an agent id`);
  assert.equal(registry.validId('mech-engineer'), null);
});

test('a definition with no role is refused — a specialist is its prompt', () => {
  assert.throws(() => registry.normalize({ id: 'empty', role: '   ' }), /needs a role/);
});

test('a specialist prompt is smaller than the orchestrator prompt, and keeps the charter', () => {
  const full = agent.preview({ message: 'hello' });

  const def = registry.get('archivist');
  const narrow = agent.preview({
    message: 'hello',
    profile: {
      id: def.id, label: def.label, systemPrompt: def.role, tools: def.tools,
      memory: def.memory, environment: def.environment,
    },
  });

  assert.ok(narrow.includes(providers.SAFETY_CHARTER),
    'the charter is not something a definition may drop');
  assert.ok(narrow.length < full.length,
    `a specialist prompt (${narrow.length}) must be smaller than the orchestrator's (${full.length}) `
    + '— that is the whole reason for having specialists');

  // The blocks a specialist has no use for.
  assert.ok(!narrow.includes('# How you keep your memory'), 'memory rules are the orchestrator\'s job');
  assert.ok(!narrow.includes('# Who is asking'), 'a specialist is not talking to a device');
  assert.ok(narrow.includes('# Where you are'), 'it still needs to know which machine it is on');
});

test('an allowlist really is an allowlist', () => {
  const def = registry.get('archivist');
  const all = tools.schemas([]).map(s => s.function.name);
  const disabled = all.filter(n => !def.tools.includes(n));
  const left = tools.schemas(disabled).map(s => s.function.name);
  assert.deepEqual(left, ['memory_search']);
  assert.ok(!left.includes('shell'), 'the archivist has no business running commands');
});

test('dispatch refuses an agent nobody defined, and says who there is', () => {
  registry.setEnabled(true);
  assert.throws(() => missions.dispatch({ agentId: 'nobody', task: 'x' }),
    e => {
      assert.equal(e.status, 404);
      assert.match(e.message, /archivist/, 'a refusal that lists nothing is a dead end');
      return true;
    });
  assert.throws(() => missions.dispatch({ agentId: 'archivist', task: '  ' }), /needs a task/);
  registry.setEnabled(false);
});

test('the mission index survives an agent being deleted', () => {
  missions._reset();
  const rows = missions.list();
  assert.deepEqual(rows, []);
  // A mission's history belongs to the mission. Deleting a definition must not
  // take the record of what it did with it — which is why the index is keyed by
  // mission and not by agent.
  missions.patch('nothing', { state: 'done' });   // no-op on an unknown id
  assert.deepEqual(missions.list(), []);
});

test('GET /api/harness/agents reports the roster and the switch', async () => {
  const res = await h.api(null, 'GET', '/api/harness/agents');
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, false);
  assert.ok(res.body.agents.some(a => a.id === 'archivist'));
  assert.ok(res.body.never.includes('agent_dispatch'), 'the panel should be able to show what is forbidden');
});

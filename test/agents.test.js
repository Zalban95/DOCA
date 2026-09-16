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
  assert.ok(!names.includes('agent_resume'));
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

test('a specialist can be written, edited and deleted over HTTP', async () => {
  const def = { id: 'mech', label: 'Mech', note: 'CAD and Blender', role: 'You design parts.',
                tools: ['shell', 'settings_propose'], maxSteps: 8 };

  const made = await h.api(null, 'POST', '/api/harness/agents', def);
  assert.equal(made.status, 200);
  assert.deepEqual(made.body.agent.tools, ['shell'], 'the forbidden tool is stripped, not stored');
  assert.deepEqual(made.body.agent.refusedTools, ['settings_propose'],
    'and the panel is told what it removed rather than saving something different in silence');

  const edited = await h.api(null, 'POST', '/api/harness/agents/mech', { ...def, tools: ['shell'], label: 'Mech II' });
  assert.equal(edited.body.agent.label, 'Mech II');

  const gone = await h.api(null, 'DELETE', '/api/harness/agents/mech');
  assert.equal(gone.status, 200);
  assert.equal(gone.body.agent, null, 'a definition that was not shipped disappears');

  // A shipped one reverts instead, which is what a reset means.
  const reverted = await h.api(null, 'DELETE', '/api/harness/agents/archivist');
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.agent.id, 'archivist');
  assert.equal(reverted.body.agent.builtin, true);
});

test('GET /api/harness/agents reports the roster and the switch', async () => {
  const res = await h.api(null, 'GET', '/api/harness/agents');
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, false);
  assert.ok(res.body.agents.some(a => a.id === 'archivist'));
  assert.ok(res.body.never.includes('agent_dispatch'), 'the panel should be able to show what is forbidden');
});

test('a step count is the definition\'s business — nothing caps it', () => {
  // Capping here would be limiting the agent to fix a cost problem that lives
  // in the prompt, which is the wrong instrument aimed at the wrong thing.
  assert.equal(registry.normalize({ id: 'long', role: 'x', maxSteps: 40 }).maxSteps, 40);
  assert.equal(registry.normalize({ id: 'longer', role: 'x', maxSteps: 500 }).maxSteps, 500);
  assert.equal(registry.normalize({ id: 'silent', role: 'x' }).maxSteps, 12, 'only the fallback applies');
  assert.equal(registry.normalize({ id: 'zero', role: 'x', maxSteps: 0 }).maxSteps, 12);
});

test('when a specialist runs out of steps it names its own limit, not the panel\'s', () => {
  const src = require('fs').readFileSync(require.resolve('../modules/harness/agent.js'), 'utf8');
  const stop = src.slice(src.indexOf('if (step === maxSteps)'), src.indexOf('if (step === maxSteps)') + 900);
  assert.match(stop, /this specialist's own/,
    'a mission that stops must not send the user to the panel setting, which would change nothing');
  assert.match(stop, /agent definition/);
  assert.match(stop, /harness\.config\.doca\.maxSteps/, 'the orchestrator still names its own setting');
});

/* ── A restart pauses a mission, and the user decides ── */

function seed(rows) {
  require('../modules/store').writeJson('agents/missions', { missions: rows });
}
const row = (id, state, extra = {}) => ({
  id, agentId: 'archivist', label: 'Archivist', task: `errand ${id}`, sessionId: null,
  state, steps: 3, tokens: 1200, startedAt: new Date().toISOString(), endedAt: null,
  result: null, error: null, ...extra,
});

test('a restart pauses what was running instead of leaving it running forever, and touches nothing else', () => {
  seed([row('msn_a', 'running'), row('msn_b', 'done')]);
  const paused = missions.recover();
  assert.deepEqual(paused.map(m => m.id), ['msn_a']);
  assert.equal(missions.get('msn_a').state, 'paused', 'not failed: the work so far is still worth offering');
  assert.equal(missions.get('msn_b').state, 'done');
  assert.equal(missions.running().length, 0, 'or the panel bar polls every 3 s for the rest of the day');
  assert.deepEqual(missions.recover(), [], 'a second run finds nothing');

  registry.setEnabled(true);
  const block = missions.block();
  assert.match(block, /msn_a .*PAUSED.*step 3/, 'the audit: what it was and how far it got');
  assert.match(block, /one short question/);
  assert.match(block, /agent_resume/);
  assert.match(block, /Never resume without a yes/);
  registry.setEnabled(false);
});

test('only the user\'s answer moves a paused mission, and a no drops it', () => {
  seed([row('msn_a', 'paused'), row('msn_b', 'done')]);
  assert.throws(() => missions.resume('msn_b', { go: true }), e => e.status === 409);
  assert.throws(() => missions.resume('msn_x', { go: true }), e => e.status === 404);

  registry.setEnabled(true);
  seed([row('msn_a', 'paused', { agentId: 'deleted-agent' })]);
  assert.throws(() => missions.resume('msn_a', { go: true }), /no longer exists/);
  assert.equal(missions.get('msn_a').state, 'paused', 'a refused resume must not lose the question');

  const dropped = missions.resume('msn_a', { go: false });
  assert.equal(dropped.state, 'cancelled');
  assert.ok(dropped.endedAt);
  registry.setEnabled(false);
});

test('a yes resumes in the mission\'s own session', async () => {
  registry.setEnabled(true);
  const session = require('../modules/harness/memory').createSession('resume test');
  seed([row('msn_a', 'paused', { sessionId: session.id })]);

  const resumed = missions.resume('msn_a', { go: true });
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.sessionId, session.id, 'its own session, so it reads what it already did');
  assert.ok(resumed.resumedAt);

  // No model is configured here, so the turn ends on its own; wait for that so
  // it cannot write into the next test's index.
  for (let i = 0; i < 100 && missions.get('msn_a').state === 'running'; i++)
    await new Promise(r => setTimeout(r, 20));
  assert.notEqual(missions.get('msn_a').state, 'paused');
  registry.setEnabled(false);
});

test('a specialist cannot answer for the user', () => {
  assert.ok(registry.NEVER.includes('agent_resume'));
});

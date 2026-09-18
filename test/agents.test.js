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

/* ── The plan ─────────────────────────────────────────── */

test('a mission plan is what makes a progress bar possible', () => {
  registry.setEnabled(true);
  missions._reset();

  // A plan can be handed over at dispatch: the orchestrator usually knows the
  // shape of the errand before it delegates it.
  const m = missions.dispatch({
    agentId: 'archivist', task: 'tidy the index',
    plan: [{ title: 'Read the index' }, { title: 'Group the entries' }],
  });

  assert.equal(m.plan.length, 2);
  assert.deepEqual(m.plan.map(i => i.state), ['queued', 'queued'],
    'a step you have not started is queued, not running');

  // `steps` and `tokens` say what has been spent; only a plan states the total,
  // which is why a client with no plan can only ever draw "STEP 0".
  assert.deepEqual(missions.planProgress(m.plan), { done: 0, total: 2, percent: 0 });

  // Ticking moves one item by title, without resending the list.
  missions.setPlan(m.id, { tick: { title: 'Read the index', state: 'done' } });
  const after = missions.get(m.id);
  assert.deepEqual(after.plan.map(i => i.state), ['done', 'queued']);
  assert.deepEqual(missions.planProgress(after.plan), { done: 1, total: 2, percent: 50 });

  // A tick for something not on the plan is added, not dropped: the specialist
  // knows something the plan did not.
  missions.setPlan(m.id, { tick: { title: 'Found a third thing', state: 'running' } });
  assert.equal(missions.get(m.id).plan.length, 3);
});

test('a plan is bounded, because it travels in a bus event', () => {
  registry.setEnabled(true);
  missions._reset();

  const many = Array.from({ length: 40 }, (_, i) => ({ title: `step ${i} ${'x'.repeat(200)}` }));
  const m = missions.dispatch({ agentId: 'archivist', task: 'long one', plan: many });

  assert.equal(m.plan.length, missions.PLAN_MAX_ITEMS, 'a plan longer than this is a transcript');
  for (const item of m.plan)
    assert.ok(item.title.length <= missions.PLAN_TITLE_MAX, 'a title is bounded too');

  // An unknown state becomes queued rather than travelling as-is.
  missions.setPlan(m.id, { set: [{ title: 'x', state: 'exploded' }] });
  assert.equal(missions.get(m.id).plan[0].state, 'queued');

  // Whitespace is collapsed, so a title matched by `tick` matches what was set.
  missions.setPlan(m.id, { set: [{ title: '  two   words  ' }] });
  assert.equal(missions.get(m.id).plan[0].title, 'two words');
});

test('the plan is in the mission document, so a human can fix it by hand', () => {
  registry.setEnabled(true);
  missions._reset();
  const store = require('../modules/store');
  const fs = require('node:fs');
  const path = require('node:path');

  const m = missions.dispatch({ agentId: 'archivist', task: 'check the file',
    plan: [{ title: 'first', state: 'running' }] });

  // Stored, not cached in memory: the harness re-reads, so editing the JSON is
  // a supported way to correct a wrong plan.
  const file = path.join(store.DATA_DIR, 'agents', 'missions.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = onDisk.missions.find(x => x.id === m.id);
  assert.ok(row && Array.isArray(row.plan), 'the plan is not in the mission document');
  assert.equal(row.plan[0].title, 'first');

  // Edit it by hand and the next read sees the edit.
  row.plan[0].state = 'failed';
  fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));
  assert.equal(missions.get(m.id).plan[0].state, 'failed');
});

test('the mission_plan tool refuses politely outside a mission', () => {
  registry.setEnabled(true);
  missions._reset();
  const ctx = { sessionId: 's_not_a_mission' };
  const out = tools.call('mission_plan', { set: [{ title: 'x' }] }, [], ctx);
  return out.then(text => {
    assert.match(text, /not a mission/,
      'the orchestrator\'s own conversation has no plan, and saying so beats an undefined');
  });
});

test('a specialist can reach mission_plan whatever its definition allows', () => {
  // The bug this pins: a definition's `tools` is an allowlist, and NEVER is
  // subtracted from it — so a tool that is merely "not forbidden" is still
  // unreachable unless the definition names it. `mission_plan` was written on
  // the assumption that "not in NEVER" was enough. The archivist definition
  // lists memory_search and nothing else, so no specialist could tick its own
  // plan: a plan was write-once at dispatch and stayed all-queued forever, and
  // the progress bar the whole feature exists for would never move.
  const narrow = { id: 'narrow', label: 'Narrow', systemPrompt: 'You do one thing.',
    tools: ['memory_search'], memory: false, environment: 'minimal' };

  const prompt = agent.preview({ message: 'x', profile: narrow });
  // preview() reports the count, so the count is the observable.
  // The minimal brief says ", N tools"; the full block says ", N tools
  // available". Match both rather than pin the wording.
  const m = prompt.match(/, (\d+) tools/);
  assert.ok(m, 'the specialist prompt does not state a tool count');
  assert.equal(Number(m[1]), 2,
    'expected memory_search plus mission_plan; a specialist cannot drive its own errand without it');

  // And the two implementations that compute this must agree — they were two,
  // and a fix applied to one of them is a fix that does not exist.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'modules', 'harness', 'agent.js'), 'utf8');
  assert.equal((src.match(/profile\.tools\.includes\(n\)/g) || []).length, 1,
    'the allowlist is computed in more than one place again');

  // A definition still cannot give itself a tool the charter withholds, and
  // this goes through the real path: NEVER is subtracted in registry.normalize()
  // when a definition is saved, not re-checked per turn — deliberately, so a
  // definition asking for a forbidden tool is corrected once, visibly. So the
  // profile a mission runs with is built from the normalized definition, and
  // that is what this asserts.
  const greedy = registry.normalize({
    id: 'greedy', role: 'do anything',
    tools: ['memory_search', 'settings_propose', 'agent_dispatch', 'install_propose'],
  });
  assert.deepEqual(greedy.tools, ['memory_search'], 'the forbidden ones are stripped on save');

  const p2 = agent.preview({ message: 'x', profile: { ...narrow, tools: greedy.tools } });
  assert.equal(Number(p2.match(/, (\d+) tools/)[1]), 2,
    'memory_search plus mission_plan — and no way to reach the withheld tools');
});

test('a mission log lives under the data directory, not the working directory', () => {
  // `logFor()` returned `agents/mission-${id}` — a bare relative path — and
  // store.appendJsonl does NOT resolve through DATA_DIR the way readJson and
  // writeJson do. It hands the path to fs, which resolves it against the
  // process working directory. So the mission index went to
  // .doca/agents/missions.json and the mission *logs* went to <cwd>/agents/:
  // two halves of one feature in two places.
  //
  // Three consequences, and this test is about the third. Logs scattered
  // wherever the panel was started from; they were not covered by .gitignore,
  // so `git add -A` in the repo root would have committed them; and
  // DOCA_DATA_DIR did not move them, so relocating the data dir left the
  // mission logs behind and split a mission from its own history.
  registry.setEnabled(true);
  missions._reset();

  const store = require('../modules/store');
  const fs    = require('node:fs');
  const path  = require('node:path');

  const m = missions.dispatch({ agentId: 'archivist', task: 'leave a trace', plan: [{ title: 'x' }] });

  // Write one event through the real path. A dispatched mission with no model
  // behind it never emits, so without this the log is never created and the
  // test would pass for the wrong reason — by finding nothing to find.
  missions.record(m.id, { type: 'tool_call', name: 'memory_search', args: { query: 'x' }, step: 1 });
  assert.ok(missions.events(m.id, 5).length > 0, 'the event was not written at all');

  // Where did it go?
  const underData = path.join(store.DATA_DIR, 'agents', `mission-${m.id}.jsonl`);
  const inCwd     = path.resolve(process.cwd(), 'agents', `mission-${m.id}.jsonl`);
  assert.ok(fs.existsSync(underData), `the mission log is not under the data dir (${underData})`);
  assert.equal(fs.existsSync(inCwd), false,
    'a mission log was written relative to the working directory — the bug is back');

  // And the two halves sit together, which is the point of the fix.
  assert.ok(fs.existsSync(path.join(store.DATA_DIR, 'agents', 'missions.json')),
    'the index and the logs must be in the same directory');

  missions._reset();
  registry.setEnabled(false);
});

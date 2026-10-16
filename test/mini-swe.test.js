'use strict';

// mini-swe-agent as a harness (asked 2026-10-16): its catalog row, that DOCA never runs it on the hub, that it is off
// until switched on, the Orchestrator's rule for offering it, and its trajectory read mechanically. Needs no Docker,
// no Python and no mini: the computer side is harness-teams.test.js's.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./helpers');

let catalog, harnesses;
const row = () => catalog.KNOWN.find(r => r.id === 'mini');
const setAllow = allow => { const u = require('../modules/utils'); const p = u.loadPrefs(); u.savePrefs({ ...p, teams: { ...(p.teams || {}), outside: { allow } } }); };

before(async () => {
  await H.start();
  catalog = require('../modules/harness/catalog');
  harnesses = require('../modules/harness-teams/harnesses');
});
after(() => H.stop());

test('its catalog row: found by `mini`, installed with uv on a click and undone the same way, a worker\'s argv as its --help says', async () => {
  const r = row();
  assert.equal(r.kind, 'cli');
  assert.equal(r.cmd, 'mini');
  assert.equal(r.installCmd, 'uv tool install mini-swe-agent');
  assert.equal(require('../modules/harness/harness-life').uninstallCmd(r), 'uv tool uninstall mini-swe-agent');
  assert.equal(r.sandbox, true);
  assert.equal(catalog.configFor('mini').launchCmd, 'mini', 'the Terminal launches it as a person would, where it asks before each command');
  assert.equal(catalog.defaultId(), 'doca', 'not a new default');
  assert.deepEqual(harnesses.argv(r, { task: 'fix it', output: '/home/agent/teams/w.traj.json' }),
    ['-y', '--exit-immediately', '-l', '0', '-o', '/home/agent/teams/w.traj.json', '-m', 'openai/default', '-t', 'fix it']);
  assert.deepEqual(harnesses.argv(r, { task: 't', model: 'deepseek/deepseek-chat' }),
    ['-y', '--exit-immediately', '-l', '0', '-m', 'openai/deepseek/deepseek-chat', '-t', 't'], 'no trajectory asked: no -o; a relay model through litellm\'s openai/');
  assert.equal(r.team.relay, true, 'its model is the hub\'s, through the relay');
  assert.ok(!r.team.key, 'no provider key is ever copied in for it');
  assert.equal(harnesses.npmPackage(r), null);
  assert.equal(r.team.uv, 'mini-swe-agent');
});

test('DOCA never runs it on the hub: no one-question road, and a stray adapter is refused', async () => {
  const shot = require('../modules/harness/one-shot');
  assert.equal(shot.adapterFor(row()), null);
  assert.match(shot.whyNot(row()), /only inside an agents' computer/);
  const r = await shot.ask({ kind: 'argv', cmd: 'mini', args: ['-y', '-t', '{message}'] }, { message: 'rm -rf ~' });
  assert.equal(r.code, 126);
  assert.match(r.error, /never on the hub/);
});

test('off until a person switches it on: installed here, or named in the allow list', () => {
  harnesses._found.clear();
  const saved = process.env.PATH;
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-nomini-'));
  try {
    assert.ok(!harnesses.offered().some(r => r.id === 'mini'), 'not offered by default');
    assert.throws(() => harnesses.find('mini'), e => e.status === 403 && /is off here/.test(e.message));
    assert.doesNotMatch(require('../modules/harness/coordinator').routing({ held: new Set(['team', 'work_chats']) }), /harness:mini/);
    setAllow(['mini']);
    assert.deepEqual(harnesses.offered().map(r => r.id), ['mini']);
    setAllow([]);
    const bin = path.join(process.env.PATH, process.platform === 'win32' ? 'mini.exe' : 'mini');
    fs.writeFileSync(bin, '#!/bin/sh\n'); fs.chmodSync(bin, 0o755);
    harnesses._found.clear();
    assert.ok(harnesses.offered().some(r => r.id === 'mini'), 'installed on the Harness tab: on');
    assert.equal(harnesses.find('mini-swe-agent').id, 'mini', 'found by its label too');
  } finally { fs.rmSync(process.env.PATH, { recursive: true, force: true }); process.env.PATH = saved; harnesses._found.clear(); setAllow([]); }
});

test('the Orchestrator\'s rule: when to offer it, before a work chat takes the job, and only on the person\'s yes', () => {
  setAllow(['mini']);
  try {
    const table = require('../modules/harness/coordinator').routing({ held: new Set(['team', 'work_chats']) });
    const at = table.indexOf('mini-swe-agent —');
    assert.ok(at > 0 && at < table.indexOf('A work chat'), 'offered before a work chat would take the coding job');
    assert.match(table, /self-contained coding task in a git project with a command that shows it works/);
    assert.match(table, /several tries at once/);
    assert.match(table, /Offer it in one line, naming it and saying it runs in a computer of its own on this hub's model, through the relay/);
    assert.match(table, /`harness:mini`.*asked: true/);
    assert.match(table, /Not for work that needs DOCA's tools/);
    assert.match(table, /runs every command without asking/);
    assert.match(table, /several tries at once would help \(tries: N — each judged by the task\'s check or test, the best kept\)/);
    assert.doesNotMatch(table, /count for parallel tries|tries at once would help \(count\)/, 'count is several workers sharing a plan, never tries');
    const s = require('../modules/teams').shape({ title: 'Tries', tasks: [{ id: 't1', agent: 'harness:mini', task: 'make the test pass', tries: 3, test: 'pytest -q' }] }, { workChats: true, project: true });
    assert.deepEqual(s.tasks.map(t => t.id), ['t1-try1', 't1-try2', 't1-try3'], 'parallel tries judged by the test are tries');
    const c = require('../modules/teams').shape({ title: 'Count', tasks: [{ id: 't1', agent: 'harness:mini', task: 'share the plan', count: 3 }] }, { workChats: true });
    assert.deepEqual(c.tasks.map(t => t.id), ['t1-1', 't1-2', 't1-3'], 'count makes several workers sharing the plan');
  } finally { setAllow([]); }
  assert.match(require('../modules/harness/toolbox/teams').find(t => t.name === 'team').parameters.properties.asked.description, /said yes, on this turn, to your offer/);
});

/* ── Its switch: Never · Ask me first · On its own (asked 2026-10-16) ── */

const setUse = use => { const u = require('../modules/utils'); const p = u.loadPrefs(); u.savePrefs({ ...p, teams: { ...(p.teams || {}), outside: { allow: ['mini'], use } } }); };
const tasks = [{ id: 't1', agent: 'harness:mini', task: 'make the test pass' }];
const owner = () => ({ id: H.owner.user.id, role: 'owner', name: 'owner' });

test('Never: not offered, not in the routing table, refused even when the person asks', () => {
  setUse({ mini: 'never' });
  try {
    assert.equal(harnesses.mode(row()), 'never', 'an explicit switch wins over the allow list');
    assert.ok(!harnesses.offered().some(r => r.id === 'mini'));
    assert.throws(() => harnesses.find('mini'), e => e.status === 403 && /"Never"/.test(e.message));
    assert.doesNotMatch(require('../modules/harness/coordinator').routing({ held: new Set(['team', 'work_chats']) }), /mini-swe-agent —/);
    assert.throws(() => require('../modules/teams').shape({ title: 'x', tasks }, { workChats: true }), /"Never"/);
  } finally { setUse({}); }
});

test('Ask me first: offered, and run only on the person\'s yes', async () => {
  setUse({ mini: 'ask' });
  try {
    const outside = require('../modules/teams/outside');
    const p = { id: 'p' };
    assert.throws(() => outside.gate(tasks, { asked: false, person: owner(), project: p }), e => e.status === 403 && /say yes to your offer/.test(e.message));
    assert.equal(outside.gate(tasks, { asked: true, person: owner(), project: p }), 'asked');
    assert.throws(() => outside.gate(tasks, { asked: true, person: { id: 'u', role: 'member' }, project: p }), /does not hold host/);
    const tool = require('../modules/harness/toolbox/teams').find(t => t.name === 'team');
    const lead = require('../modules/harness/memory').mainSession().id;
    assert.match(await tool.run({ action: 'create', title: 'T', tasks }, { sessionId: lead, byPerson: true, user: owner() }), /Error: .*only when the person asked for it/);
  } finally { setUse({}); }
});

test('On its own: the Orchestrator starts it unasked, says so, and an activity line says why', async () => {
  setUse({ mini: 'free' });
  const root = fs.mkdtempSync(path.join(process.env.WORKSPACE_DIR, 'free-'));   // not a git repository: the task fails before any computer is made
  try {
    const table = require('../modules/harness/coordinator').routing({ held: new Set(['team', 'work_chats']) });
    assert.match(table, /Its switch is "On its own": start it yourself.*no asked needed.*say in one line that you started it and why/);
    const outside = require('../modules/teams/outside');
    assert.equal(outside.gate(tasks, { asked: false, person: owner(), project: { id: 'p' } }), 'free');
    assert.throws(() => outside.gate(tasks, { asked: false, person: { id: 'u', role: 'member' }, project: { id: 'p' } }), /does not hold host/, 'still an admin\'s');
    assert.throws(() => outside.gate([...tasks, { id: 't2', agent: 'harness:claude', task: 'x' }], { asked: false, person: owner(), project: { id: 'p' } }), /harness:claude: .*only when the person asked/, 'one switch covers only its own harness');
    require('../modules/projects/store').create({ root, name: 'freeproj' });
    const tool = require('../modules/harness/toolbox/teams').find(t => t.name === 'team');
    const lead = require('../modules/harness/memory').mainSession().id;
    const said = await tool.run({ action: 'create', title: 'Free try', project: 'freeproj', tasks }, { sessionId: lead, byPerson: false, user: owner() });
    assert.match(said, /You started harness:mini on your own — its switch is "On its own": say so in one line, and why it fits/);
    const team = require('../modules/teams').visible(null).find(t => t.title === 'Free try');
    assert.equal(require('../modules/teams').get(team.id).outsideBy, 'free');
    assert.ok(require('../modules/activity').list({ limit: 50 }).some(l => /started harness:mini on its own for team "Free try"/.test(l.what) && /On its own/.test(l.why)));
    await require('../modules/teams').stop(team.id, { why: 'test' }).catch(() => {});
  } finally { setUse({}); fs.rmSync(root, { recursive: true, force: true }); }
});

test('moving a harness to "On its own" asks for the password; tightening does not; the person\'s words leave it a proposal', async () => {
  const guarded = require('../modules/auth/guarded');
  assert.equal(guarded.prefsTouched([{ path: 'teams.outside.use.mini', from: 'ask', to: 'free' }])?.key, 'outsideFree');
  assert.equal(guarded.prefsTouched([{ path: 'teams.outside.use.mini', from: 'ask', to: 'free' }]).password, true);
  assert.equal(guarded.prefsTouched([{ path: 'teams.outside.use.mini', from: 'free', to: 'never' }]), null);
  assert.equal(guarded.prefsTouched([{ path: 'teams.outside.use', from: { mini: 'free' }, to: { mini: 'free', claude: 'ask' } }]), null, 'one already free is not a new widening');
  assert.equal(guarded.prefsTouched([{ path: 'teams.outside.use', from: {}, to: { claude: 'free' } }])?.key, 'outsideFree');
  setUse({ mini: 'ask' });
  try {
    let r = await H.api(null, 'POST', '/api/prefs', { teams: { outside: { use: { mini: 'free' } } } }, { 'X-Doca-Password': '' });
    assert.equal(r.status, 401); assert.equal(r.body.code, 'password_required');
    assert.equal(harnesses.mode(row()), 'ask');
    r = await H.api(null, 'POST', '/api/prefs', { teams: { outside: { use: { mini: 'free' } } } });
    assert.equal(r.status, 200); assert.equal(harnesses.mode(row()), 'free');
    r = await H.api(null, 'POST', '/api/prefs', { teams: { outside: { use: { mini: 'never' } } } }, { 'X-Doca-Password': '' });
    assert.equal(r.status, 200, 'tightening asks nothing'); assert.equal(harnesses.mode(row()), 'never');
    // "It can decide on its own from now on", said in chat: settings_propose {asked: true} on their turn.
    setUse({ mini: 'ask' });
    const propose = require('../modules/harness/toolbox/settings').find(t => t.name === 'settings_propose');
    const ctx = { sessionId: require('../modules/harness/memory').mainSession().id, byPerson: true, user: owner() };
    const wide = await propose.run({ reason: 'the person said so', asked: true, changes: [{ path: 'teams.outside.use.mini', value: 'free' }] }, ctx);
    assert.match(wide, /Proposed .*with their password/s);
    assert.equal(harnesses.mode(row()), 'ask', 'not applied from the turn');
    const id = /Proposed \((\S+)\)/.exec(wide)[1];
    r = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {}, { 'X-Doca-Password': '' });
    assert.equal(r.status, 401, 'its Accept asks for the password');
    r = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(harnesses.mode(row()), 'free');
    const tight = await propose.run({ reason: 'the person said so', asked: true, changes: [{ path: 'teams.outside.use.mini', value: 'never' }] }, ctx);
    assert.match(tight, /Applied, as they asked/); assert.equal(harnesses.mode(row()), 'never');
    assert.throws(() => propose.run({ reason: 'x', asked: true, changes: [{ path: 'teams.outside.use.mini', value: 'always' }] }, ctx), /"never", "ask" or "free"/);
  } finally { setUse({}); }
});

test('the relay is switched on only as part of running it, naming the computer and why', async () => {
  const u = require('../modules/utils'), p = u.loadPrefs();
  u.savePrefs({ ...p, relay: { ...(p.relay || {}), enabled: true, computers: true, models: ['x/y'] } });
  const computers = require('../modules/computers'), rc = require('../modules/relay/computer');
  computers.save([...computers.rows(), { id: 'beef1234', name: 'mini-swe-agent worker 1', agentType: 'harness:mini' }]);
  const was = rc.set, calls = [];
  rc.set = async (id, on, why) => { calls.push({ id, on, why }); computers.patch(id, { relayOn: true, relayToken: 'relay-test-token-0123456789' }); return {}; };
  try {
    const env = await require('../modules/harness-teams/trajectory').relayEnv(computers.get('beef1234'), row(), 'mini-swe-agent on task t1 works on this hub\'s model — the person said yes to running it');
    assert.deepEqual(calls.map(c => [c.id, c.on]), [['beef1234', true]]);
    assert.match(calls[0].why, /the person said yes/);
    assert.equal(env.OPENAI_API_KEY, 'relay-test-token-0123456789');
    await require('../modules/harness-teams/trajectory').relayEnv(computers.get('beef1234'), row());
    assert.equal(calls.length, 1, 'already on: not switched again');
  } finally { rc.set = was; computers.save(computers.rows().filter(c => c.id !== 'beef1234')); u.savePrefs(p); }
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'harness-teams', 'worker.js'), 'utf8');
  assert.match(src, /said yes to running it/, 'the worker names why');
  assert.ok(src.indexOf('trajectory.relayEnv') > src.indexOf('computerFor(w, row)'), 'only inside a run the gate let through');
});

test('its trajectory is read mechanically: commands, results by return code, its words, and how it ended', () => {
  const tr = require('../modules/harness-teams/trajectory');
  const msgs = [
    { role: 'system', content: 'You are…' }, { role: 'user', content: 'Please solve this issue: fix add' },
    { role: 'assistant', content: 'Run the tests first.', extra: { actions: [{ command: 'python -m pytest -q', tool_call_id: 'a' }] } },
    { role: 'tool', content: '<returncode>1</returncode>\n<output>\nF\nFAILED test_add.py::test_add\n</output>' },
    { role: 'assistant', content: 'Fixed the sign.', extra: { actions: [{ command: 'sed -i s/-/+/ add.py' }] } },
    { role: 'tool', content: '<returncode>0</returncode>\n<output>\n</output>' },
  ];
  const one = tr.read(JSON.stringify({ messages: msgs }), 0);
  assert.deepEqual(one.events.map(e => e.type), ['text', 'command', 'result', 'text', 'command', 'result']);
  assert.deepEqual(one.events[1], { type: 'command', text: 'python -m pytest -q' });
  assert.deepEqual(one.events[2], { type: 'result', ok: false, text: 'F' });
  assert.equal(one.events[5].ok, true);
  assert.equal(one.final, null);
  const done = [...msgs, { role: 'exit', content: '', extra: { exit_status: 'Submitted', submission: '' } }];
  const two = tr.read(JSON.stringify({ messages: done }), one.seen);
  assert.deepEqual(two.events, [], 'what was said is not said again');
  assert.deepEqual(two.final, { type: 'final', ok: true, text: 'Fixed the sign.' });
  const cut = tr.read(JSON.stringify({ messages: [...msgs, { role: 'exit', content: 'LimitsExceeded', extra: { exit_status: 'LimitsExceeded' } }] }), 0).final;
  assert.equal(cut.ok, false);
  assert.match(cut.text, /ended without finishing: LimitsExceeded/);
  assert.deepEqual(tr.read('{"messages": [', 3), { events: [], seen: 3, final: null }, 'caught half-written: nothing new yet');
});

test('its model is the relay\'s or nothing: refused, with where to switch it on, while the relay is off', async () => {
  const tr = require('../modules/harness-teams/trajectory');
  await assert.rejects(tr.relayEnv({ id: 'x' }, row()), e => e.status === 409 && /model relay, which is off/.test(e.message) && /Field → API keys → Model relay/.test(e.message));
  assert.deepEqual(await tr.relayEnv({ id: 'x' }, catalog.KNOWN.find(r => r.id === 'claude')), {}, 'a harness with its own key needs none');
});

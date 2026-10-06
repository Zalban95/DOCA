'use strict';

/**
 * Work that finishes itself (modules/harness/supervisor.js): a work chat keeps
 * going until it files a final report or is stopped, its specialists wake it,
 * and the Orchestrator is woken only for final reports — and then tells the
 * owner's devices. The model call is replaced by a recorder; what is under test
 * is who gets woken, when, and with what.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H          = require('./helpers');
const memory     = require('../modules/harness/memory');
const org        = require('../modules/harness/organization');
const supervisor = require('../modules/harness/supervisor');
const lifecycle  = require('../modules/harness/turn/lifecycle');
const catalog    = require('../modules/harness/catalog');
const store      = require('../modules/store');
const bus        = require('../modules/api-v1/bus');

test.before(() => H.start());
test.after(() => { supervisor._setEnabled(false); return H.stop(); });

/** Every automatic turn the supervisor asks for, instead of a model call. */
let woken = [];
supervisor._setTurn(async (sessionId, message) => { woken.push({ sessionId, message }); return { text: `reply to ${message.slice(0, 40)}` }; });
const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));

function fresh({ perJob = 30, perHour = 1000 } = {}) {
  supervisor._setEnabled(true);
  catalog.saveConfig(catalog.BUILTIN_ID, { autoTurnsPerJob: perJob, autoWakesPerHour: perHour });
  woken = [];
}
/** A work chat under the Orchestrator, given a job the way the Orchestrator gives one. */
function job(title = 'Job') {
  const s = org.create({ title });
  memory.updateSession(s.id, { job: { state: 'working', since: new Date().toISOString(), autoTurns: 0, idleTurns: 0 } });
  return s.id;
}
const jobOf = id => memory.getSession(id).job;
const ceo = () => memory.mainSession().id;

test('a turn that ends short of a final report, with nothing running, is followed by another', async () => {
  fresh();
  const id = job('Keep going');
  assert.equal(supervisor.decide(id, { steps: 5 }), 'woken');
  await settle();
  assert.deepEqual(woken.map(w => w.sessionId), [id]);
  assert.equal(woken[0].message, supervisor.CONTINUE);
  assert.equal(jobOf(id).autoTurns, 1);
  assert.equal(jobOf(id).idleTurns, 0, 'a turn that used tools made progress');
});

test('turns that do nothing, or too many turns, end as "stalled" — told to the Orchestrator, not looped', async () => {
  fresh();
  const id = job('Spinning');
  for (let i = 0; i < supervisor.IDLE_TURNS_MAX; i++) supervisor.decide(id, { steps: 1 });
  await settle();
  woken = [];
  assert.equal(supervisor.decide(id, { steps: 1 }), 'woken', 'the Orchestrator is woken instead');
  await settle();
  assert.equal(jobOf(id).state, 'stalled');
  assert.equal(woken.length, 1);
  assert.equal(woken[0].sessionId, ceo());
  assert.match(woken[0].message, /Spinning .* — blocked: Stalled: its last 3 turns did nothing/);

  fresh({ perJob: 2 });
  const busy = job('Long');
  supervisor.decide(busy, { steps: 9 });
  supervisor.decide(busy, { steps: 9 });
  await settle();
  woken = [];
  supervisor.decide(busy, { steps: 9 });
  await settle();
  assert.equal(jobOf(busy).state, 'stalled');
  assert.match(woken.at(-1).message, /taken 2 turns on its own \(autoTurnsPerJob\)/);
});

test('a final report ends the job and wakes the Orchestrator once, and its reply reaches the devices', async () => {
  fresh();
  const phone = H.mkDevice('Phone', 'phone');
  const id = job('Laya MCP server');
  await org.tool({ action: 'report', outcome: 'done', message: 'MCP server up on :8765, handshake verified.' }, { sessionId: id });
  assert.equal(jobOf(id).state, 'done');
  assert.equal(supervisor.decide(id, { steps: 3 }), 'woken');
  await settle(); await settle();
  assert.equal(woken.length, 1, 'the work chat itself is not continued');
  assert.equal(woken[0].sessionId, ceo());
  assert.match(woken[0].message, /Laya MCP server .* — done: MCP server up on :8765/);

  const toDevice = bus.drain(phone.device.id, 0).events.filter(e => e.type === 'agent.turn' && e.payload.by === 'panel');
  assert.equal(toDevice.length, 1, 'the owner hears it on their devices, not only in the chat');
  assert.equal(toDevice[0].payload.state, 'done');

  woken = [];
  assert.equal(supervisor.deliver(ceo()), 'nothing due', 'woken once per report');
});

test('a job that reports "done" twice is one line to the Orchestrator, the latest', async () => {
  fresh();
  const id = job('Twice');
  await org.tool({ action: 'report', outcome: 'done', message: 'first' }, { sessionId: id });
  await org.tool({ action: 'report', outcome: 'done', message: 'second, with timings' }, { sessionId: id });
  supervisor.deliver(ceo());
  await settle();
  const msg = woken.at(-1).message;
  assert.equal((msg.match(/Twice/g) || []).length, 1);
  assert.match(msg, /second, with timings/);
});

test('progress wakes nobody', async () => {
  fresh();
  const id = job('Quiet');
  await org.tool({ action: 'report', message: 'Halfway.' }, { sessionId: id });
  assert.equal(jobOf(id).state, 'working');
  assert.equal(supervisor.deliver(ceo()), 'nothing due');
});

test('a work chat waits while its specialists run, and the last one to finish wakes it', async () => {
  fresh();
  const id = job('Lead');
  const spec = memory.createSession('Specialist', { activate: false, kind: 'specialist', parentId: id });
  const rows = [
    { id: 'msn_a', agentId: 'blender', label: 'Blender', by: id, state: 'running', sessionId: spec.id },
    { id: 'msn_b', agentId: 'qwen', label: 'Qwen', by: id, state: 'running', sessionId: 'nope' },
  ];
  store.writeJson('agents/missions', { missions: rows });
  assert.equal(supervisor.decide(id, { steps: 4 }), 'waiting');
  assert.equal(jobOf(id).state, 'waiting');
  assert.equal(woken.length, 0);

  rows[0].state = 'done';
  store.writeJson('agents/missions', { missions: rows });
  assert.equal(supervisor.missionEnded(org.session(spec.id)), 'others still running');
  rows[1].state = 'failed';
  store.writeJson('agents/missions', { missions: rows });
  assert.equal(supervisor.missionEnded(org.session(spec.id)), 'woken');
  await settle();
  assert.deepEqual(woken.map(w => [w.sessionId, w.message]), [[id, supervisor.RESULTS]]);
  store.writeJson('agents/missions', { missions: [] });
});

test('stopped by the owner or the Orchestrator stays stopped; a turn that was only preempted decides nothing', async () => {
  fresh();
  const id = job('Stop me');
  assert.equal(supervisor.decide(id, { stopped: true, steps: 2 }), 'stopped');
  assert.equal(jobOf(id).state, 'stopped');
  assert.equal(supervisor.decide(id, { steps: 2 }), 'stopped', 'not continued afterwards either');
  assert.equal(supervisor.decide(job('Other'), { preempted: true }), 'preempted');
  assert.equal(woken.length, 0);
});

test('autoTurnsPerJob 0 switches it off; the hourly limit holds the rest back', async () => {
  fresh({ perJob: 0 });
  assert.equal(supervisor.decide(job('Off'), { steps: 3 }), 'off');
  fresh({ perHour: 1 });
  supervisor.decide(job('One'), { steps: 3 });
  // Earlier tests already used this hour's automatic turns under a higher limit.
  assert.equal(supervisor.decide(job('Two'), { steps: 3 }), 'limited');
});

test('an automatic turn gives way to the owner speaking', async () => {
  const id = job('Preempt');
  const auto = new AbortController();
  await lifecycle.claim(id, auto, true);
  assert.equal(lifecycle.isAuto(id), true);
  auto.signal.addEventListener('abort', () => setTimeout(() => lifecycle.running.delete(id), 20));
  const mine = new AbortController();
  await lifecycle.claim(id, mine, false);
  assert.equal(auto.signal.aborted, true);
  assert.equal(auto.preempted, true, 'marked preempted, which the supervisor does not treat as a stop');
  assert.equal(lifecycle.running.get(id), mine);
  await assert.rejects(lifecycle.claim(id, new AbortController(), true), { status: 409 }, 'but not the other way round');
  lifecycle.running.delete(id);
});

test('after a restart, work it cut off is carried on', async () => {
  fresh();
  const id = job('Cut off');
  memory.updateSession(id, { state: 'running' });    // stored as running, nothing running it
  const resumed = supervisor.recover();
  await settle();
  assert.ok(resumed.includes(id));
  assert.ok(woken.some(w => w.sessionId === id && w.message === supervisor.RESTARTED));
});

test('a turn that looped on one failing call ends the job as blocked, not with another turn (failures.js)', async () => {
  fresh();
  const id = job('Stuck on a file');
  const failures = require('../modules/harness/turn/failures');
  const signal = new AbortController().signal;
  for (let i = 0; i < 3; i++) failures.note(signal, 'read_file', { path: '/x' }, 'Error: ENOENT: no such file or directory');
  assert.deepEqual(failures.looped(signal), { tool: 'read_file', kind: 'not-found', times: 3 });
  assert.equal(failures.looped(new AbortController().signal), null, 'another turn starts clean');

  assert.equal(supervisor.decide(id, { steps: 4, looped: failures.looped(signal) }), 'woken', 'the Orchestrator is woken instead');
  await settle();
  assert.equal(jobOf(id).state, 'blocked');
  assert.ok(!woken.some(w => w.sessionId === id), 'no further turn for the looping job');
  assert.deepEqual(woken.map(w => w.sessionId), [ceo()]);
});

/* ── A stuck job gets one try on a stronger model (escalate.js) ── */

function withStrongModel() {
  const fs = require('node:fs');
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: {
    stub: { baseUrl: 'http://127.0.0.1:9/v1' }, big: { baseUrl: 'http://127.0.0.1:9/v1' },
  } } }));
  catalog.saveConfig(catalog.BUILTIN_ID, { provider: 'stub', model: 'weak', fallbackChain: [], escalateTo: { provider: 'big', model: 'strong' } });
}
function loopedSignal() {
  const failures = require('../modules/harness/turn/failures');
  const signal = new AbortController().signal;
  for (let i = 0; i < 3; i++) failures.note(signal, 'read_file', { path: '/x' }, 'Error: ENOENT: no such file or directory');
  return failures.looped(signal);
}

test('a looping job is moved to the stronger model once, visibly, and blocked if it loops again', async () => {
  fresh();
  withStrongModel();
  const id = job('Hard file');
  assert.equal(supervisor.decide(id, { steps: 4, looped: loopedSignal() }), 'woken');
  await settle();
  assert.deepEqual(woken.map(w => w.sessionId), [id], 'the job itself gets the try, the Orchestrator is not woken');
  assert.match(woken[0].message, /You were stuck: read_file failed the same way 3 times.*big\/strong/s);
  assert.deepEqual(memory.getSession(id).modelChoice, { provider: 'big', model: 'strong', fallback: true },
    'the conversation\'s own model choice, so the picker shows it');
  assert.equal(require('../modules/harness/turn/choice').apply(require('../modules/harness/agent').params(), id).model, 'strong');
  assert.equal(jobOf(id).escalated.from, 'stub/weak');
  assert.ok(org.notices(ceo()).some(n => /Escalated: .*Trying once on big\/strong instead of stub\/weak/.test(n.text)),
    'the Orchestrator is told, without being woken');

  woken = [];
  assert.equal(supervisor.decide(id, { steps: 4, looped: loopedSignal() }), 'woken');
  await settle();
  assert.equal(jobOf(id).state, 'blocked');
  assert.deepEqual(woken.map(w => w.sessionId), [ceo()]);
  assert.match(woken[0].message, /already been moved to big\/strong/);
});

test('a job that stops doing anything escalates too; running out of turns does not', async () => {
  fresh();
  withStrongModel();
  const idle = job('Idle');
  for (let i = 0; i < supervisor.IDLE_TURNS_MAX; i++) supervisor.decide(idle, { steps: 1 });
  await settle();
  woken = [];
  supervisor.decide(idle, { steps: 1 });
  await settle();
  assert.match(woken.at(-1).message, /You were stuck: its last 3 turns did nothing/);
  assert.equal(jobOf(idle).state, 'working');

  fresh({ perJob: 1 });
  withStrongModel();
  const long = job('Budget');
  supervisor.decide(long, { steps: 9 });
  await settle();
  woken = [];
  supervisor.decide(long, { steps: 9 });
  await settle();
  assert.equal(jobOf(long).state, 'stalled', 'the budget is the budget');
  assert.equal(memory.getSession(long).modelChoice ?? null, null);
});

test('with no stronger model named, a looping job is blocked exactly as before', async () => {
  fresh();
  catalog.saveConfig(catalog.BUILTIN_ID, { escalateTo: null });
  const id = job('Plain');
  supervisor.decide(id, { steps: 4, looped: loopedSignal() });
  await settle();
  assert.equal(jobOf(id).state, 'blocked');
  assert.equal(memory.getSession(id).modelChoice ?? null, null);
});

test('a turn that failed blocks its job with the reason, instead of being woken into the same failure', async () => {
  fresh();
  const id = job('No model');
  assert.equal(supervisor.decide(id, { steps: null, failed: 'No model chosen for the DOCA harness' }), 'woken', 'the Orchestrator is told');
  await settle();
  assert.equal(jobOf(id).state, 'blocked');
  assert.ok(!woken.some(w => w.sessionId === id), 'no further turn for the failing job');
  assert.match(woken.at(-1).message, /Blocked: its turn failed — No model chosen/);
});

test('a mission recorded after its turn ended still wakes its lead — once (audit 2026-10-04)', async () => {
  fresh();
  const id = job('Airlock lead');
  const spec = memory.createSession('Scout', { activate: false, kind: 'specialist', parentId: id });
  const rows = [{ id: 'msn_air', agentId: 'scout', label: 'Scout', by: id, state: 'running', sessionId: spec.id }];
  store.writeJson('agents/missions', { missions: rows });
  memory.updateSession(id, { job: { ...jobOf(id), state: 'waiting' } });
  assert.equal(supervisor.missionEnded(org.session(spec.id)), 'mission running', 'the turn ended while the screening awaited');
  rows[0].state = 'done';
  store.writeJson('agents/missions', { missions: rows });
  assert.equal(supervisor.missionEnded(org.session(spec.id)), 'woken', 'the record lands, and the lead is woken');
  await settle();
  memory.updateSession(id, { job: { ...jobOf(id), state: 'waiting' } });
  assert.equal(supervisor.missionEnded(org.session(spec.id)), 'already woken', 'a second path does not wake it twice');
  store.writeJson('agents/missions', { missions: [] });
});

test('stop means stop: a specialist a person stopped leaves its work chat waiting, and the Orchestrator is not woken after its own Stop', async () => {
  fresh();
  const id = job('Lead stopped');
  const spec = memory.createSession('Specialist', { activate: false, kind: 'specialist', parentId: id });
  store.writeJson('agents/missions', { missions: [{ id: 'msn_s', agentId: 'blender', label: 'Blender', by: id, state: 'cancelled', sessionId: spec.id }] });
  assert.equal(supervisor.decide(spec.id, { stopped: true, steps: 1 }), 'stopped');
  assert.equal(jobOf(id).state, 'stopped', 'its work chat waits for the person');
  assert.match(jobOf(id).stoppedWhy, /Blender was stopped by a person/);
  await settle();
  assert.equal(woken.length, 0, 'nothing carried on');
  org.report(job('Done job'), 'done', 'all done');
  assert.equal(supervisor.decide(ceo(), { stopped: true }), 'stopped', 'the Orchestrator\'s Stop is not followed by a wake for its reports');
  await settle();
  assert.equal(woken.length, 0);
  store.writeJson('agents/missions', { missions: [] });
});

test('a work chat a person stopped stops the specialists it sent', async () => {
  fresh();
  const id = job('Stops its line');
  const spec = memory.createSession('Specialist', { activate: false, kind: 'specialist', parentId: id });
  store.writeJson('agents/missions', { missions: [{ id: 'msn_r', agentId: 'qwen', label: 'Qwen', by: id, state: 'running', sessionId: spec.id }] });
  const ctrl = new AbortController();
  lifecycle.running.set(spec.id, ctrl);
  supervisor.decide(id, { stopped: true });
  assert.equal(ctrl.signal.aborted, true, 'its specialist was stopped too');
  lifecycle.running.delete(spec.id);
  store.writeJson('agents/missions', { missions: [] });
});

test('putting finished work away notifies nobody and starts nothing', async () => {
  const missions = require('../modules/agents/missions');
  store.writeJson('agents/missions', { missions: [{ id: 'msn_f', agentId: 'qwen', label: 'Qwen', by: ceo(), state: 'done', sessionId: null, endedAt: new Date().toISOString() }] });
  const { device } = H.mkDevice('Phone', 'phone', H.PHONE_CAPS);
  const sent = [];
  const pub = bus.publish;
  bus.publish = (id, type, payload, o) => { if (id === device.id) sent.push({ type, payload }); return pub.call(bus, id, type, payload, o); };
  try { missions.archive('msn_f'); } finally { bus.publish = pub; }
  assert.ok(sent.length >= 1, 'the device hears it, to take the row off its list');
  assert.ok(sent.every(e => e.payload.quiet === true && e.payload.archivedAt), 'without a notification');
  store.writeJson('agents/missions', { missions: [] });
});

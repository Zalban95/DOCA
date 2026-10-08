'use strict';

/**
 * What a mission's unanswered machine question becomes (harness.approval.missionAskTimeout; asked 2026-10-08: "the
 * timeout counts as hold instead of no, or even better a setting: default no or hold"). Hold, the default: the
 * question stays open at the panel past the wait, the copy on the person's device is withdrawn, the mission waits
 * without spending a step, a late Allow runs it, a person's Stop withdraws it, and a restart keeps a note the resumed
 * mission reads. Deny is the older behaviour (test/mission-asks.test.js). Against fixtures/rfb-stub.js.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const stub = require('./fixtures/rfb-stub');

test.after(() => H.stop());

const until = async (fn, what, tries = 300) => {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(`timed out waiting for ${what}`);
};

test('an unanswered machine question is held open, runs on a late Allow, and a Stop withdraws it', async t => {
  const s = await stub.start({ password: 'secret', width: 4, height: 2 });
  t.after(() => s.close());
  await H.start();
  const store = require('../modules/store');
  const memory = require('../modules/harness/memory');
  const approval = require('../modules/harness/approval');
  const answer = require('../modules/harness/approval-answer');
  const asks = require('../modules/harness/mission-asks');
  const held = require('../modules/harness/mission-asks-held');
  const missions = require('../modules/agents/missions');
  const lifecycle = require('../modules/harness/turn/lifecycle');
  const devices = require('../modules/api-v1/devices');
  const prompts = require('../modules/api-v1/prompts');
  const tools = require('../modules/harness/tools');
  const { runToolCalls } = require('../modules/harness/turn/tool-calls');

  const add = await H.api(null, 'POST', '/api/machines/vnc', { name: 'desk', host: '127.0.0.1', port: s.port, password: 'secret' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const member = await H.signIn('member');
  const phone = devices.create({ name: 'my phone', scopes: ['interact', 'harness:chat'], caps: H.PHONE_CAPS, kind: 'device' }).device;
  devices.update(phone.id, { userId: member.user.id, orgId: member.orgId });
  const lead = memory.createSession('the member\'s chat', { activate: false });
  require('../modules/harness/session-access').claim(member.user, lead.id);

  // A running mission of the member's, as the missions index records one, its turn registered as running.
  const mission = id => {
    const session = memory.createSession('a mission', { activate: false, kind: 'specialist', parentId: lead.id,
      profile: { id: 'tester', label: 'Tester', vnc: add.body.id } });
    const row = { id, agentId: 'tester', label: 'Tester', task: 'try the desk', sessionId: session.id, state: 'running', startedAt: new Date().toISOString(), steps: 0, tokens: 0 };
    store.writeJson('agents/missions', { missions: [...missions.list({ limit: 200 }), row] });
    const ctrl = new AbortController();
    lifecycle.running.set(session.id, ctrl);
    t.after(() => lifecycle.running.delete(session.id));
    const events = [];
    const run = runToolCalls({ reply: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'vnc_input', arguments: JSON.stringify({ target: 'desk', action: 'type', text: 'hi' }) } }] },
      schemas: tools.schemas([]), stepDisabled: [], session, signal: ctrl.signal, client: null,
      profile: session.profile, isMission: true, step: 1, say: e => events.push(e), announced: new Set() });
    let result = null;
    run.then(() => { result = events.find(e => e.type === 'tool_result')?.result; });
    return { session, events, result: () => result };
  };

  assert.equal(asks.onTimeout(), 'hold', 'hold is the default');
  const was = asks.waitSec;
  asks.waitSec = () => 0.2;
  t.after(() => { asks.waitSec = was; });

  // 1. Hold: past the wait, still open at the panel; the mission says it waits; a restart need not wait for it.
  const m1 = mission('msn_hold1');
  const q = await until(() => approval.pending().find(p => p.sessionId === m1.session.id), 'the question');
  assert.equal(q.held, true);
  assert.match(q.summary, /waits, paused, until you answer/);
  await until(() => prompts.list({ state: 'open' }).find(p => p.targets?.includes(phone.id)), 'the device question');
  await new Promise(r => setTimeout(r, 600));   // three times the wait
  assert.equal(m1.result(), null, 'still waiting: not denied');
  assert.ok(approval.pending().some(p => p.id === q.id), 'the panel\'s question stays');
  assert.deepEqual(missions.get('msn_hold1').asking?.what, 'type (2 characters)', 'the bar says what it waits for');
  assert.ok(held.list().some(h => h.missionId === 'msn_hold1'), 'kept for a restart');
  assert.ok(!require('../modules/harness/drain').busy().some(b => b.sessionId === m1.session.id), 'a restart does not wait for it');
  const steps = m1.events.filter(e => e.type === 'usage').length;
  // The device's copy is withdrawn after its own wait (reach.ask holds one at least five seconds).
  await until(() => !prompts.list({ state: 'open' }).some(p => p.targets?.includes(phone.id)), 'the device copy withdrawn', 400);
  assert.ok(approval.pending().some(p => p.id === q.id), 'the panel\'s copy still stays');

  // A late Allow runs it.
  answer.answerAs({ id: q.id, decision: 'once', person: { ...member.user, role: 'member' } });
  await until(() => m1.result(), 'the call to run');
  assert.match(m1.result(), /^Typed 2 characters on desk/);
  assert.equal(m1.events.filter(e => e.type === 'usage').length, steps, 'no step was spent waiting');
  assert.equal(missions.get('msn_hold1').asking, null);
  assert.ok(!held.list().some(h => h.missionId === 'msn_hold1'));

  // 2. A person's Stop on the mission withdraws a held question.
  const m2 = mission('msn_hold2');
  const q2 = await until(() => approval.pending().find(p => p.sessionId === m2.session.id), 'the second question');
  await new Promise(r => setTimeout(r, 400));
  const stop = await H.api(null, 'POST', '/api/harness/missions/msn_hold2/stop');
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  await until(() => m2.result(), 'the stop');
  assert.match(m2.result(), /the mission was stopped while it waited/);
  assert.ok(!approval.pending().some(p => p.id === q2.id), 'withdrawn');
  assert.equal(missions.get('msn_hold2').asking, null);

  // 3. A restart: the question went with the process, the note did not — the resumed mission reads it once.
  held.asking('msn_hold3', { id: 'apr_x', sessionId: 'sess_x', tool: 'vnc_input', what: 'click at 1,1', machine: 'the VNC screen desk' });
  const note = held.resumeNote('msn_hold3');
  assert.match(note, /waiting for your person to allow you to click at 1,1 on the VNC screen desk[\s\S]*make that call again/);
  assert.equal(held.resumeNote('msn_hold3'), '', 'told once');

  // 4. The setting: declared, never proposable, set in Approvals beside the seconds.
  const schema = require('../modules/settings-schema');
  assert.equal(schema.unproposable('harness.approval.missionAskTimeout'), 'harness.approval.missionAskTimeout');
  assert.equal((await H.api(null, 'GET', '/api/harness/approval')).body.missionAskTimeout, 'hold');
  assert.equal((await H.api(null, 'POST', '/api/harness/approval', { missionAskTimeout: 'maybe' })).status, 400);
  assert.equal((await H.api(null, 'POST', '/api/harness/approval', { missionAskTimeout: 'deny', missionAskSec: 60 })).status, 200);
  assert.equal(asks.onTimeout(), 'deny');
  assert.equal((await H.api(null, 'GET', '/api/harness/approval')).body.missionAskTimeout, 'deny');
  assert.equal(approval.settings().mode, 'auto', 'the mode is untouched');
  // Deny refuses at the timeout.
  const m4 = mission('msn_hold4');
  await until(() => m4.result(), 'the denial');
  assert.match(m4.result(), /nobody answered within 0\.2 seconds, so it was denied/);
  assert.ok(!held.list().some(h => h.missionId === 'msn_hold4'));
});

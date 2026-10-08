'use strict';

/**
 * A mission's use of a machine, asked of its person (modules/harness/mission-asks.js; the owner's rule, 2026-10-08):
 * a specialist's vnc_input on the VNC screen lent to it, and a sign-in on the computer lent to it (not a test
 * computer), are asked of the person who owns the mission's conversation — on their own devices and open pages, first
 * answer wins, once or deny, never "always" — and denied when nobody answers. Every other forced ask, and paying, is
 * still refused in a mission. Against fixtures/rfb-stub.js; the computer's classify is stood in for.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const stub = require('./fixtures/rfb-stub');

test.after(() => H.stop());

const until = async (fn, what) => {
  for (let i = 0; i < 300; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 10)); }
  throw new Error(`timed out waiting for ${what}`);
};

/** A page's live stream, as the panel opens it: the changes it hears. */
async function liveOf(cookie) {
  const ctrl = new AbortController();
  const heard = [];
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: cookie, Accept: 'text/event-stream' }, signal: ctrl.signal });
  (async () => {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = frame.split('\n').find(l => l.startsWith('data:'));
          if (line) heard.push(JSON.parse(line.slice(5)));
        }
      }
    } catch { /* closed */ }
  })();
  await until(() => heard.some(h => h.hello), 'the stream to open');
  return { heard, close: () => ctrl.abort() };
}

test('a mission asks its person to use the machine lent to it; everything else stays refused', async t => {
  const s = await stub.start({ password: 'secret', width: 4, height: 2 });
  t.after(() => s.close());
  await H.start();
  const memory = require('../modules/harness/memory');
  const approval = require('../modules/harness/approval');
  const answer = require('../modules/harness/approval-answer');
  const asks = require('../modules/harness/mission-asks');
  const devices = require('../modules/api-v1/devices');
  const prompts = require('../modules/api-v1/prompts');
  const tools = require('../modules/harness/tools');
  const { runToolCalls } = require('../modules/harness/turn/tool-calls');

  const add = await H.api(null, 'POST', '/api/machines/vnc', { name: 'desk', host: '127.0.0.1', port: s.port, password: 'secret' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const vncId = add.body.id;

  // The mission's person, someone else, and a device each.
  const member = await H.signIn('member');
  const other = await H.signIn('member');
  const mine = devices.create({ name: 'my phone', scopes: ['interact', 'harness:chat'], caps: H.PHONE_CAPS, kind: 'device' }).device;
  devices.update(mine.id, { userId: member.user.id, orgId: member.orgId });
  const theirs = devices.create({ name: `their phone ${mine.id}`, scopes: ['interact', 'harness:chat'], caps: H.PHONE_CAPS, kind: 'device' }).device;
  devices.update(theirs.id, { userId: other.user.id, orgId: other.orgId });

  // A specialist's conversation below the member's own, lent the VNC screen and a computer.
  const lead = memory.createSession('the member\'s chat', { activate: false });
  require('../modules/harness/session-access').claim(member.user, lead.id);
  const computers = require('../modules/computers');
  computers.save([...computers.all(), { id: 'c0ffee01', name: 'site box', test: false }, { id: 'c0ffee02', name: 'test box', test: true }]);
  const mission = (profile = {}) => memory.createSession('a mission', { activate: false, kind: 'specialist', parentId: lead.id,
    profile: { id: 'tester', label: 'Tester', vnc: vncId, computer: 'c0ffee01', ...profile } });

  const call = (session, name, args) => {
    const events = [];
    const run = runToolCalls({ reply: { tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
      schemas: tools.schemas([]), stepDisabled: [], session, signal: new AbortController().signal, client: null,
      profile: session.profile, isMission: true, step: 1, say: e => events.push(e), announced: new Set() });
    return { events, run, result: async () => { await run; return events.find(e => e.type === 'tool_result').result; } };
  };
  const waiting = sid => until(() => approval.pending().find(p => p.sessionId === sid), 'the question');

  const memberPage = await liveOf(member.cookie);
  const otherPage = await liveOf(other.cookie);
  t.after(() => { memberPage.close(); otherPage.close(); });

  // 1. vnc_input asks the mission's person and runs on Allow, from their own device.
  const m1 = mission();
  const c1 = call(m1, 'vnc_input', { target: 'desk', action: 'type', text: 'hello there' });
  const q = await waiting(m1.id);
  assert.deepEqual([q.machine, q.forced, q.keys, q.personId], [true, true, null, member.user.id]);
  assert.match(q.summary, /Tester[\s\S]*type \(11 characters\) on the VNC screen desk/);
  assert.ok(!q.summary.includes('hello there'), 'never what it would type');
  const prompt = await until(() => prompts.list({ state: 'open' }).find(p => p.targets?.includes(mine.id)), 'the device question');
  assert.ok(!prompt.targets.includes(theirs.id), 'another person\'s device is never asked — not even one whose name holds the id');
  assert.deepEqual(prompt.choices.map(c => c.id), ['approve', 'deny', 'not_now'], 'allow once or deny: no "always"');
  await until(() => memberPage.heard.find(h => h.topic === 'ask' && h.what === 'asked' && h.id === q.id), 'the popup on the person\'s page');
  assert.ok(!otherPage.heard.some(h => h.topic === 'ask'), 'another person\'s page hears nothing of it');
  // No "always" and no "approve all", from anywhere.
  assert.throws(() => answer.answerAs({ id: q.id, decision: 'always', person: { ...member.user, role: 'member' } }), /only be allowed once/);
  assert.throws(() => answer.answerAs({ id: q.id, decision: 'approve_all', person: { ...H.owner.user, role: 'owner' } }), /asked each time/);
  assert.throws(() => answer.answerAs({ id: q.id, decision: 'once', person: { ...other.user, role: 'member' } }), /someone else/);
  assert.equal(answer.approveAll({ person: { ...H.owner.user, role: 'owner' } }), 0, 'approve all passes it by');
  await prompts.select(prompt.id, devices.get(mine.id), { selectionId: 'sel-1', choiceId: 'approve' });
  assert.match(await c1.result(), /^Typed 11 characters on desk/);
  assert.ok(!/Not run/.test(await c1.result()), await c1.result());
  assert.ok(c1.events.some(e => e.type === 'approval' && e.state === 'answered' && e.decision === 'once'));
  await until(() => memberPage.heard.find(h => h.topic === 'ask' && h.what === 'answered' && h.id === q.id), 'the popup taken down');

  // 2. Denied at the panel: not run, with the line the mission reports.
  const m2 = mission();
  const c2 = call(m2, 'vnc_input', { target: 'desk', action: 'click', x: 1, y: 1 });
  const q2 = await waiting(m2.id);
  answer.answerAs({ id: q2.id, decision: 'deny', person: { ...member.user, role: 'member' } });
  assert.match(await c2.result(), /^Not run: asked to click at 1,1 on the VNC screen desk, and your person denied it\. Report this to your leader/);

  // 3. Nobody answers: denied when the wait is over.
  const was = asks.waitSec;
  asks.waitSec = () => 0.2;
  const m3 = mission();
  const c3 = call(m3, 'vnc_input', { target: 'desk', action: 'key', keys: 'Enter' });
  assert.match(await c3.result(), /nobody answered within 0\.2 seconds, so it was denied\. Report this to your leader/);
  asks.waitSec = was;
  assert.ok(!approval.pending().some(p => p.sessionId === m3.id), 'the question withdrew itself');

  // 4. A screen not lent to it, and every other forced ask, are refused unasked as before.
  const refusedUnasked = async (session, name, args, re) => {
    const c = call(session, name, args);
    const r = await c.result();
    assert.match(r, re, `${name}: ${r}`);
    assert.ok(!c.events.some(e => e.type === 'approval' && e.state === 'asked'), `${name} was asked`);
  };
  await refusedUnasked(mission({ vnc: null }), 'vnc_input', { target: 'desk', action: 'click', x: 1, y: 1 }, /^Not run: [\s\S]*not lent to this mission/);
  await refusedUnasked(mission(), 'computer_login', { computer: 'c0ffee01', login: 'bank' }, /^Not run: [\s\S]*A mission has nobody to ask about this/);
  await refusedUnasked(mission(), 'mcp__phone__screen_press', { x: 1, y: 1, confirm: true }, /^Not run: [\s\S]*A mission has nobody to ask about this/);

  // 5. Its computer: a sign-in is asked; paying is still refused; a test computer, or one not lent, is never asked.
  const real = asks.computerCall;
  let kind = { kind: 'decision', label: 'Sign in', signIn: true };
  asks.computerCall = async (c, tool, args) => { assert.equal(tool, 'browser_classify'); assert.equal(args.ref, 7); return JSON.stringify(kind); };
  t.after(() => { asks.computerCall = real; });
  const m5 = mission();
  const c5 = call(m5, 'mcp__computer-c0ffee01__browser_click', { ref: 7, confirm: true });
  const q5 = await waiting(m5.id);
  assert.match(q5.summary, /click \[7\] "Sign in" — a sign-in on the computer site box/);
  answer.answerAs({ id: q5.id, decision: 'deny', person: { ...member.user, role: 'member' } });
  assert.match(await c5.result(), /your person denied it/);
  kind = { kind: 'decision', label: 'Pay now', signIn: false };
  await refusedUnasked(mission(), 'mcp__computer-c0ffee01__browser_click', { ref: 7, confirm: true }, /^Not run: [\s\S]*pays, buys[\s\S]*nobody to ask about this/);
  kind = { kind: 'decision', label: 'Sign in', signIn: true };
  await refusedUnasked(mission({ computer: 'c0ffee02' }), 'mcp__computer-c0ffee02__browser_click', { ref: 7, confirm: true }, /^Not run: /);
  await refusedUnasked(mission(), 'mcp__computer-c0ffee02__browser_click', { ref: 7, confirm: true }, /^Not run: /);

  // The wait is a declared setting the agent never proposes, set by a person in Approvals.
  assert.equal(asks.waitSec(), 300);
  assert.equal(require('../modules/settings-schema').unproposable('harness.approval.missionAskSec'), 'harness.approval.missionAskSec');
  assert.equal((await H.api(null, 'POST', '/api/harness/approval', { missionAskSec: 120 })).status, 200);
  assert.equal(asks.waitSec(), 120);
  assert.equal((await H.api(null, 'POST', '/api/harness/approval', { missionAskSec: 5 })).status, 400);
  assert.equal(approval.settings().mode, 'auto', 'the mode is untouched');
  assert.equal((await H.api(null, 'GET', '/api/harness/approval')).body.missionAskSec, 120);
});

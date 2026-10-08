'use strict';

// A question asked while a call is open (harness/call-answer.js, realtime/call-asks.js, public/js/chat-call-ask.js;
// the owner, 2026-10-08: a Live call's approval waited unseen behind the call screen): the card is drawn on top of the
// call, the question is said in the call's voice, and a spoken yes or no answers it — anything else is a message and
// the question stays open. The browser half runs in a sandbox with stand-ins for the DOM and audio.

const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const callAnswer = require('../modules/harness/call-answer');
const approval   = require('../modules/harness/approval');

const JS = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
const CSS = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'css', f), 'utf8');

test.before(() => H.start());
test.after(() => H.stop());

test('what a spoken reply means: a plain yes or no in the person\'s language, else nothing', () => {
  for (const said of ['Yes.', 'yeah', 'Go ahead!', 'okay', 'Sì.', 'Va bene', 'sì, grazie', 'certo', 'procedi', 'yes yes'])
    assert.equal(callAnswer.heard(said)?.decision, 'once', said);
  for (const said of ['No.', 'stop', 'No, stop.', 'don\'t', 'Annulla', 'no grazie', 'non farlo', 'nein'])
    assert.equal(callAnswer.heard(said)?.decision, 'deny', said);
  for (const said of ['What is the weather tomorrow?', 'yes but set it to Rome instead please and thanks', 'maybe', '', 'Pesaro'])
    assert.equal(callAnswer.heard(said), null, said);
  assert.equal(callAnswer.heard('Sì.').lang, 'it');
});

test('the question is one short sentence a voice can say', () => {
  assert.equal(callAnswer.sentence('settings_propose', { changes: [{ path: 'ambient.place', value: 'Pesaro' }] }), 'Shall I set ambient\'s place to Pesaro? Say yes or no.');
  assert.equal(callAnswer.sentence('api_call', { url: 'https://api.example.com/x', method: 'post' }), 'Shall I send a POST request to api.example.com? Say yes or no.');
  assert.equal(callAnswer.sentence('mcp__phone__screen_press', {}), 'Shall I use screen press? Say yes or no.');
});

test('the card stacks above the call\'s face, and inside whatever is full screen', () => {
  const z = (css, sel) => Number(new RegExp(`\\${sel}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1]);
  assert.ok(z(CSS('components.css'), '.approval-overlay') > z(CSS('face.css'), '.face-assistant'), 'above the face');
  const el = () => ({ children: [], style: {}, classList: { add() {}, toggle() {} }, appendChild(c) { this.children.push(c); return c; }, querySelector: () => null, remove() {} });
  const face = el(), body = el();
  const sandbox = { document: { createElement: el, getElementById: () => null, body, documentElement: {}, fullscreenElement: face }, CSS: { escape: s => s } };
  vm.createContext(sandbox);
  vm.runInContext(`${JS('agent-ui/approval.js')}\n;approvalCardEl = () => ({ querySelector: () => null });`, sandbox);
  sandbox.approvalPopup({ tool: 'settings_propose', keys: null }, () => {});
  assert.equal(face.children.length, 1, 'drawn inside the full-screen call');
  assert.equal(body.children.length, 0);
  sandbox.document.fullscreenElement = null;
  sandbox.document.getElementById = () => null;
  sandbox.approvalPopup({ tool: 'x', keys: null }, () => {});
  assert.equal(body.children.length, 1, 'and on the page when nothing is full screen');
});

function browserCall() {
  const said = [], reports = [], posts = [];
  let answer = { decision: null };
  const sandbox = {
    console, setTimeout, clearTimeout, Math, Date, Uint8Array, performance,
    document: { getElementById: () => null },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    MediaRecorder: Object.assign(function MediaRecorder() { this.state = 'recording'; this.start = () => {}; this.stop = () => {}; sandbox.recorded = (sandbox.recorded || 0) + 1; }, { isTypeSupported: () => true }),
    chatAppendMsg: () => {},
    apiFetch: async (url, o) => { if (url.startsWith('/api/harness/approvals/')) { posts.push([url, o.body]); return answer; } return {}; },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${['lib/mic.js', 'chat-call.js', 'chat-call-report.js', 'chat-call-hear.js', 'chat-call-ask.js', 'chat-call-voice.js', 'chat-call-hold.js', 'chat-call-mic.js'].map(JS).join('\n')}
    ;globalThis.__ = { get: n => eval(n), set: (n, v) => eval(n + ' = v') };`, sandbox);
  const s = sandbox.__;
  s.set('_callEnqueueSynth', t => said.push(t));
  s.set('_callReport', (stage, f) => reports.push([stage, f]));
  s.set('_callActive', true);
  return { s, sandbox, said, reports, posts, answer: a => { answer = a; } };
}

test('in the panel\'s call: the question is said, listened for while the turn waits, and a yes, a no or other words', async () => {
  const c = browserCall();
  c.s.get('callAskEvent')({ type: 'approval', state: 'asked', id: 'apr_1', tool: 'settings_propose', spoken: 'Shall I set ambient\'s place to Pesaro? Say yes or no.' });
  assert.equal(JSON.stringify(c.said), JSON.stringify(['Shall I set ambient\'s place to Pesaro? Say yes or no.']), 'said in the call\'s voice');
  assert.equal(JSON.stringify(c.reports[0]), JSON.stringify(['ask', { tool: 'settings_propose' }]), 'the call log keeps that it was asked');

  // The turn is waiting (an answer in flight): the call listens anyway, for the answer.
  c.s.set('_callProcessing', 1); c.s.set('_callStream', {});
  c.s.set('_callAnalyser', { frequencyBinCount: 8, getByteFrequencyData: d => d.fill(200) });
  c.s.get('_callVadLoop')();
  assert.equal(c.sandbox.recorded, 1, 'speech is recorded while the question waits');

  c.answer({ decision: null });
  assert.equal(await c.s.get('callAskAnswer')('What is the weather in Pesaro?'), false, 'other words go on as a message');
  assert.equal(c.s.get('callAskWaiting')(), true, 'and the question stays open');
  assert.equal(JSON.stringify(c.posts[0][1]), JSON.stringify({ heard: 'What is the weather in Pesaro?' }), 'the hub decides what the words mean');

  c.answer({ decision: 'once', reply: 'Va bene, procedo.' });
  assert.equal(await c.s.get('callAskAnswer')('Sì.'), true);
  assert.equal(c.said.at(-1), 'Va bene, procedo.', 'confirmed aloud');
  assert.equal(JSON.stringify(c.reports.at(-1)), JSON.stringify(['answered', { decision: 'once', tool: 'settings_propose' }]));
  assert.equal(c.s.get('callAskWaiting')(), false);

  c.s.get('callAskEvent')({ type: 'approval', state: 'asked', id: 'apr_2', tool: 'shell', spoken: 'Shall I run git push? Say yes or no.' });
  c.answer({ decision: 'deny', reply: 'All right — I won\'t.' });
  assert.equal(await c.s.get('callAskAnswer')('No.'), true);
  assert.equal(c.said.at(-1), 'All right — I won\'t.');
});

test('the hub takes a spoken reply to a waiting question: yes allows once, no denies, other words leave it open', async () => {
  const ask = () => approval.ask({ tool: 'settings_propose', keys: ['settings_propose'], summary: 'x', personId: H.owner.user.id }, {});
  const a = ask();
  const other = await H.api(null, 'POST', `/api/harness/approvals/${a.id}`, { heard: 'what time is it' });
  assert.equal(other.status, 200);
  assert.equal(other.body.decision, null);
  assert.ok(approval.entry(a.id), 'still waiting');
  const yes = await H.api(null, 'POST', `/api/harness/approvals/${a.id}`, { heard: 'Yes, go ahead' });
  assert.equal(yes.body.decision, 'once');
  assert.equal(await a.answer, 'once', 'allowed once — never "always" by voice');
  assert.deepEqual(approval.settings().always, [], 'nothing remembered');
  const b = ask();
  const no = await H.api(null, 'POST', `/api/harness/approvals/${b.id}`, { heard: 'no' });
  assert.equal(no.body.decision, 'deny');
  assert.equal(await b.answer, 'deny');
});

test('a device\'s call: the question is said into the call, and a spoken yes or no answers it', async () => {
  const lifecycle = require('../modules/harness/turn/lifecycle');
  const said = [], notes = [];
  const model = { literal: true, say: t => said.push(t) };
  const log = { note: t => notes.push(t) };
  const person = { ...H.owner.user, role: 'owner' };
  const asks = require('../modules/realtime/call-asks').attach({ sessionId: 's_call', model, log, person });
  try {
    assert.equal(asks.take('yes'), null, 'nothing waits: a yes is just words');
    const q = approval.ask({ tool: 'settings_propose', keys: null, summary: 'x', personId: person.id }, {});
    lifecycle.events.emit('event', { sessionId: 's_other', type: 'approval', state: 'asked', id: 'apr_x', tool: 'shell', spoken: 'Not this call.' });
    lifecycle.events.emit('event', { sessionId: 's_call', type: 'approval', state: 'asked', id: q.id, tool: 'settings_propose', spoken: 'Shall I set ambient\'s place to Pesaro? Say yes or no.' });
    assert.deepEqual(said, ['Shall I set ambient\'s place to Pesaro? Say yes or no.'], 'only this call\'s question is said');
    assert.equal(asks.take('tell me a joke'), null, 'other words go on');
    assert.ok(approval.entry(q.id));
    assert.equal(asks.take('Sì'), 'Va bene, procedo.');
    assert.equal(await q.answer, 'once');
    assert.ok(notes.some(n => /asked in the call: may settings_propose run/.test(n)));
    assert.ok(notes.some(n => /answered by voice: allowed once \(settings_propose\)/.test(n)), 'the call log keeps the answer, never the words');
  } finally { asks.off(); }
});

'use strict';

// The face (modules/face/state.js, TODO H8.1): one state for the hive, made from the events a turn already
// sends, and seen per viewer — a member's screen shows only the conversations they may open.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let face, lifecycle, memory;
before(async () => {
  await H.start();
  face = require('../modules/face/state');
  lifecycle = require('../modules/harness/turn/lifecycle');
  memory = require('../modules/harness/memory');
});
after(() => H.stop());
beforeEach(() => face._reset());

const running = id => lifecycle.running.set(id, new AbortController());
const owner = () => ({ id: H.owner.user.id, role: 'owner' });

test('a turn\'s events become the face\'s state, the strongest one winning', () => {
  const s = memory.createSession('face a', { activate: false });
  running(s.id);
  try {
    face.onEvent({ sessionId: s.id, type: 'session' });
    assert.equal(face.viewFor(owner()).state, 'thinking');
    face.onEvent({ sessionId: s.id, type: 'tool_call', name: 'mcp__computer-ab12__browser_open' });
    assert.deepEqual(face.viewFor(owner()), { state: 'working', detail: 'computer-ab12 · browser_open' });
    face.onEvent({ sessionId: s.id, type: 'text', text: 'Hi' });
    assert.equal(face.viewFor(owner()).state, 'speaking');
    face.onEvent({ sessionId: s.id, type: 'approval', state: 'asked', tool: 'shell' });
    assert.deepEqual(face.viewFor(owner()), { state: 'asking', detail: 'shell' });
  } finally { lifecycle.running.delete(s.id); }
});

test('a turn that ended is idle, and one that failed is an error for a moment', () => {
  const a = memory.createSession('face b', { activate: false });
  const b = memory.createSession('face c', { activate: false });
  running(a.id); running(b.id);
  face.onEvent({ sessionId: a.id, type: 'session' });
  face.onEvent({ sessionId: b.id, type: 'session' });
  lifecycle.running.delete(a.id); lifecycle.running.delete(b.id);
  memory.updateSession(b.id, { state: 'failed' });
  face.sweep();
  assert.equal(face.viewFor(owner()).state, 'error');
  memory.updateSession(b.id, { state: 'idle' });
});

test('a member\'s face shows only their own conversations, and no tool names', async () => {
  const member = await H.signIn('member', 'face-member@test.local');
  const theirs = memory.createSession('member face', { activate: false });
  const mine = memory.createSession('owner face', { activate: false });
  const access = require('../modules/harness/session-access');
  const person = { id: member.user.id, role: 'member' };
  access.claim(person, theirs.id);
  access.claim(owner(), mine.id);
  running(mine.id); running(theirs.id);
  try {
    face.onEvent({ sessionId: mine.id, type: 'tool_call', name: 'shell' });
    assert.equal(face.viewFor(person).state, 'idle', 'the owner\'s work is not on the member\'s face');
    face.onEvent({ sessionId: theirs.id, type: 'tool_call', name: 'git' });
    assert.deepEqual(face.viewFor(person), { state: 'working', detail: null });
    assert.deepEqual(face.viewFor(owner()), { state: 'working', detail: 'shell' });
  } finally { lifecycle.running.delete(mine.id); lifecycle.running.delete(theirs.id); }
});

test('the feed is an SSE stream a signed-in person can open; a viewer cannot', async () => {
  const res = await fetch(`${H.base}/api/face/stream`, { headers: { Cookie: H.owner.cookie } });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /^data: \{"state":"(idle|thinking|working|speaking|asking|error)"/);
  await reader.cancel();
  const viewer = await H.signIn('viewer', 'face-viewer@test.local');
  assert.equal((await fetch(`${H.base}/api/face/stream`, { headers: { Cookie: viewer.cookie } })).status, 403);
  const page = await fetch(`${H.base}/face`, { headers: { Cookie: H.owner.cookie }, redirect: 'manual' });
  assert.equal(page.headers.get('location'), '/face.html');
});

'use strict';

/**
 * Read means done (CONSTITUTION V10; TODO P1.4; harness/seen.js): a finished mission or work chat opened by its person
 * is `seenAt` — the panel's live bar drops it, devices hear it quietly — while running work, someone else's work and
 * a host looking at a member's are left as they are; work that runs again waits to be opened again.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const store  = () => require('../modules/store');
const memory = () => require('../modules/harness/memory');
const bus    = () => require('../modules/api-v1/bus');

/** A mission row as missions.js keeps it, finished or not. */
function mission(id, state, sessionId) {
  const doc = store().readJson('agents/missions', { missions: [] });
  doc.missions.push({ id, agentId: 'archivist', label: 'Archivist', task: 't', state, sessionId, by: sessionId, startedAt: new Date().toISOString(), steps: 1, tokens: 0 });
  store().writeJson('agents/missions', doc);
}

test('a finished mission opened by its person: seen, out of the live bar, devices told quietly', async () => {
  const watch = H.mkDevice('Seen wrist', 'watch', H.WATCH_CAPS);
  const s = memory().createSession('Mission chat', { activate: false });
  mission('m_seen1', 'done', s.id);
  mission('m_run1', 'running', s.id);
  let live = await H.api(null, 'GET', '/api/harness/missions?live=1');
  assert.ok(live.body.missions.some(m => m.id === 'm_seen1'), 'finished and unopened: still in the live bar');

  let r = await H.api(null, 'POST', '/api/harness/seen/m_run1', {});
  assert.equal(r.body.seen, false, 'running work is not done by being looked at');
  r = await H.api(null, 'POST', '/api/harness/seen/m_seen1', {});
  assert.deepEqual(r.body, { seen: true, kind: 'mission' });
  live = await H.api(null, 'GET', '/api/harness/missions?live=1');
  assert.ok(!live.body.missions.some(m => m.id === 'm_seen1'), 'opened: done, off the live bar');
  assert.ok(live.body.missions.some(m => m.id === 'm_run1'));
  const p = [...bus().drain(watch.device.id, 0).events || []].reverse().find(e => e.type === 'agent.mission' && e.payload.missionId === 'm_seen1')?.payload;
  assert.ok(p?.seenAt && p.quiet, 'devices hear seenAt, quietly');
});

test('a host opening a member\'s finished work does not mark it for them; the member\'s device does', async () => {
  const member = await H.signIn('member', 'seen-member@test.local');
  const s = memory().createSession('Their work', { activate: false, kind: 'work', parentId: memory().mainSession().id });
  memory().updateSession(s.id, { state: 'idle', person: { id: member.user.id } });
  let r = await H.api(null, 'POST', `/api/harness/seen/${s.id}`, {});
  assert.equal(r.body.seen, false, 'the owner looking is not the member reading');
  r = await H.api(null, 'POST', `/api/harness/seen/${s.id}`, {}, { Cookie: member.cookie, 'X-Doca-Password': '' });
  assert.deepEqual(r.body, { seen: true, kind: 'work' });
  assert.ok(memory().getSession(s.id).seenAt);

  const other = await H.signIn('member', 'seen-other@test.local');
  r = await H.api(null, 'POST', `/api/harness/seen/${s.id}`, {}, { Cookie: other.cookie, 'X-Doca-Password': '' });
  assert.equal(r.status, 404, 'another person\'s work is not there for them');
});

test('a device says it was opened; a turn that starts again clears it', async () => {
  const phone = H.mkDevice('Seen phone', 'phone', H.PHONE_CAPS);
  const s = memory().createSession('Device work', { activate: false, kind: 'work', parentId: memory().mainSession().id });
  memory().updateSession(s.id, { state: 'idle' });
  const r = await H.api(phone.token, 'POST', `/api/v1/harness/missions/${s.id}/seen`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.seen, true);
  assert.ok(require('../modules/harness/workview').payloadOf(require('../modules/harness/organization').session(s.id)).seenAt);
  memory().updateSession(s.id, { state: 'running', seenAt: null });   // what agent.js does as a turn starts
  assert.equal(require('../modules/harness/workview').payloadOf(require('../modules/harness/organization').session(s.id)).seenAt, undefined);
});

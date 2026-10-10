'use strict';

/**
 * A watch face's day (GET /api/v1/harness/today, DocaWear 1.5.2): jobs done of requested since the person's own
 * midnight, and the teams' mechanical progress — only this device's person's work, under harness:chat.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const memory = () => require('../modules/harness/memory');

function sessionOf(who, title) {
  const s = memory().createSession(title, { activate: false });
  memory().updateSession(s.id, { person: { id: who.user.id, orgId: who.orgId } });
  return s.id;
}

test('midnight is read on the person\'s clock', () => {
  const { midnight } = require('../modules/api-v1/today-route');
  // 23:30 UTC on 9 Oct is 01:30 on 10 Oct in Rome (UTC+2): its midnight is 22:00 UTC on 9 Oct.
  assert.equal(midnight(new Date('2026-10-09T23:30:00Z'), 'Europe/Rome').toISOString(), '2026-10-09T22:00:00.000Z');
  assert.equal(midnight(new Date('2026-10-09T23:30:00Z'), 'UTC').toISOString(), '2026-10-09T00:00:00.000Z');
});

test('today: this person\'s jobs done of requested, and their teams\' progress', async () => {
  const a = await H.signIn('member', 'today-a@test.local');
  const b = await H.signIn('member', 'today-b@test.local');
  const sa = sessionOf(a, 'a works'), sb = sessionOf(b, 'b works');
  const now = new Date().toISOString(), old = new Date(Date.now() - 3 * 86400000).toISOString();
  const row = (id, sessionId, state, startedAt, extra = {}) => ({ id, agentId: 'builder', label: id, task: id, sessionId, state, startedAt, ...extra });
  require('../modules/store').writeJson('agents/missions', { missions: [
    row('m1', sa, 'done', now), row('m2', sa, 'running', now), row('m3', sa, 'failed', now),
    row('m4', sa, 'done', now, { archivedAt: now }),   // put away, still done today
    row('m5', sa, 'done', old),                         // another day
    row('m6', sb, 'done', now),                         // another person's
  ] });
  const teams = require('../modules/teams/store');
  teams.save({ id: 'team_a1', title: 'Build the face', by: sa, state: 'running', tasks: [], createdAt: now, progress: { done: 1, total: 3, percent: 33 } });
  teams.save({ id: 'team_a0', title: 'Old and done', by: sa, state: 'done', tasks: [], createdAt: old, endedAt: old, progress: { done: 2, total: 2, percent: 100 } });
  teams.save({ id: 'team_b1', title: 'Not yours', by: sb, state: 'running', tasks: [], createdAt: now, progress: { done: 0, total: 1, percent: 0 } });

  const devices = require('../modules/api-v1/devices');
  const w = H.mkDevice('wrist', 'watch', H.WATCH_CAPS);
  devices.update(w.device.id, { userId: a.user.id });
  const r = await H.api(w.token, 'GET', '/api/v1/harness/today');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.body.jobs.requested, 4, JSON.stringify(r.body.jobs));
  assert.equal(r.body.jobs.done, 2);
  assert.equal(r.body.jobs.running, 1);
  assert.equal(r.body.jobs.failed, 1);
  assert.deepEqual(r.body.teams.map(t => t.teamId), ['team_a1'], 'running or of today, and only theirs');
  assert.deepEqual(r.body.teams[0].progress, { done: 1, total: 3, percent: 33 });

  const viewer = H.mkDevice('viewer', 'viewer', {});
  assert.equal((await H.api(viewer.token, 'GET', '/api/v1/harness/today')).status, 403);
});

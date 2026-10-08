'use strict';

/**
 * Finished missions put away by themselves (agents/tidy.js; the owner, 2026-10-08): seen a while ago or finished a day
 * ago goes to the Archive, quietly; one its leader has not read, one with something open for a person, or one kept
 * with 📌 stays; 0 turns a rule off; the sweep writes one activity line; "Put away finished" does it at once.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const store    = () => require('../modules/store');
const memory   = () => require('../modules/harness/memory');
const missions = () => require('../modules/agents/missions');
const tidy     = () => require('../modules/agents/tidy');

const ago = ms => new Date(Date.now() - ms).toISOString();
const MIN = 60000, HOUR = 3600000;

/** A finished mission as missions.js keeps it; by default read by its leader (the Orchestrator). */
function mission(id, fields = {}) {
  const s = memory().createSession(`Tidy ${id}`, { activate: false, kind: 'specialist' });
  const doc = store().readJson('agents/missions', { missions: [] });
  doc.missions.push({ id, agentId: 'tester', label: 'Tester', task: 't', state: 'done', sessionId: s.id, by: memory().mainSession().id,
    startedAt: ago(30 * HOUR), endedAt: ago(2 * HOUR), steps: 1, tokens: 0, announcedToAgentAt: ago(HOUR), ...fields });
  store().writeJson('agents/missions', doc);
  return s.id;
}

const archived = id => !!missions().get(id)?.archivedAt;
const bus = d => require('../modules/api-v1/bus').drain(d.device.id, 0);
const setPrefs = values => H.api(null, 'POST', '/api/prefs', { missions: values });

test('seen and old enough, or past the day seen or not: put away quietly, with one activity line', async () => {
  await setPrefs({ archiveSeenAfterMin: 30, archiveAfterHours: 24 });
  const watch = H.mkDevice('Tidy wrist', 'watch', H.WATCH_CAPS);
  mission('m_tidy_seen', { seenAt: ago(45 * MIN) });
  mission('m_tidy_fresh', { seenAt: ago(5 * MIN) });
  mission('m_tidy_old', { endedAt: ago(30 * HOUR) });
  mission('m_tidy_recent');   // unseen, finished two hours ago

  const gone = tidy().sweep();
  assert.ok(gone.includes('m_tidy_seen') && archived('m_tidy_seen'), 'seen 45 min ago: put away');
  assert.ok(gone.includes('m_tidy_old') && archived('m_tidy_old'), 'unseen but finished 30 h ago: put away');
  assert.ok(!archived('m_tidy_fresh'), 'seen 5 min ago: still here');
  assert.ok(!archived('m_tidy_recent'), 'unseen, two hours old: still here');

  const line = require('../modules/activity').list({ limit: 20 }).find(r => r.from === 'missions');
  assert.match(line.what, /^put away \d+ finished missions?$/);
  assert.match(line.why, /missions\.archiveAfterHours/);

  const p = [...(bus(watch).events || [])].reverse().find(e => e.type === 'agent.mission' && e.payload.missionId === 'm_tidy_seen')?.payload;
  assert.ok(p?.archivedAt && p.quiet, 'devices hear it put away, quietly');
});

test('unread by its leader, or with something open for a person: kept', async () => {
  const old = { endedAt: ago(48 * HOUR), seenAt: ago(40 * HOUR) };
  mission('m_tidy_unread', { ...old, announcedToAgentAt: undefined });
  const planned = mission('m_tidy_plan', old);
  memory().updateSession(planned, { plan: { state: 'proposed', title: 'x' } });
  mission('m_tidy_ask', { ...old, asking: { id: 'q', what: 'click', machine: 'pc' } });
  tidy().sweep();
  for (const id of ['m_tidy_unread', 'm_tidy_plan', 'm_tidy_ask']) assert.ok(!archived(id), `${id} is kept`);
  assert.match(tidy().keptBecause(missions().get('m_tidy_unread')), /leader has not read/);

  // A leader that is gone (a work chat whose job is over) is not waited for.
  const lead = memory().createSession('A finished work chat', { activate: false, kind: 'work' });
  memory().updateSession(lead.id, { job: { state: 'done' } });
  mission('m_tidy_leadgone', { ...old, announcedToAgentAt: undefined, by: lead.id });
  tidy().sweep();
  assert.ok(archived('m_tidy_leadgone'));
});

test('kept with 📌, or brought back from the Archive: the tidy-up leaves it', async () => {
  mission('m_tidy_pin', { endedAt: ago(48 * HOUR) });
  let r = await H.api(null, 'POST', '/api/harness/missions/m_tidy_pin/pin', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  tidy().sweep();
  assert.ok(!archived('m_tidy_pin'), 'pinned: kept');
  r = await H.api(null, 'POST', '/api/harness/missions/m_tidy_pin/pin', { on: false });
  tidy().sweep();
  assert.ok(archived('m_tidy_pin'), 'let go: put away');

  await H.api(null, 'POST', '/api/archive/mission/m_tidy_pin', { on: false });
  assert.ok(!archived('m_tidy_pin'));
  tidy().sweep();
  assert.ok(!archived('m_tidy_pin'), 'a person brought it back: not put away again');
});

test('0 means never', async () => {
  await setPrefs({ archiveSeenAfterMin: 0, archiveAfterHours: 0 });
  mission('m_tidy_never', { seenAt: ago(90 * HOUR), endedAt: ago(100 * HOUR) });
  assert.deepEqual(tidy().sweep(), []);
  assert.ok(!archived('m_tidy_never'));
  await setPrefs({ archiveSeenAfterMin: 30, archiveAfterHours: 24 });
});

test('"Put away finished" does it at once, keeps what is kept, and the bar counts what went', async () => {
  mission('m_tidy_now', { endedAt: ago(MIN) });
  mission('m_tidy_now_unread', { endedAt: ago(MIN), announcedToAgentAt: undefined });
  const r = await H.api(null, 'POST', '/api/harness/missions/tidy', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.putAway.includes('m_tidy_now') && archived('m_tidy_now'));
  assert.ok(r.body.kept.some(k => k.id === 'm_tidy_now_unread' && /leader/.test(k.why)));
  const g = await H.api(null, 'GET', '/api/harness/missions/tidy');
  assert.ok(g.body.putAway >= 1);
  assert.deepEqual(g.body.settings, { archiveSeenAfterMin: 30, archiveAfterHours: 24 });

  const member = await H.signIn('member', 'tidy-member@test.local');
  const p = await H.api(null, 'POST', '/api/harness/missions/m_tidy_now_unread/pin', { on: true }, { Cookie: member.cookie, 'X-Doca-Password': '' });
  assert.equal(p.status, 404, 'another person\'s mission is not there for them');
});

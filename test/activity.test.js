'use strict';

/**
 * Nothing runs unseen (CONSTITUTION §1; TODO P1.8; activity.js, docs/audits/2026-10-07-nothing-unseen.md): what the
 * hub does on its own is a line — kept on disk to `logs.activityDays`, on the live feed, in Chronicle as source `hub`
 * (a host every line, a person the lines done for them) — and every routine the audit lists writes one.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const activity = () => require('../modules/activity');

test('a line is kept with what, why and for whom; listed newest first; pruned by days', async () => {
  const member = await H.signIn('member', 'activity-member@test.local');
  activity().note({ from: 'computers', what: 'stopped pc-1', why: 'idle 30 min' });
  activity().note({ from: 'schedules', what: 'ran "Morning brief" (turn)', why: 'its time came', person: { ...member.user } });
  const rows = activity().list({ limit: 10 });
  assert.equal(rows[0].from, 'schedules');
  assert.equal(rows[0].person.id, member.user.id);
  assert.equal(rows[1].why, 'idle 30 min');

  const old = path.join(activity().dir(), '2001-01-01.jsonl');
  fs.writeFileSync(old, JSON.stringify({ at: '2001-01-01T00:00:00Z', from: 'x', what: 'old' }) + '\n');
  assert.equal(activity().prune(30), 1);
  assert.ok(!fs.existsSync(old));
  assert.ok(activity().list().length >= 2, 'today stays');
});

test('Chronicle shows them as "What the hub did": a host every line, a member only theirs', async () => {
  const member = await H.signIn('member', 'activity-viewer@test.local');
  activity().note({ from: 'schedules', what: 'ran "Their reminder" (reminder)', why: 'its time came', person: { ...member.user } });
  const host = await H.api(null, 'GET', '/api/chronicle?source=hub');
  assert.equal(host.status, 200);
  assert.ok(host.body.rows.some(r => /computers — stopped pc-1/.test(r.text)));
  assert.ok(host.body.facets.sources.includes('hub'));
  const mine = await H.api(null, 'GET', '/api/chronicle?source=hub', undefined, { Cookie: member.cookie, 'X-Doca-Password': '' });
  assert.ok(mine.body.rows.every(r => /Their reminder/.test(r.text)), JSON.stringify(mine.body.rows));
  assert.ok(mine.body.rows.length >= 1);
});

test('its retention is a log setting, shown with what it holds, and asks for the password to change', async () => {
  const keep = await H.api(null, 'GET', '/api/logs/keep');
  const row = keep.body.stores.find(s => s.id === 'activity');
  assert.ok(row && row.settings[0].path === 'logs.activityDays' && row.settings[0].value === 30);
  const r = await H.api(null, 'POST', '/api/logs/keep', { values: { 'logs.activityDays': 7 } }, { 'X-Doca-Password': '' });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'password_required');
});

test('every routine the audit lists writes its line where it acts', () => {
  const routines = ['computers/lifecycle.js', 'mcp/registry.js', 'schedules/index.js', 'scout/index.js', 'backup/schedule.js',
    'log-keep.js', 'agents/tidy.js', 'agents/carry-on.js', 'agents/after.js', 'harness/supervisor.js', 'boot.js', 'screens/archive.js'];
  for (const f of routines) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'modules', f), 'utf8');
    assert.match(src, /activity'\)\.note\(\{ from: '/, `${f} acts on its own and should say so (activity.note)`);
  }
});

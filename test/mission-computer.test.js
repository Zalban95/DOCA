'use strict';

/**
 * "Send to a specialist" (POST /api/harness/missions) lends the computer the person chose (self-test 2026-10-08, #8),
 * with agent_dispatch's checks — it exists, it is the person's to lend (computers/whose.js) — and not one in the Archive.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let store, before0;
const row = (id, extra = {}) => ({ id, name: id, purpose: 'p', token: 't', vncPassword: 'pw', mcpPort: 1, vncPort: 2, createdAt: new Date().toISOString(), ...extra });

before(async () => {
  await H.start();
  store = require('../modules/store');
  before0 = store.readJson('computers', { computers: [] }).computers;
  store.writeJson('computers', { computers: [...before0, row('c0ffee11'), row('c0ffee12', { archivedAt: new Date().toISOString() })] });
  require('../modules/agents/registry').setEnabled(true);
});
after(async () => {
  require('../modules/agents/registry').setEnabled(false);
  store.writeJson('computers', { computers: before0 });
  await H.stop();
});

const send = body => H.api(null, 'POST', '/api/harness/missions', { agentId: 'tester', task: 'try the installer', ...body });

test('a chosen computer is lent to the mission', async () => {
  const r = await send({ computer: 'c0ffee11' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body.mission;
  assert.equal(require('../modules/harness/memory').getSession(m.sessionId).profile.computer, 'c0ffee11', 'its tools are the mission\'s');
  assert.equal(require('../modules/computers').get('c0ffee11').missionId, m.id);
});

test('an unknown computer is a 404, one in the Archive a 409, and neither starts a mission', async () => {
  const count = () => require('../modules/agents/missions').list({ limit: 500 }).length;
  const n = count();
  const unknown = await send({ computer: 'deadbeef' });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /No computer deadbeef/);
  const archived = await send({ computer: 'c0ffee12' });
  assert.equal(archived.status, 409);
  assert.match(archived.body.error, /in the Archive/);
  assert.ok(require('../modules/computers').get('c0ffee12').archivedAt, 'left where it was');
  assert.equal(count(), n);
});

test('lending is the same rule as agent_dispatch: a computer is not every person\'s', async () => {
  const whose = require('../modules/computers/whose');
  const member = { id: 'usr_member_x', role: 'member', name: 'Mo' };
  assert.match(whose.refuse(member, 'c0ffee11') || '', /is not Mo's/, 'the check the route runs');
});

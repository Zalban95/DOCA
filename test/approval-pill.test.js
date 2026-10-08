'use strict';

// The chat's Auto/Manual pill reads the approval mode (GET /api/harness/approval). Anyone who may chat reads the mode;
// the allowlist and the waiting questions — other people's included — stay a host's. A phone's session, capped at what
// its device may do, used to be asked for the password just for opening the chat (found on an emulator, 2026-10-05).
// Beside the mode, everyone reads `asks`: the missions' machine questions waiting for them alone (mission-asks.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

test('a host reads all of it; a member and a phone read the mode alone, and change nothing', async () => {
  const owner = await H.api(null, 'GET', '/api/harness/approval');
  assert.equal(owner.status, 200);
  assert.ok('pending' in owner.body && 'always' in owner.body);

  const member = await H.signIn('member');
  const m = await H.api(null, 'GET', '/api/harness/approval', undefined, { Cookie: member.cookie });
  assert.equal(m.status, 200);
  assert.deepEqual(m.body, { mode: m.body.mode, asks: [] });
  assert.equal((await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' }, { Cookie: member.cookie })).status, 403);

  // The owner's own phone: a session capped at look-and-chat, as a device token opens one.
  const credentials = require('../modules/auth/credentials');
  const token = credentials.startSession({ user: H.owner.user, orgId: H.owner.orgId, cap: ['read', 'chat'] });
  const phone = { Cookie: `${credentials.COOKIE}=${token}` };
  const p = await H.api(null, 'GET', '/api/harness/approval', undefined, phone);
  assert.equal(p.status, 200, 'no password asked for opening the chat');
  assert.deepEqual(Object.keys(p.body), ['mode', 'asks']);
  const change = await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' }, phone);
  assert.equal(change.status, 401);
  assert.equal(change.body.code, 'step_up_required', 'changing it still asks');
});

test('the plural is the same read: a host gets all of it, a member the mode alone', async () => {
  const owner = await H.api(null, 'GET', '/api/harness/approvals');
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body, (await H.api(null, 'GET', '/api/harness/approval')).body);
  const member = await H.signIn('member');
  const m = await H.api(null, 'GET', '/api/harness/approvals', undefined, { Cookie: member.cookie });
  assert.deepEqual(Object.keys(m.body), ['mode', 'asks']);
});

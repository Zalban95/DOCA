'use strict';

/**
 * One password for a while (auth/unlock.js; the owner's yes of 2026-10-13): a correct password with `X-Doca-Unlock`
 * opens this session — `chain` for one click's switches, 1/5/15/30 minutes when chosen — in memory only; without the
 * header nothing opens (as before), another session is never opened, and Lock now closes it.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const unlock = () => require('../modules/auth/unlock');
const without = { 'X-Doca-Password': '' };
const flip = (mode, headers) => H.api(null, 'POST', '/api/harness/approval', { mode }, headers);

test('a password without the header opens nothing: the next switch asks again', async () => {
  unlock()._open.clear();
  assert.equal((await flip('auto')).status, 200);
  assert.equal((await flip('auto', without)).status, 401);
});

test('chain: one password, the switches of that click pass for half a minute', async () => {
  unlock()._open.clear();
  const r = await flip('auto', { 'X-Doca-Unlock': 'chain' });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('x-doca-unlocked-until'));
  assert.equal((await flip('auto', without)).status, 200, 'the next switch of the chain does not ask');
  const t = Date.parse((await H.api(null, 'GET', '/api/auth/unlock')).body.until);
  assert.ok(t - Date.now() <= unlock().CHAIN_SEC * 1000 && t > Date.now());
});

test('a chosen window: until the time it says; Lock now closes it; another person is not opened', async () => {
  unlock()._open.clear();
  assert.equal((await flip('auto', { 'X-Doca-Unlock': '15' })).status, 200);
  const d = (await H.api(null, 'GET', '/api/auth/unlock')).body;
  assert.ok(Math.abs(Date.parse(d.until) - Date.now() - 15 * 60e3) < 5000);
  assert.deepEqual(d.choices, [1, 5, 15, 30]);
  const other = await H.signIn('member');
  const r = await H.api(null, 'GET', '/api/auth/unlock', undefined, { Cookie: other.cookie, ...without });
  assert.equal(r.body.until, null, 'the window is this session\'s alone');
  assert.equal((await flip('auto', without)).status, 200);
  assert.equal((await H.api(null, 'DELETE', '/api/auth/unlock', undefined, without)).body.until, null);
  assert.equal((await flip('auto', without)).status, 401, 'locked again');
});

test('an unknown length opens nothing, and a wrong password never opens', async () => {
  unlock()._open.clear();
  assert.equal((await flip('auto', { 'X-Doca-Unlock': '600' })).status, 200);
  assert.equal((await flip('auto', without)).status, 401);
  assert.equal((await flip('auto', { 'X-Doca-Password': 'not-it', 'X-Doca-Unlock': '30' })).status, 403);
  require('../modules/auth/routes')._failures.clear();
  assert.equal((await flip('auto', without)).status, 401);
});

test('the window ends by itself', () => {
  const u = unlock();
  u._open.clear();
  const now = Date.now();
  u.grant('h', '1', now);
  assert.ok(u.until('h', now + 59e3));
  assert.equal(u.until('h', now + 61e3), null);
  u.grant('h', '5', now); u.grant('h', 'chain', now);
  assert.ok(u.until('h', now + 4 * 60e3), 'a chain never shortens a chosen window');
});

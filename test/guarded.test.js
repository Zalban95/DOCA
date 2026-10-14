'use strict';

/**
 * Important and safety switches (CONSTITUTION S14; auth/guarded.js; the owner's decision of 2026-10-14): a few ask for
 * the password — a wrong one refused under the sign-in rate limit — the rest show a notice the person continues past,
 * or hides for good (per person, server-side, reset in Settings → General); an ordinary setting asks nothing, every
 * pass is audited, and the agent never applies a guarded setting by itself — not when asked, not in Unattended.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const prefs = () => require('../modules/utils').loadPrefs();
const without = { 'X-Doca-Password': '', 'X-Doca-Notice': '' };
const settle = () => new Promise(r => setTimeout(r, 150));   // the audit is written after the answer

test('a password switch without the password: 401 naming it; a wrong one: 403; the right one: done', async () => {
  let r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'unattended', confirm: true }, without);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'password_required');
  assert.match(r.body.error, /Unattended/);
  r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'unattended', confirm: true }, { 'X-Doca-Password': 'not-it' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'bad_credentials');
  require('../modules/auth/routes')._failures.clear();
  r = await H.api(null, 'POST', '/api/auth/levels', { name: 'x' }, { 'X-Doca-Password': '' });
  assert.equal(r.status, 401, 'who may do what asks for the password, a notice answered or not');
  r = await H.api(null, 'POST', '/api/restart', { cancel: true }, without);
  assert.notEqual(r.status, 401, 'calling a waiting restart off asks nothing');
});

test('a notice switch: 428 with what it does; Continue passes without a password; audited', async () => {
  let r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' }, without);
  assert.equal(r.status, 428);
  assert.equal(r.body.code, 'notice_required');
  assert.equal(r.body.key, 'approval');
  assert.match(r.body.notice, /Auto/);
  r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' }, { 'X-Doca-Password': '', 'X-Doca-Notice': 'continue' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const tail = await require('../modules/auth/store').auditTail(20);
  const line = tail.reverse().find(e => e.action === 'POST /api/harness/approval');
  assert.equal(line.switch, 'the approval mode');
  assert.equal(line.notice, 'continued');
  r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' }, { 'X-Doca-Password': '' });
  assert.equal(r.status, 200);
});

test('"Don\'t show this again" is remembered per person per switch, and Settings resets it', async () => {
  let r = await H.api(null, 'POST', '/api/harness/agents/enable', { enabled: false }, { 'X-Doca-Password': '', 'X-Doca-Notice': 'hide' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await H.api(null, 'POST', '/api/harness/agents/enable', { enabled: false }, without);
  assert.equal(r.status, 200, 'not shown again');
  await settle();
  const line = (await require('../modules/auth/store').auditTail(5)).reverse().find(e => e.action === 'POST /api/harness/agents/enable');
  assert.match(line.notice, /not shown/);
  r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' }, without);
  assert.equal(r.status, 428, 'another switch still shows its own');
  const member = await H.signIn('member');
  assert.ok(!require('../modules/auth/notices').hidden(member.user.id, 'specialists'), 'another person still sees it');
  r = await H.api(null, 'GET', '/api/auth/notices');
  assert.deepEqual(r.body.hidden.map(h => h.key), ['specialists']);
  r = await H.api(null, 'DELETE', '/api/auth/notices', undefined, without);
  assert.equal(r.status, 200);
  assert.equal(r.body.reset, 1);
  r = await H.api(null, 'POST', '/api/harness/agents/enable', { enabled: false }, without);
  assert.equal(r.status, 428, 'shown again after the reset');
});

test('a hidden notice never passes a password switch', async () => {
  require('../modules/auth/notices').hide(H.owner.user.id, 'unattended');
  const r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'unattended', confirm: true }, without);
  assert.equal(r.status, 401);
});

test('POST /api/prefs asks only when a guarded setting would change', async () => {
  let r = await H.api(null, 'POST', '/api/prefs', { theme: 'light' }, without);
  assert.equal(r.status, 200, 'an ordinary setting asks nothing');
  r = await H.api(null, 'POST', '/api/prefs', { experiments: { ...(prefs().experiments || {}), retrieval: true } }, without);
  assert.equal(r.status, 428);
  assert.match(r.body.error, /experiment/);
  r = await H.api(null, 'POST', '/api/prefs', { experiments: prefs().experiments || {} }, without);
  assert.equal(r.status, 200, 'sending a guarded setting back unchanged asks nothing');
  r = await H.api(null, 'POST', '/api/prefs', { harness: { approval: { mode: 'unattended' } } }, without);
  assert.equal(r.status, 401, 'Unattended by the settings file asks for the password too');
});

test('the cast door cannot be opened around its own route: a settings write asks too (found 2026-10-13)', async () => {
  const r = await H.api(null, 'POST', '/api/prefs', { cast: { door: 'on' } }, without);
  assert.equal(r.status, 428);
  assert.match(r.body.error, /cast door/);
  assert.notEqual(prefs().cast?.door, 'on');
});

test('which switches ask what', async () => {
  const { switchOf } = require('../modules/auth/guarded');
  const req = (path, body = {}, method = 'POST') => ({ method, path, body });
  assert.equal(switchOf(req('/api/harness/sessions/abc/settings', { title: 'x' })), null);
  assert.equal(switchOf(req('/api/harness/sessions/abc/settings', { approval: 'auto' })).key, 'convApproval');
  assert.equal(switchOf(req('/api/harness/guards/test')), null, 'testing a guard flips nothing');
  assert.equal(switchOf(req('/api/harness/guards/rules', { enabled: true })).password, false, 'switching a guard on tightens');
  assert.equal(switchOf(req('/api/harness/guards/rules', { enabled: false })).password, true, 'switching one off loosens');
  assert.equal(switchOf(req('/api/harness/guards/rules', { blockAt: 1 })).password, true);
  assert.equal(switchOf(req('/api/harness/guards/x', {}, 'DELETE')).password, true);
  for (const [path, method] of [['/api/auth/grants/g1', 'DELETE'], ['/api/backups/b1/restore'], ['/api/versions/use'], ['/api/restart'],
    ['/api/connectors/sealed/all'], ['/api/licence/key'], ['/api/auth/users'], ['/api/backups/remote'], ['/api/packs/import'], ['/api/network']])
    assert.equal(switchOf(req(path, {}, method || 'POST'))?.password, true, path);
  for (const path of ['/api/harness/agents/enable', '/api/experiments/x', '/api/sharing', '/api/logs/keep', '/api/spending/budget'])
    assert.equal(switchOf(req(path))?.password, false, path);
});

test('every switch says why: a password one in a line, a notice one in what the person reads', () => {
  const { SWITCHES } = require('../modules/auth/guarded');
  for (const [k, s] of Object.entries(SWITCHES)) {
    assert.ok(s.what, k);
    assert.ok(!!s.password !== !!s.notice, `${k}: exactly one of password or notice`);
    assert.ok((s.password || s.notice).length > 20, k);
  }
});

test('the agent never applies a guarded setting alone: asked, or in Unattended, it stays a proposal', async () => {
  const tools = require('../modules/harness/tools');
  const owner = { ...H.owner.user, role: 'owner' };
  const before = prefs().agents?.enabled;
  const out = await tools.call('settings_propose', { reason: 'they asked', changes: [{ path: 'agents.enabled', value: !before }], asked: true },
    [], { byPerson: true, user: owner });
  assert.match(out, /^Proposed .*only on their Accept/s);
  assert.equal(prefs().agents?.enabled, before);
  const id = out.match(/Proposed \((\w+)\)/)[1];
  let r = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {}, without);
  assert.equal(r.status, 428, 'its Accept shows the notice');
  r = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(prefs().agents?.enabled, !before);
});

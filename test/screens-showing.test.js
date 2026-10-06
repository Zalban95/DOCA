'use strict';

/** What each screen shows, and sending it a page (modules/screens/showing.js, public/js/solo.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('a screen says which page it shows; an admin sends a page to it, and only that screen hears it', async () => {
  const me = (await H.api(null, 'GET', '/api/screen')).body;   // this session's browser record
  const screen = me.deviceId || me.id || me.device?.id;
  assert.ok(screen, JSON.stringify(me).slice(0, 200));
  await H.api(null, 'POST', '/api/presence', { visible: true, page: 'harness', solo: true });
  let r = await H.api(null, 'GET', '/api/screens/showing');
  assert.equal(r.body.screens[screen].page, 'harness');
  assert.equal(r.body.screens[screen].solo, true);

  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: H.owner.cookie }, signal: ctrl.signal });
  const reader = res.body.getReader();
  let buf = '';
  const next = async pred => { for (let i = 0; i < 50; i++) { const { value } = await reader.read(); buf += new TextDecoder().decode(value); if (pred(buf)) return true; } return false; };
  await next(b => b.includes('"hello"'));
  r = await H.api(null, 'POST', `/api/screens/${screen}/show`, { page: 'computers', solo: true });
  assert.equal(r.body.sent, true);
  assert.ok(await next(b => b.includes('"topic":"screen"') && b.includes('"page":"computers"')), 'the screen hears it');
  ctrl.abort();

  assert.equal((await H.api(null, 'POST', `/api/screens/${screen}/show`, { page: '../etc' })).status, 400);
  assert.equal((await H.api(null, 'POST', '/api/screens/dev_nope/show', { page: 'harness' })).status, 404);
  const member = await H.signIn('member', 'show-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/screens/showing', undefined, { Cookie: member.cookie })).status, 403);
});

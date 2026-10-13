'use strict';

// A cast screen whose receiver keeps no cookie (R3i): the view link hands the session in the fragment; through the
// door the page and its code load without one; its data needs the view session in X-Cast-View (or vs= on a stream),
// which is taken for a view session alone — never a person's sign-in.
process.env.DOCA_CAST_DOOR_ADDRESS = '127.0.0.1';
process.env.DOCA_CAST_DOOR_PORT = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let origin, vs;
test.before(async () => {
  await H.start();
  const u = require('../modules/utils'); u.savePrefs({ ...u.loadPrefs(), cast: { door: 'on' } });
  origin = await require('../modules/cast/door').open('127.0.0.1', { page: 'live' });
});
test.after(async () => { await require('../modules/cast/door').close(); await H.stop(); });

test('the view link gives the session in the fragment, and the cookie as before', async () => {
  const l = (await H.api(null, 'POST', '/api/cast/links', { page: 'live' })).body;
  const r = await fetch(`${origin}${l.path}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /^\/\?view=live&cast=1#vs=[A-Za-z0-9_-]{20,}$/);
  assert.match(r.headers.get('set-cookie'), /doca_session=/);
  vs = /#vs=([^&]+)/.exec(loc)[1];
});

test('through the door, the page and its code need no session; its data needs the view session', async () => {
  assert.equal((await fetch(`${origin}/?view=live&cast=1`, { redirect: 'manual' })).status, 200, 'the page');
  assert.equal((await fetch(`${origin}/js/lib/view-token.js`)).status, 200, 'its code');
  assert.equal((await fetch(`${origin}/api/auth/me`)).status, 401, 'no data without the session');
  const me = await fetch(`${origin}/api/auth/me`, { headers: { 'X-Cast-View': vs } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).view, 'live');
  assert.equal((await fetch(`${origin}/api/prefs`, { headers: { 'X-Cast-View': vs } })).status, 404, 'and only what its page reads');
});

test('off the door nothing loads without a session, and a person\'s sign-in is never taken from the header', async () => {
  assert.equal((await fetch(`${H.base}/?view=live`, { redirect: 'manual' })).status, 302, 'the panel itself still asks to sign in');
  assert.equal((await fetch(`${H.base}/js/lib/api.js`, { redirect: 'manual' })).status, 302);
  const owner = H.owner.cookie.split('=')[1];
  assert.equal((await fetch(`${H.base}/api/auth/me`, { headers: { 'X-Cast-View': owner } })).status, 401, 'an owner\'s token in the header is refused');
  assert.equal((await fetch(`${H.base}/api/auth/me?vs=${owner}`)).status, 401);
  assert.equal((await fetch(`${H.base}/api/auth/me`, { headers: { 'X-Cast-View': vs } })).status, 200, 'a view session is, off the door too (a relay)');
});

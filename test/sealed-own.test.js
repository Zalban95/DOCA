'use strict';

// A person's own secrets for their own devices (TODO P1.3; CONSTITUTION S4, S13, S14; modules/sealed): anyone who chats
// keeps theirs in the same encrypted vault, with whose they are; an admin's stay the hub's; nobody sees or uses another's;
// keeping or forgetting one asks for the password.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const VALUE = 'my-own-pin-4471-only-mine';
let ann, bob;
const as = (who, method, p, body, typed = true) => H.api(null, method, p, body, { Cookie: who.cookie, ...(typed ? { 'X-Doca-Password': who.password } : { 'X-Doca-Password': '' }) });
const userOf = (who, extra = {}) => ({ ...who.user, role: who.role, name: who.user.name, ...extra });

before(async () => {
  await H.start();
  ann = await H.signIn('member', 'ann-sealed@test.local');
  bob = await H.signIn('member', 'bob-sealed@test.local');
});
after(() => H.stop());

test('a member keeps their own secret — with their password — and sees only their own', async () => {
  const untyped = await as(ann, 'POST', '/api/connectors/sealed/mine', { name: 'door-pin', value: VALUE }, false);
  assert.equal(untyped.status, 401, 'keeping one asks for the password');
  assert.equal(untyped.body.code, 'password_required');
  const r = await as(ann, 'POST', '/api/connectors/sealed/mine', { name: 'door-pin', value: VALUE, note: 'the front door' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes(VALUE));
  // The hub's, kept by an admin, under the same name: a different secret.
  assert.equal((await H.api(null, 'POST', '/api/connectors/sealed/all', { name: 'door-pin', value: 'the-hubs-own-value' })).status, 200);
  const mine = await as(ann, 'GET', '/api/connectors/sealed/mine');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.secrets.map(s => s.name), ['door-pin']);
  assert.ok(!JSON.stringify(mine.body).includes(VALUE));
  const bobs = await as(bob, 'GET', '/api/connectors/sealed/mine');
  assert.deepEqual(bobs.body.secrets, [], 'another member sees none of Ann\'s');
  assert.equal((await as(ann, 'GET', '/api/connectors/sealed/all')).status, 403, 'the hub\'s are an admin\'s');
  assert.equal((await as(ann, 'POST', '/api/connectors/sealed/all', { name: 'x', value: 'y' })).status, 403);
  // A DELETE of ".../sealed/mine" is the hub's route for a secret named "mine": host, never a member's.
  assert.equal((await as(ann, 'DELETE', '/api/connectors/sealed/mine')).status, 403);
  assert.equal((await as(ann, 'DELETE', '/api/connectors/sealed/door-pin')).status, 403);
});

test('an admin sees whose each is, never a value, and may forget a person\'s', async () => {
  const all = await H.api(null, 'GET', '/api/connectors/sealed/all');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.secrets.map(s => s.name), ['door-pin'], 'the hub\'s own');
  assert.deepEqual(all.body.people.map(s => [s.name, s.person]), [['door-pin', ann.user.id]]);
  assert.ok(!JSON.stringify(all.body).includes(VALUE) && !JSON.stringify(all.body).includes('the-hubs-own-value'));
  assert.equal((await H.api(null, 'POST', '/api/connectors/sealed/mine', { name: 'kept', value: 'z' })).status, 200);
  assert.equal((await H.api(null, 'DELETE', `/api/connectors/sealed/kept?person=${encodeURIComponent(H.owner.user.id)}`)).status, 200);
});

test('used only by its person, on their own turn: never by another member, work on their behalf, or an admin', async () => {
  const use = require('../modules/sealed/use'), vault = require('../modules/sealed/vault');
  const v = await use.sourceOf('door-pin', { host: false, person: userOf(ann) });
  assert.equal(v.value, VALUE, 'Ann\'s own, on Ann\'s turn');
  await assert.rejects(use.sourceOf('door-pin', { host: false, person: userOf(bob) }), e => e.status === 404 && /Your secrets for your devices: none yet/.test(e.message));
  await assert.rejects(use.sourceOf('door-pin', { host: false, person: userOf(ann, { onBehalf: true }) }), e => e.status === 403, 'not a mission or work chat for her');
  assert.equal((await use.sourceOf('door-pin', { host: true, person: userOf({ user: H.owner.user, role: 'owner' }) })).value, 'the-hubs-own-value', 'an admin\'s turn reaches the hub\'s');
  // A row cannot be read as another owner's: each is bound to whose it is.
  assert.equal(await vault.reveal('door-pin', bob.user.id), null);
  const db = require('../modules/db');
  const row = await db.get("SELECT iv, data FROM sealed_secrets WHERE person_id = ? AND name = 'door-pin'", [ann.user.id]);
  await vault.save({ name: 'moved', value: 'placeholder' }, bob.user.id, bob.user.id);
  await db.run("UPDATE sealed_secrets SET iv = ?, data = ? WHERE person_id = ? AND name = 'moved'", [row.iv, row.data, bob.user.id]);
  await assert.rejects(vault.reveal('moved', bob.user.id), 'Ann\'s ciphertext moved under Bob does not open');
  await vault.remove('moved', bob.user.id);
});

test('the agent is told only its person\'s own names, and a member\'s device rule is unchanged', async () => {
  const fits = require('../modules/harness/turn/fits');
  const held = new Set(['secret_use']);
  const forAnn = fits.inventory(held, userOf(ann));
  assert.match(forAnn, /own secrets for secret_use[^\n]*door-pin/);
  assert.doesNotMatch(forAnn, /login:<name>/, 'logins and keys are the hub\'s');
  assert.match(fits.inventory(held, userOf(bob)), /none of its own yet/);
  assert.match(fits.inventory(held, userOf({ user: H.owner.user, role: 'owner' })), /Secrets for secret_use[^\n]*door-pin[^\n]*login:<name>/);
  const use = require('../modules/sealed/use');
  await assert.rejects(use.use({ secret: 'door-pin', device: 'nowhere' }, { user: userOf(ann) }), /No paired device/);
});

test('forgetting one\'s own asks for the password, then only theirs goes', async () => {
  assert.equal((await as(ann, 'DELETE', '/api/connectors/sealed/mine/door-pin', undefined, false)).status, 401);
  assert.equal((await as(bob, 'DELETE', '/api/connectors/sealed/mine/door-pin')).status, 404, 'Bob has no door-pin of his own');
  assert.equal((await as(ann, 'DELETE', '/api/connectors/sealed/mine/door-pin')).status, 200);
  assert.deepEqual((await H.api(null, 'GET', '/api/connectors/sealed/all')).body.secrets.map(s => s.name), ['door-pin'], 'the hub\'s stays');
});

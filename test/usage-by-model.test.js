'use strict';

/**
 * A watch's ring of models (GET /api/v1/harness/usage?by=model, 2026-10-09): this device's person's own calls and tokens
 * per provider/model, given to whoever's conversation it is the way spending gives them — never another person's, and
 * the default reading (the hive's, per provider) unchanged.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const memory = () => require('../modules/harness/memory');

async function spend(who, tokens, provider, model, { onRow = false } = {}) {
  const s = memory().createSession('usage by model', { activate: false });
  memory().updateSession(s.id, { person: { id: who.user.id, orgId: who.orgId } });
  await require('../modules/harness/usage').summary({ days: 1 });   // the ledger's table, imported
  await require('../modules/db').run('INSERT INTO usage (at, kind, provider, model, session_id, prompt, completion, cached, source, person_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [new Date().toISOString(), 'turn', provider, model, s.id, tokens, 10, 0, 'provider', onRow ? who.user.id : null]);
}

test('by model: the watch\'s person\'s own tokens per provider/model; by provider: the hive\'s, as before', async () => {
  const a = await H.signIn('member', 'ubm-a@test.local');
  const b = await H.signIn('member', 'ubm-b@test.local');
  await spend(a, 600000, 'deepseek', 'chat');
  await spend(a, 300000, 'local', 'qwen', { onRow: true });
  await spend(a, 90, 'deepseek', 'chat');
  await spend(b, 5000, 'openai', 'gpt');
  const devices = require('../modules/api-v1/devices');
  const w = H.mkDevice('wrist', 'watch', H.WATCH_CAPS);
  devices.update(w.device.id, { userId: a.user.id });

  let r = await H.api(w.token, 'GET', '/api/v1/harness/usage?by=model');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.by, 'model');
  assert.equal(r.body.person, true);
  assert.deepEqual(r.body.rows.map(x => x.key), ['deepseek/chat', 'local/qwen'], 'largest first, nobody else\'s');
  assert.equal(r.body.rows[0].prompt, 600090);
  assert.equal(r.body.rows[0].calls, 2);
  assert.equal(r.body.total.prompt + r.body.total.completion, 900120);

  r = await H.api(w.token, 'GET', '/api/v1/harness/usage');
  assert.equal(r.body.by, 'provider');
  assert.ok(r.body.rows.some(x => x.key === 'openai'), 'the default reading is the hive\'s, as before');

  // A device with no person reads the hive's, per model.
  const old = H.mkDevice('old wrist', 'watch', H.WATCH_CAPS);
  r = await H.api(old.token, 'GET', '/api/v1/harness/usage?by=model');
  assert.equal(r.body.person, false);
  assert.ok(r.body.rows.some(x => x.key === 'openai/gpt'));

  // harness:chat is still what it takes.
  const viewer = H.mkDevice('viewer', 'viewer', {});
  r = await H.api(viewer.token, 'GET', '/api/v1/harness/usage?by=model');
  assert.equal(r.status, 403);
});

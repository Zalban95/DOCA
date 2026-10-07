'use strict';

/**
 * Offering what the agents learned to the project — only if the owner allows (modules/sharing.js; CONSTITUTION §0
 * step 4; TODO P0.3): undecided until asked, off by default, never proposable; only the agents' packs are offered;
 * nothing goes without the owner's click, to the project hub the owner chose.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('undecided until asked; never proposable; the CLI the installers call records the answer', () => {
  const sharing = require('../modules/sharing');
  assert.deepEqual(sharing.state(), { decided: false, contribute: false, upstream: '' });
  assert.ok(require('../modules/harness/settings').refuse('sharing.contribute', true), 'no agent shares on its own behalf');
  const out = require('node:child_process').execFileSync(process.execPath, ['bin/doca-sharing.js', 'off'], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', env: process.env });
  assert.match(out, /off/);
  assert.deepEqual(sharing.state(), { decided: true, contribute: false, upstream: '' });
});

test('only the agents\' packs are offered, and only the owner\'s click sends one — to the hub the owner chose', async () => {
  const lib = require('../modules/packs/library');
  const r = require('../modules/recipes/store').save({ title: 'Restart a stuck service', steps: [{ tool: 'system_status', args: {} }] });
  const build = name => require('../modules/packs/export').build({ name, recipes: [r.id] }).buffer;
  const mine = lib.save(build('Made by a person'), { origin: 'made' });
  const kept = lib.save(build('Learned: restart a stuck service'), { origin: 'agent', from: 'the agent' });

  let v = (await H.api(null, 'GET', '/api/sharing')).body;
  assert.deepEqual(v.candidates.map(p => p.id), [kept.id], 'a person\'s own pack is theirs to send by hand');
  assert.equal((await H.api(null, 'POST', `/api/sharing/${kept.id}/share`, {})).status, 409, 'off: nothing is sent');

  assert.equal((await H.api(null, 'POST', '/api/sharing', { contribute: true })).status, 200);
  assert.match((await H.api(null, 'POST', `/api/sharing/${kept.id}/share`, {})).body.error, /No project hub is chosen/);
  assert.equal((await H.api(null, 'POST', '/api/sharing', { upstream: 'nope' })).status, 400, 'only a hub this hive sends to');

  // The project's hub: here, this test hub itself, added with a hub token (as packs between hubs already work).
  const token = (await H.api(null, 'POST', '/api/devices', { name: 'The project', preset: 'hub' })).body.token;
  const hub = (await H.api(null, 'POST', '/api/packs/hubs', { url: H.base, token, label: 'The project' })).body;
  assert.equal((await H.api(null, 'POST', '/api/sharing', { upstream: hub.id })).status, 200);
  assert.equal((await H.api(null, 'POST', `/api/sharing/${mine.id}/share`, {})).status, 404, 'not an agent pack');
  const sent = await H.api(null, 'POST', `/api/sharing/${kept.id}/share`, {});
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  v = (await H.api(null, 'GET', '/api/sharing')).body;
  assert.ok(v.candidates.find(p => p.id === kept.id).sentAt, 'marked as sent');
  assert.ok(lib.list().some(p => p.origin === 'received' && p.name === 'Learned: restart a stuck service'), 'it arrived at the project\'s hub');
});

test('a member cannot answer for the owner', async () => {
  const member = await H.signIn('member', 'share-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/sharing', { contribute: false }, { Cookie: member.cookie })).status, 403);
});

'use strict';

// The pack library and hub-to-hub sending (modules/packs/library.js, send.js, api-v1/packs-receive.js; TODO H4.5):
// what the agent or a person keeps, what another hub sends — nothing applied until a host brings it in.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

let hubToken;

test('the agent keeps what it made as a pack; a person keeps a selection; both are in the library', async () => {
  const recipes = require('../modules/recipes/store');
  const r = recipes.save({ title: 'Disk check', steps: [{ tool: 'shell', args: { command: 'df -h' } }] });
  const tool = require('../modules/harness/toolbox/packs').find(t => t.name === 'pack');
  assert.match(await tool.run({ name: 'Disk care', description: 'Checks the disks', recipes: [r.id] }), /^Kept "Disk care" in the library as pk_[a-f0-9]{12}: recipe /);
  const made = await H.api(null, 'POST', '/api/packs/library', { name: 'Same, by hand', recipes: [r.id] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const lib = (await H.api(null, 'GET', '/api/packs/library')).body.packs;
  assert.deepEqual(lib.map(p => p.origin).sort(), ['agent', 'made']);
  assert.match(await tool.run({ action: 'list' }), /Disk care/);
  assert.ok(require('../modules/agents/registry').NEVER.includes('pack'), 'a mission does not keep packs');
});

test('a library pack downloads, and is brought in through the same dry run', async () => {
  const pack = (await H.api(null, 'GET', '/api/packs/library')).body.packs.find(p => p.origin === 'agent');
  const res = await fetch(`${H.base}/api/packs/library/${pack.id}`, { headers: { Cookie: H.owner.cookie } });
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /Disk-care\.dpack/);
  const recipes = require('../modules/recipes/store');
  const id = pack.contents.find(c => c.kind === 'recipe').id;
  recipes.remove(id);
  const plan = await H.api(null, 'POST', `/api/packs/library/${pack.id}/plan`, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  const item = plan.body.items.find(i => i.kind === 'recipe');
  const done = await H.api(null, 'POST', `/api/packs/library/${pack.id}/import`, { only: [item.key] });
  assert.equal(done.body.done[0].ok, true, JSON.stringify(done.body));
});

test('another hub with a hub token sends a pack: it waits in the library, received from that hub', async () => {
  const issued = await H.api(null, 'POST', '/api/devices', { name: 'Office hub', preset: 'hub' });
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  hubToken = issued.body.token;
  const phone = H.mkDevice('A phone', 'phone', H.PHONE_CAPS);
  const v1 = (token, method = 'GET', body) => fetch(`${H.base}/api/v1/packs`, { method, headers: { Authorization: `Bearer ${token}` }, body });
  assert.equal((await v1(phone.token)).status, 403, 'a phone cannot send packs');
  const hello = await (await v1(hubToken)).json();
  assert.equal(hello.accepts, 'dpack');
  const before = (await H.api(null, 'GET', '/api/packs/library')).body.packs.length;
  const { buffer } = require('../modules/packs/library').get((await H.api(null, 'GET', '/api/packs/library')).body.packs[0].id);
  const form = new FormData(); form.append('file', new Blob([buffer]), 'p.dpack');
  const r = await v1(hubToken, 'POST', form);
  assert.equal(r.status, 201);
  const lib = (await H.api(null, 'GET', '/api/packs/library')).body.packs;
  assert.equal(lib.length, before + 1);
  assert.deepEqual([lib[0].origin, lib[0].from], ['received', 'Office hub']);
  const junk = new FormData(); junk.append('file', new Blob([Buffer.from('not a zip')]), 'x.dpack');
  assert.equal((await v1(hubToken, 'POST', junk)).status, 400);
});

test('this hub sends to another: added with its hub token (refused without one), then a library pack goes there', async () => {
  assert.equal((await H.api(null, 'POST', '/api/packs/hubs', { url: H.base, token: 'doca_dev_wrong' })).status, 400);
  const added = await H.api(null, 'POST', '/api/packs/hubs', { url: H.base, token: hubToken, label: 'Itself' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const lib = await H.api(null, 'GET', '/api/packs/library');
  assert.ok(!JSON.stringify(lib.body.hubs).includes(hubToken), 'the token never reads back');
  const sent = await H.api(null, 'POST', `/api/packs/library/${lib.body.packs.at(-1).id}/send`, { hub: added.body.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal((await H.api(null, 'GET', '/api/packs/library')).body.packs.length, lib.body.packs.length + 1, 'it arrived (here, since it sent to itself)');
  assert.ok(require('../modules/paths').PROTECTED_FILES.includes(require('../modules/paths').HUB_KEYS_FILE));
});

test('a registry (experiment): published packs only, to a registry token, fetched into the library — nothing while off', async () => {
  const issued = await H.api(null, 'POST', '/api/devices', { name: 'Team registry', preset: 'registry' });
  const token = issued.body.token;
  const get = p => fetch(`${H.base}/api/v1${p}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await get('/packs/published')).status, 404, 'off: there is no registry');
  require('../modules/experiments').setDeveloper(true); require('../modules/experiments').set('packRegistry', true);
  assert.deepEqual((await (await get('/packs/published')).json()).packs, [], 'nothing published yet');
  const lib = (await H.api(null, 'GET', '/api/packs/library')).body.packs;
  const pk = lib.find(p => p.origin === 'agent');
  assert.equal((await H.api(null, 'POST', `/api/packs/library/${pk.id}/publish`, { on: true })).body.published, true);
  const listed = (await (await get('/packs/published')).json()).packs;
  assert.deepEqual(listed.map(p => p.id), [pk.id]);
  const other = lib.find(p => p.id !== pk.id);
  assert.equal((await get(`/packs/published/${other.id}`)).status, 404, 'an unpublished pack is not served');
  assert.equal((await fetch(`${H.base}/api/v1/packs`, { headers: { Authorization: `Bearer ${token}` } })).status, 403, 'a registry token cannot send');
  const added = await H.api(null, 'POST', '/api/packs/hubs', { url: H.base, token, label: 'Team' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.deepEqual([added.body.send, added.body.read], [false, true]);
  const browsed = await H.api(null, 'GET', `/api/packs/hubs/${added.body.id}/published`);
  assert.equal(browsed.body.packs[0].id, pk.id);
  const fetched = await H.api(null, 'POST', `/api/packs/hubs/${added.body.id}/fetch`, { pack: pk.id });
  assert.deepEqual([fetched.body.origin, fetched.body.from, fetched.body.name], ['registry', 'Team', pk.name]);
});

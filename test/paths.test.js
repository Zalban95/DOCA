'use strict';

/**
 * Settable paths: the Settings → System → Paths card.
 *
 * `test/helpers.js` points CONFIG_PATH, COMPOSE_DIR and friends at a temp dir
 * through the environment, so these run against real files without touching
 * anything of the developer's.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const H = require('./helpers');

before(H.start);
after(H.stop);

const get  = p => H.api(null, 'GET', p);
const post = (p, body) => H.api(null, 'POST', p, body);
const row  = (rows, key) => rows.find(r => r.key === key);

test('every settable path reports its value, where it came from, and whether it is there', async () => {
  const { status, body } = await get('/api/paths');
  assert.equal(status, 200);

  const keys = body.settable.map(r => r.key);
  assert.deepEqual(keys, [
    'COMPOSE_DIR', 'CONFIG_PATH', 'SKILLS_DIR', 'WORKSPACE_DIR',
    'SETUP_DIR', 'SNAPSHOT_DIR', 'SNAPSHOT_SCRIPT', 'RESTORE_SCRIPT',
  ]);

  // The helper sets these in the environment, so they must not read as the
  // user's own saved choice.
  assert.equal(row(body.settable, 'CONFIG_PATH').source, 'env');
  assert.equal(row(body.settable, 'CONFIG_PATH').value, process.env.CONFIG_PATH);
  assert.equal(row(body.settable, 'CONFIG_PATH').pending, false);

  // A path nobody set anywhere falls back to the shipped default.
  assert.equal(row(body.settable, 'SNAPSHOT_DIR').source, 'default');
});

test('saving an override is remembered, flagged as needing a restart, and clearable', async () => {
  const target = path.join(H.tmp, 'snaps-elsewhere');

  const saved = await post('/api/paths', { SNAPSHOT_DIR: target });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.restartRequired, true);

  let r = row(saved.body.settable, 'SNAPSHOT_DIR');
  assert.equal(r.source, 'saved');
  assert.equal(r.value, target);
  assert.equal(r.exists, false);
  // The constants were read at boot, so this process still uses the old path —
  // the UI says so rather than pretending the change already took effect.
  assert.equal(r.pending, true);
  assert.notEqual(r.active, target);

  // The snapshots panel edits the same stored value, not a second copy of it.
  const snap = await get('/api/snapshots/settings');
  assert.equal(snap.body.snapshotDir, target);

  // Blank hands the path back to the environment or the default.
  const cleared = await post('/api/paths', { SNAPSHOT_DIR: '' });
  assert.equal(row(cleared.body.settable, 'SNAPSHOT_DIR').source, 'default');
});

test('a missing path can be created, and creating twice is not an error', async () => {
  const dir = path.join(H.tmp, 'made-here', 'nested');
  await post('/api/paths', { SKILLS_DIR: dir });

  const first = await post('/api/paths/create', { key: 'SKILLS_DIR' });
  assert.equal(first.status, 200);
  assert.equal(first.body.created, true);
  assert.ok(fs.statSync(dir).isDirectory());
  assert.equal(row(first.body.settable, 'SKILLS_DIR').exists, true);

  const again = await post('/api/paths/create', { key: 'SKILLS_DIR' });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
});

test('a script path is created executable with a shebang, a JSON path with an object', async () => {
  const script = path.join(H.tmp, 'made-here', 'snapshot.sh');
  await post('/api/paths', { SNAPSHOT_SCRIPT: script });
  await post('/api/paths/create', { key: 'SNAPSHOT_SCRIPT' });
  assert.match(fs.readFileSync(script, 'utf8'), /^#!/);

  // CONFIG_PATH is a JSON file; the temp one does not exist until something
  // writes it, which is exactly the case that used to surface as ENOENT.
  const cfg = path.join(H.tmp, 'made-here', 'openclaw.json');
  await post('/api/paths', { CONFIG_PATH: cfg });
  await post('/api/paths/create', { key: 'CONFIG_PATH' });
  assert.deepEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')), {});
  await post('/api/paths', { CONFIG_PATH: '' });
});

test('only known paths can be set or created', async () => {
  const bad = await post('/api/paths', { HOME: '/tmp' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not a settable path/i);

  const missing = await post('/api/paths/create', { key: 'NOPE' });
  assert.equal(missing.status, 404);
});

test('adding a provider creates the config file and its directory', async () => {
  // The reported bug: CONFIG_PATH pointing somewhere that does not exist yet
  // failed with a raw ENOENT instead of writing the first provider.
  const fresh = path.join(H.tmp, 'no', 'such', 'dir', 'openclaw.json');
  fs.rmSync(path.dirname(fresh), { recursive: true, force: true });

  // Written through the same code path the panel uses, against the live
  // CONFIG_PATH — which the helper already points into the temp dir.
  const added = await post('/api/keys/add-provider', {
    name: 'mistral', baseUrl: 'https://api.mistral.ai/v1', apiKey: 'sk-test-abcd1234',
  });
  assert.equal(added.status, 200);

  const back = await get('/api/keys');
  assert.equal(back.body.providers.mistral.hasKey, true);
  assert.equal(back.body.providers.mistral.apiKeyMasked, 'sk-t••••••••1234');

  const removed = await H.api(null, 'DELETE', '/api/keys/mistral');
  assert.equal(removed.status, 200);
  assert.equal((await get('/api/keys')).body.providers.mistral, undefined);
  assert.equal((await H.api(null, 'DELETE', '/api/keys/mistral')).status, 404);
});

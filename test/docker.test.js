'use strict';

/**
 * The docker routes, on a machine that may not have docker.
 *
 * The panel is useful without it — Containers is one tab — so "there is no
 * `docker` on PATH here" is a fact about the host, not a fault in this process.
 * It answered 500 with the raw shell error, which is the same mistake as the
 * files ENOENT 500 and the `keys.js` ENOENT bug: the user goes looking for what
 * broke in the panel when nothing did.
 *
 * What is pinned is that the status carries that meaning, and that the shape is
 * the same whether docker is present or not — a route that answers differently
 * on a developer's machine than on a fresh one is a route that is untested on
 * the machine that matters.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');

const h = require('./helpers');           // must come first: it sets the env

test.before(async () => { await h.start(); });
test.after(async () => { await h.stop() });

let hasDocker = false;
try { execSync('docker --version', { stdio: 'ignore' }); hasDocker = true; } catch {}

const get = p => h.api(null, 'GET', p);

test('listing containers never reports a server fault for a missing docker', async () => {
  const r = await get('/api/docker/containers');
  assert.notEqual(r.status, 500, 'a missing binary is not a 500');

  if (hasDocker) {
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.containers));
  } else {
    assert.equal(r.status, 503, 'a dependency that is not here is a 503');
    assert.equal(r.body.code, 'docker_missing', 'the code travels so the UI can tell the difference');
    assert.match(r.body.error, /not installed/);
    assert.ok(!/Command failed/.test(r.body.error), 'the raw shell error is not the message');
  }
});

test('listing images never reports a server fault for a missing docker', async () => {
  const r = await get('/api/docker/images');
  assert.notEqual(r.status, 500, 'a missing binary is not a 500');
  if (hasDocker) assert.equal(r.status, 200);
  else {
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'docker_missing');
  }
});

test('acting on a container says docker is missing rather than failing obscurely', async () => {
  const r = await h.api(null, 'POST', '/api/docker/containers/abc123/action', { action: 'start' });
  assert.notEqual(r.status, 500, 'a missing binary is not a 500');
  if (!hasDocker) {
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'docker_missing');
  }
  // An action nobody offered is still refused as a bad request, docker or not.
  const bad = await h.api(null, 'POST', '/api/docker/containers/abc123/action', { action: 'explode' });
  assert.equal(bad.status, 400);
});

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

// Three states, not two: no binary, a binary with nothing listening, and a
// working daemon. The middle one is the commonest on a developer's machine —
// Docker Desktop installed and not started — and it was answering 500.
let hasDocker = false, daemonUp = false;
try { execSync('docker --version', { stdio: 'ignore' }); hasDocker = true; } catch {}
try { execSync('docker info', { stdio: 'ignore' }); daemonUp = true; } catch {}

/** What this machine should answer, whichever of the three it is. */
function expectDocker(r, what) {
  assert.notEqual(r.status, 500, 'neither a missing binary nor a stopped daemon is a 500');
  if (daemonUp) return assert.equal(r.status, 200);
  assert.equal(r.status, 503, 'a dependency that is not available is a 503');
  assert.equal(r.body.code, hasDocker ? 'docker_stopped' : 'docker_missing',
    'the code travels so the UI can tell the difference');
  assert.match(r.body.error, hasDocker ? /daemon is not running/ : /not installed/);
  assert.ok(!/Command failed/.test(r.body.error), 'the raw shell error is not the message');
  if (what) assert.match(r.body.error, new RegExp(what));
}

const get = p => h.api(null, 'GET', p);

test('listing containers never reports a server fault when docker is missing or stopped', async () => {
  const r = await get('/api/docker/containers');
  expectDocker(r, 'containers');
  if (daemonUp) assert.ok(Array.isArray(r.body.containers));
});

test('listing images never reports a server fault when docker is missing or stopped', async () => {
  expectDocker(await get('/api/docker/images'), 'images');
});

test('acting on a container says why docker is unavailable rather than failing obscurely', async () => {
  const r = await h.api(null, 'POST', '/api/docker/containers/abc123/action', { action: 'start' });
  // With a working daemon this is a real docker error about a container that is
  // not there, which stays a 500 with docker's own words — the two states of
  // docker itself are what this route must not report as a panel fault.
  if (!daemonUp) expectDocker(r);
  else assert.match(String(r.body.error || ''), /No such container|no such container/i);
  // An action nobody offered is still refused as a bad request, docker or not.
  const bad = await h.api(null, 'POST', '/api/docker/containers/abc123/action', { action: 'explode' });
  assert.equal(bad.status, 400);
});

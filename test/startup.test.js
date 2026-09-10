'use strict';

/**
 * Start at boot. This deliberately never installs or removes a unit: the test
 * host's own systemd is not ours to rewrite, so we assert the reported state
 * and — where the host cannot support it at all — that toggling is refused up
 * front instead of half-running run.sh.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(H.start);
after(H.stop);

test('the boot service reports its state, or says why it cannot', async () => {
  const { status, body } = await H.api(null, 'GET', '/api/startup');
  assert.equal(status, 200);
  assert.equal(body.service, 'openclaw-panel.service');

  if (body.supported) {
    assert.equal(typeof body.enabled, 'boolean');
    assert.equal(typeof body.active, 'boolean');
    return;
  }

  assert.match(body.reason, /systemd/);
  assert.equal(body.enabled, false);

  const post = await H.api(null, 'POST', '/api/startup', { enabled: true });
  assert.equal(post.status, 400);
  assert.match(post.body.error, /systemd/);
});

'use strict';

// What this host can do, probed per OS (modules/host-capabilities.js, hive.md §7).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

test('every row says whether it is there and, when it is not, what would supply it', async () => {
  const r = await H.api(null, 'GET', '/api/host/capabilities?fresh=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.os.platform, process.platform);
  for (const k of ['shell', 'boot', 'gpu', 'containers', 'vms', 'browser', 'inference', 'git', 'python', 'tailscale']) {
    const row = r.body[k];
    assert.equal(typeof row.available, 'boolean', k);
    if (!row.available) assert.ok(row.note, `${k}: an absent capability says what would supply it`);
  }
  assert.equal(r.body.shell.available, true, 'there is always a shell');
});

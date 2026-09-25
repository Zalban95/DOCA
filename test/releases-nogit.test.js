'use strict';

/** An install that is not a git checkout lists no versions, and says why — not a 500. */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

process.env.DOCA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-nogit-'));
require('./helpers');
const releases = require('../modules/releases');

test('no git checkout: an empty list and a reason', async () => {
  assert.equal(releases.isCheckout(), false);
  const l = await releases.list();
  assert.deepEqual(l.versions, []);
  assert.match(l.warning, /not a git checkout/);
});

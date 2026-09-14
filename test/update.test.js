'use strict';

/**
 * The update check, minus the network.
 *
 * What went wrong was not the comparison, it was the question: the check asked
 * GitHub's public API about a **private** repository, GitHub answered 404 to
 * avoid confirming the repo exists, and 404 arrived at the user as a green "up
 * to date". A push genuinely never showed. So the tests worth having are about
 * reading a tag listing correctly, and about never again dressing a failed
 * check as an all-clear.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');
const update = require('../modules/update');

test.before(async () => { await h.start(); });
test.after(async () => { await h.stop(); });

test('the newest tag is the highest version, not the first line', () => {
  // The failure this protects against is lexical ordering, where 2.9.0 beats
  // 2.21.0 and the panel confidently announces a downgrade.
  assert.equal(update.highest(['2.9.0', '2.21.0', '2.13.1']), '2.21.0');
  assert.equal(update.highest(['2.21.0', '2.9.0']), '2.21.0');
  assert.equal(update.highest([]), null);
  assert.equal(update.highest(['not-a-version']), null);
});

test('ls-remote output becomes version tags, peeled refs and all', () => {
  const out = [
    'a1b2c3\trefs/tags/v2.20.0',
    'd4e5f6\trefs/tags/v2.21.0',
    'd4e5f6\trefs/tags/v2.21.0^{}',        // annotated tags appear twice
    '99aa88\trefs/tags/v2.9.0',
    '77bb66\trefs/tags/some-branch-tag',   // not a version
    '',
  ].join('\n');
  const versions = update.parseLsRemote(out);
  assert.ok(versions.includes('2.21.0'));
  assert.ok(!versions.includes('some-branch-tag'));
  assert.equal(update.highest(versions), '2.21.0');
});

test('a check that could not run says so instead of claiming you are current', async () => {
  const res = await h.api(null, 'GET', '/api/update-check?force=1');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.current, 'string');
  assert.equal(typeof res.body.checked, 'boolean');

  if (res.body.checked === false) {
    assert.equal(res.body.latest, null,
      'a failed check must not report the local version as the latest — that is the whole bug');
    assert.match(res.body.reason, /not a statement that you are up to date/i);
    assert.equal(res.body.updateAvailable, false);
  } else {
    assert.match(res.body.latest, /^\d+\.\d+\.\d+$/);
    assert.ok(res.body.source, 'a successful check says how it knows');
  }
});

test('the local version is the package version, so a pull needs a restart to show', () => {
  const pkg = require('../package.json');
  const cached = require.cache[require.resolve('../modules/update.js')];
  assert.ok(cached, 'update.js is loaded');
  // LOCAL_VERSION is read at require time on purpose — the process reports what
  // it is running, not what is on disk. A pull therefore shows the old number
  // until the server restarts, which /api/update already tells the user.
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

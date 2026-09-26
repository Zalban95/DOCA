'use strict';

/**
 * The panel's own dependencies (modules/deps.js): what is behind and what has
 * advisories, from npm's answers, shown to the owner only. npm itself is
 * replaced here — the tests do not ask the registry.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H    = require('./helpers');
const deps = require('../modules/deps');

test.before(() => H.start());
test.after(() => H.stop());

const OUTDATED = {
  ws:      { current: '8.19.0', wanted: '8.21.3', latest: '8.21.3' },
  express: { current: '4.22.1', wanted: '4.22.3', latest: '5.2.1' },
};
const AUDIT = {
  metadata: { vulnerabilities: { low: 1, high: 1, total: 2 } },
  vulnerabilities: {
    'body-parser': { severity: 'low', isDirect: false, fixAvailable: true, via: [{ title: 'DoS', url: 'https://github.com/advisories/x' }] },
    ws: { severity: 'high', isDirect: true, fixAvailable: true, via: [{ title: 'Uninitialized memory disclosure', url: 'https://github.com/advisories/y' }] },
  },
};

test('npm\'s answers become one list: behind within range or by a major, advisories worst first, with licences', async () => {
  let asked = [];
  deps._setNpm(async args => { asked.push(args[0]); return { json: args[0] === 'outdated' ? OUTDATED : AUDIT }; });
  const r = await deps.check({ force: true });
  assert.deepEqual(asked.sort(), ['audit', 'outdated']);
  const ex = r.packages.find(p => p.name === 'express');
  assert.equal(ex.inRange, true);
  assert.equal(ex.major, true, '5.x is a decision, not an update');
  assert.equal(ex.declared, require('../package.json').dependencies.express);
  assert.equal(ex.licence, 'MIT', 'read from what is installed');
  assert.deepEqual(r.advisories.map(a => a.name), ['ws', 'body-parser'], 'worst first');
  assert.equal(r.advisories[0].fixInRange, true);
  assert.deepEqual(r.errors, []);

  asked = [];
  await deps.check();
  assert.deepEqual(asked, [], 'kept for an hour unless asked again');
});

test('npm failing is said, not thrown; and the route is the owner\'s', async () => {
  deps._setNpm(async () => ({ error: 'npm did not answer in time' }));
  const r = await deps.check({ force: true });
  assert.deepEqual(r.packages, []);
  assert.equal(r.errors.length, 2);

  let res = await H.api(null, 'GET', '/api/deps');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.advisories));
  const member = await H.signIn('member');
  res = await H.api(null, 'GET', '/api/deps', undefined, { Cookie: member.cookie });
  assert.equal(res.status, 403, 'it runs npm against the registry: not for everyone');
});

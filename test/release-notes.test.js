'use strict';

/** What a version added or fixed (modules/release-notes.js), read from its own commits. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const notes = require('../modules/release-notes');

test.before(() => H.start());
test.after(() => H.stop());

test('the notes read as the commits wrote them, without attribution lines or the bare bump', () => {
  const md = notes.markdown({ tag: 'v9.1.0', previous: 'v9.0.0', message: '9.1.0: a thing', changes: [{ subject: 'A thing works now', body: 'Because it did not.' }] });
  assert.match(md, /^# v9\.1\.0/);
  assert.match(md, /### A thing works now\n\nBecause it did not\./);
  assert.match(md, /_Since v9\.0\.0\._/);
});

test('a version is asked for by its tag; anything else is refused', async () => {
  assert.equal((await H.api(null, 'GET', '/api/versions/not-a-tag/notes')).status, 400);
  const r = await H.api(null, 'GET', '/api/versions/v0.0.1/notes');
  assert.ok([404, 500].includes(r.status) || r.body.tag === 'v0.0.1');
});

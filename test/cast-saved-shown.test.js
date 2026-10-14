'use strict';

/**
 * A saved TV is always in the cast list (the owner, 2026-10-14): a later sighting that says "cast" without its details
 * never empties what was saved, a saved thing that lost its Cast address still has its address, and one that does not
 * answer now is listed with why — greyed in the sheet — instead of left out.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('a saved TV stays castable when a later sighting carries no Cast details, and says it does not answer', async () => {
  const store = require('../modules/nearby/store');
  const cast = { ip: '10.250.0.9', port: 8009, name: 'Living room TV' };
  store.writeSeen([{ id: 's1', name: 'Living room TV', keys: ['cast:abc', 'ip:10.250.0.9'], addresses: ['10.250.0.9'], can: ['cast'], how: { cast }, kind: 'tv', lastSeen: new Date().toISOString() }]);
  const tv = store.save({ seenId: 's1', place: 'Home', room: 'Living room' });
  // The next scan sees it by another source only: "cast" said, no details (what emptied the owner's TV).
  store.writeSeen([{ id: 's9', name: 'A device at 10.250.0.9', keys: ['ip:10.250.0.9'], addresses: ['10.250.0.9'], can: ['cast'], how: {}, kind: 'tv', lastSeen: new Date().toISOString() }]);
  const saved = store.saved().find(t => t.id === tv.id);
  assert.equal(saved.how.cast?.ip, '10.250.0.9', 'what was saved stays known');

  const things = require('../modules/cast/things');
  const list = things.list(H.owner ? { user: H.owner.user, role: 'owner', rights: ['host'] } : null);
  const row = list.find(t => t.id === tv.id);
  assert.ok(row, 'the saved TV is in the cast list');
  assert.equal(row.port, 8009);

  const answers = require('../modules/cast/answers');
  const [checked] = await answers.withAnswers([{ ...row, address: '127.0.0.1', port: 1 }]);   // nothing listens on port 1
  if (checked.answers !== null) {   // 127.x is this hub's network only where the test machine's address is 127.0.0.x
    assert.equal(checked.answers, false);
    assert.match(checked.why, /not answering/);
  }
  assert.equal(answers.sameNet('192.168.1.99', { address: '192.168.1.212' }), true);
  assert.equal(answers.sameNet('192.168.7.99', { address: '192.168.1.212' }), false, 'another network: unknown, never "off"');
  assert.equal(await answers.knock('127.0.0.1', 1), false);
});

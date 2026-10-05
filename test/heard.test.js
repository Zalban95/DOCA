'use strict';

// A spoken answer the person talked over (modules/harness/heard.js): the conversation keeps only what was heard.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.start(); });
after(async () => { await H.stop(); });

test('the newest answer is cut after the words heard; the rest is kept aside, not sent', async () => {
  const memory = require('../modules/harness/memory');
  const id = memory.mainSession().id;
  memory.append(id, { role: 'user', content: 'Weather?' });
  memory.append(id, { role: 'assistant', content: 'It will **snow** tomorrow. Take the red coat and gloves, and leave early.' });
  const r = await H.api(null, 'POST', '/api/chat/heard', { heard: 'It will snow tomorrow. Take the red coat' });
  assert.deepEqual(r.body, { cut: true, content: 'It will **snow** tomorrow. Take the red coat —' });
  const row = memory.messages(id).at(-1);
  assert.equal(row.unheard, 'and gloves, and leave early.');
  assert.equal(row.interrupted, true);
  const sent = require('../modules/harness/turn/messages').toApiMessages(memory.messages(id), { sessionId: id });
  assert.equal(sent.at(-1).content.includes('gloves'), false, 'the model reads what was heard');
  assert.equal((await H.api(null, 'POST', '/api/chat/heard', { heard: 'It will snow tomorrow' })).body.cut, false, 'an answer is cut once');
});

test('words that are not in the answer cut nothing', async () => {
  const memory = require('../modules/harness/memory');
  const id = memory.mainSession().id;
  memory.append(id, { role: 'assistant', content: 'Four containers are running.' });
  assert.equal((await H.api(null, 'POST', '/api/chat/heard', { heard: 'something else entirely' })).body.cut, false);
  assert.equal(memory.messages(id).at(-1).content, 'Four containers are running.');
});

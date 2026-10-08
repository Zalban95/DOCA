'use strict';

/**
 * A failed job is not tried again unasked (deep test B, C13): woken with "work reported back", the Orchestrator re-sent
 * a research errand that had failed half an hour before ("Retry with a different route") inside a turn about something
 * else. Sending a failed work chat new work needs the person's yes (`asked: true`).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const memory = require('../modules/harness/memory');
const org = require('../modules/harness/organization');
const tools = require('../modules/harness/tools');

before(() => H.start());
after(() => H.stop());

test('a failed work chat is not sent new work unless the person asked', async () => {
  const main = memory.mainSession(), work = org.create({ title: 'Research llama.cpp' });
  memory.updateSession(work.id, { job: { state: 'failed', task: 'research' } });
  const out = await tools.call('work_chats', { action: 'send', sessionId: work.id, message: 'Retry with a different route' }, [], { sessionId: main.id });
  assert.match(out, /^Not sent: that work chat's job failed, and trying it again is the person's decision/);
  assert.ok(!require('../modules/harness/agent').isRunning(work.id), 'nothing started');

  memory.updateSession(work.id, { job: { state: 'done', task: 'research' } });
  const done = await tools.call('work_chats', { action: 'send', sessionId: work.id, message: 'one more thing' }, [], { sessionId: main.id });
  assert.doesNotMatch(done, /Not sent/, 'finished work may be given more');
  require('../modules/harness/agent').cancel(work.id);
});

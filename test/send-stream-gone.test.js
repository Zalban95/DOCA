'use strict';
/**
 * A queued message whose sender went away, then a turn that fails, must not take the process down (deep test A,
 * 2026-10-08: send-stream.js handed a rejection to a promise nobody awaited — an unhandled rejection exits Node).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const { EventEmitter } = require('node:events');

test('a turn failing after its sender left is logged, not an unhandled rejection', async () => {
  const agent = require('../modules/harness/agent');
  const realSend = agent.send, realTurn = agent.turn;
  let start;
  agent.send = (_opts, hooks) => { start = hooks.start; return { queued: true, id: 'q1', position: 1, sessionId: 's1' }; };
  agent.turn = () => Promise.reject(new Error('budget reached'));
  const unhandled = [];
  const onUnhandled = e => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const errs = [], realErr = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const res = new EventEmitter(); res.destroyed = false;
    const { sendStreamed } = require('../modules/harness/send-stream');
    const out = sendStreamed({ message: 'hi' }, { res, emit: () => {} });
    res.destroyed = true; res.emit('close');            // the sender goes away
    assert.equal(await out, null, 'the sender who left gets nothing');
    await start();                                         // then the queued turn starts and fails
    await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 20));
    assert.equal(unhandled.length, 0, 'no unhandled rejection');
    assert.ok(errs.some(e => /failed after its sender left: budget reached/.test(e)), 'the failure is logged');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    console.error = realErr; agent.send = realSend; agent.turn = realTurn;
  }
});

test('a sender still listening gets the failure', async () => {
  const agent = require('../modules/harness/agent');
  const realSend = agent.send, realTurn = agent.turn;
  agent.send = (_opts, hooks) => { setImmediate(() => hooks.start().catch(() => {})); return { queued: true, id: 'q2', position: 1, sessionId: 's1' }; };
  agent.turn = () => Promise.reject(new Error('model 500'));
  try {
    const res = new EventEmitter(); res.destroyed = false;
    const { sendStreamed } = require('../modules/harness/send-stream');
    await assert.rejects(sendStreamed({ message: 'hi' }, { res, emit: () => {} }), /model 500/);
  } finally { agent.send = realSend; agent.turn = realTurn; }
});

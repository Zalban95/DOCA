'use strict';

/**
 * Writing to a working conversation from the Harness console (deep test B, C5): the console queues like the floating
 * chat, and a conversation that turned out free starts its turn at once — drawn, not dropped.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

require('./helpers');

function load(events) {
  const ctx = vm.createContext({ setTimeout, document: { createElement: () => ({}) },
    sseStream: async (_url, _body, h) => { for (const e of events) h.onEvent(e); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'agent-ui', 'queued-send.js'), 'utf8'), ctx);
  return ctx;
}

async function send(events) {
  const ctx = load(events), marks = [], drawn = [];
  let starts = 0, finished = 0;
  ctx.ui = { mark: s => marks.push(s), startTurn: async () => { starts++; return { onEvent: e => drawn.push(e.type), onError() {}, finish: () => { finished++; } }; } };
  await vm.runInContext('agentQueuedSend("/x", {}, ui)', ctx);
  return { marks, drawn, starts, finished };
}

test('a queued message that starts the next turn draws that turn', async () => {
  const r = await send([{ type: 'queued', id: 'q1' }, { type: 'queued_started' }, { type: 'text' }, { type: 'done' }]);
  assert.deepEqual(r.marks, ['queued', 'started']);
  assert.equal(r.starts, 1);
  assert.deepEqual(r.drawn, ['text', 'done']);
  assert.equal(r.finished, 1);
});

test('a conversation that was free after all: its turn is drawn, not dropped', async () => {
  const r = await send([{ type: 'session' }, { type: 'text' }, { type: 'done' }]);
  assert.equal(r.starts, 1);
  assert.deepEqual(r.drawn, ['session', 'text', 'done']);
  assert.equal(r.finished, 1);
});

test('a message read by the running turn starts nothing here', async () => {
  const r = await send([{ type: 'queued', id: 'q2' }, { type: 'queued_read' }]);
  assert.deepEqual(r.marks, ['queued', 'read']);
  assert.equal(r.starts, 0);
});

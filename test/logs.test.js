'use strict';

/**
 * The Logs tab, without docker, a model, or a harness that is actually running.
 *
 * What is worth pinning here is not that lines arrive — it is the three things
 * that were decided rather than discovered, and that a later edit could quietly
 * undo: a CLI harness is listed as unavailable *with its reason* instead of
 * being hidden or offered as a dead stream; `text` deltas never become log
 * lines; and a tool call is logged by parameter name, never parameter value,
 * because `/api/logs` has no auth in front of it.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');           // must come first: it sets the env
const logs    = require('../modules/logs');
const agent   = require('../modules/harness/agent');
const catalog = require('../modules/harness/catalog');

test.before(async () => { await h.start(); });
test.after(async () => { await h.stop(); });

test('the built-in harness is always a source, because it is the panel', () => {
  const self = logs.sources().find(s => s.id === catalog.BUILTIN_ID);
  assert.ok(self, 'the DOCA harness is missing from the source list');
  assert.equal(self.available, true);
  assert.equal(self.reason, null);
});

test('a terminal harness is listed unavailable, and says why', () => {
  const cli = logs.sources().find(s => s.kind === 'cli');
  assert.ok(cli, 'no cli harness in the catalog to check');
  assert.equal(cli.available, false);
  assert.match(cli.reason, /terminal|browser|PTY|Harness tab/i,
    'an unavailable source has to explain itself — a blank reason is a bug report waiting to happen');
});

test('auto resolves to the harness selected in DOCA', () => {
  const [picked] = logs.resolve('auto');
  assert.equal(picked.id, catalog.defaultId());
  assert.deepEqual(logs.resolve(''), logs.resolve('auto'), 'no sources means auto, not nothing');
});

test('an unknown source is answered, not dropped', () => {
  const [row] = logs.resolve('nosuchharness');
  assert.equal(row.available, false);
  assert.match(row.reason, /nosuchharness/);
});

test('a tool call is logged by parameter name and never by value', () => {
  const l = logs.fromHarness({
    type: 'tool_call', step: 2, name: 'shell',
    args: { command: 'curl -H "Authorization: Bearer sk-secret-value" https://x' },
  });
  assert.match(l.text, /shell\(command\)/);
  assert.ok(!l.text.includes('sk-secret-value'),
    '/api/logs is unauthenticated — an argument value must never reach a line');
});

test('streaming text never becomes log lines', () => {
  assert.equal(logs.fromHarness({ type: 'text', text: 'hello' }), null,
    'one line per token is the conversation retyped badly');
});

test('a failed tool result is an error line; a normal one is not', () => {
  const bad  = logs.fromHarness({ type: 'tool_result', step: 1, name: 'read_file', result: 'Error: ENOENT' });
  const good = logs.fromHarness({ type: 'tool_result', step: 1, name: 'read_file', result: 'contents' });
  assert.equal(bad.level, 'error');
  assert.equal(good.level, 'info');
});

test('a warning carries the sentence the budget wrote, not a restatement', () => {
  const l = logs.fromHarness({ type: 'warning', kind: 'context', percent: 84, text: 'Context is 84% full (…).' });
  assert.equal(l.level, 'warn');
  assert.match(l.text, /84% full/);
});

test('the level of an unlabelled line comes from its text alone', () => {
  assert.equal(logs.levelOf('[stderr] boom'), 'error');
  assert.equal(logs.levelOf('DEPRECATED: x'), 'warn');
  assert.equal(logs.levelOf('listening on 4242'), 'info');
});

test('every line is an object with a source, a level and a time', () => {
  const l = logs.fromHarness({ type: 'session', sessionId: 'ses_1' });
  for (const k of ['ts', 'source', 'label', 'level', 'text']) assert.ok(k in l, `line is missing ${k}`);
  assert.equal(l.source, catalog.BUILTIN_ID);
  assert.ok(!Number.isNaN(Date.parse(l.ts)));
});

test('a turn event reaches an open stream', async () => {
  const seen = [];
  const stop = logs.open(catalog.BUILTIN_ID, { tail: 0 }, l => seen.push(l));
  agent.events.emit('event', { type: 'session', sessionId: 'ses_live' });
  stop();
  assert.ok(seen.some(l => l.text.includes('ses_live')), 'the subscriber never got the event');

  const after = seen.length;
  agent.events.emit('event', { type: 'session', sessionId: 'ses_after_stop' });
  assert.equal(seen.length, after, 'stopping a stream has to unsubscribe it');
});

test('GET /api/logs/sources answers the same list the picker draws', async () => {
  const res = await h.api(null, 'GET', '/api/logs/sources');
  assert.equal(res.status, 200);
  assert.equal(res.body.selected, catalog.defaultId());
  assert.deepEqual(res.body.sources.map(s => s.id), logs.sources().map(s => s.id));
});

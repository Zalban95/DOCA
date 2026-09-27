'use strict';

/**
 * A server that changes its tools says so, and is heard (mcp/client.js):
 * over stdio, over the HTTP GET event stream, and inside an SSE reply.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const { McpClient } = require('../modules/mcp/client');
const httpServer = require('./fixtures/mcp-http-server');

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)); }
  return false;
};

test('stdio: tools/list_changed makes the client read the tools again', async t => {
  const c = new McpClient({ id: 'grow', transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures', 'mcp-stub-server.js')] });
  await c.start();
  t.after(() => c.stop());
  assert.equal(c.tools.length, 3);
  assert.equal(await c.callTool('grow', {}), 'grew');
  assert.ok(await until(() => c.tools.length === 4), 'the new tool is in the list without anyone pressing ↺');
  assert.ok(c.log.some(l => /tools changed/.test(l)));
});

test('http: the GET stream is held open and a pushed change is heard; stop closes it', async t => {
  const stub = await httpServer.start({ stream: true });
  t.after(() => stub.close());
  const c = new McpClient({ id: 'stream', transport: 'http', url: stub.url });
  await c.start();
  assert.ok(await until(() => stub.streams.size === 1), 'the client opened the event stream');
  assert.equal(stub.seen.find(s => s.method === 'GET').headers['mcp-session-id'], 'sess-http-stub');
  stub.addTool({ name: 'later', description: 'x', inputSchema: { type: 'object', properties: {} } });
  stub.push({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  assert.ok(await until(() => c.tools.some(x => x.name === 'later')));
  c.stop();
  assert.ok(await until(() => stub.streams.size === 0), 'stopping closes the stream');
});

test('http: a stream lost for longer than six reopen attempts comes back, and a change made meanwhile is seen', async t => {
  // DocaDesk ISSUES.md D-25: _listen used to give up after six failures (about a
  // minute at the real backoff) and never say so. Shrunk here so the test is fast.
  const saved = McpClient.streamBackoff;
  McpClient.streamBackoff = { baseMs: 2, maxMs: 10 };
  t.after(() => { McpClient.streamBackoff = saved; });

  const stub = await httpServer.start({ stream: true });
  t.after(() => stub.close());
  const c = new McpClient({ id: 'away', transport: 'http', url: stub.url });
  await c.start();
  t.after(() => c.stop());
  assert.ok(await until(() => stub.streams.size === 1), 'the client opened the event stream');

  stub.drop();
  assert.ok(await until(() => stub.cut >= 12), 'the client kept trying well past the old limit of six');
  // The tools change while nobody can be told.
  stub.addTool({ name: 'while_away', description: 'x', inputSchema: { type: 'object', properties: {} } });
  stub.resume();

  assert.ok(await until(() => stub.streams.size === 1), 'the stream was reopened after the long absence');
  assert.ok(await until(() => c.tools.some(x => x.name === 'while_away')), 'the change made while away was read on return');
  assert.ok(c.log.some(l => /event stream closed/.test(l)), 'the log says it went');
  assert.ok(c.log.some(l => /event stream back/.test(l)), 'and that it came back');

  // And the ordinary path still works afterwards.
  stub.addTool({ name: 'after', description: 'x', inputSchema: { type: 'object', properties: {} } });
  stub.push({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  assert.ok(await until(() => c.tools.some(x => x.name === 'after')));
});

test('http: a server without a stream (405) is fine, and an SSE reply is matched by id past a notification', async t => {
  const stub = await httpServer.start({ sse: true, noteFirst: true });
  t.after(() => stub.close());
  const c = new McpClient({ id: 'nostream', transport: 'http', url: stub.url });
  await c.start();
  assert.equal(c.state, 'running');
  const lists = () => stub.seen.filter(s => s.method === 'tools/list').length;
  assert.equal(lists(), 1);
  assert.equal(await c.callTool('list_windows', {}), 'Notepad\nBlender', 'the reply, not the notification before it');
  assert.ok(await until(() => lists() === 2), 'and the notification was heard');
  c.stop();
});

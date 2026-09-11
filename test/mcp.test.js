'use strict';

/**
 * MCP servers: the registry, the client handshake, and the tools the harness
 * ends up seeing.
 *
 * No MCP server is installed on a test machine, so these run against
 * `fixtures/mcp-stub-server.js` — a real stdio server speaking real JSON-RPC,
 * started the same way any other would be. Nothing here reaches the network.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const H = require('./helpers');

const registry     = require('../modules/mcp/registry');
const mcpTools     = require('../modules/mcp/tools');
const harnessTools = require('../modules/harness/tools');
const exporter     = require('../modules/mcp/export');

const STUB = path.join(__dirname, 'fixtures', 'mcp-stub-server.js');

before(H.start);
after(async () => { registry.stopAll(); await H.stop(); });

const get  = p => H.api(null, 'GET', p);
const post = (p, body) => H.api(null, 'POST', p, body);

test('a server is defined by name and command, and starts out stopped', async () => {
  const saved = await post('/api/mcp', {
    label: 'Stub Server', command: process.execPath, args: [STUB],
  });
  assert.equal(saved.status, 200);
  // The id is slugged from the name so it is safe in a tool name.
  assert.equal(saved.body.server.id, 'stub-server');
  assert.equal(saved.body.server.state, 'stopped');
  assert.equal(saved.body.server.transport, 'stdio');
  assert.deepEqual(saved.body.server.args, [STUB]);

  // Nothing is running yet, so the harness sees only its own tools.
  assert.equal(harnessTools.describe().some(t => t.mcp), false);
});

test('a definition needs enough to actually run', async () => {
  assert.equal((await post('/api/mcp', { label: 'no command' })).status, 400);
  assert.equal((await post('/api/mcp', { label: 'x', transport: 'http', url: 'nonsense' })).status, 400);
  assert.equal((await post('/api/mcp', { command: 'x' })).status, 400);   // no name
});

test('starting a server completes the handshake and lists its tools', async () => {
  const r = await post('/api/mcp/stub-server/action', { action: 'start' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const s = r.body.server;
  assert.equal(s.state, 'running');
  assert.equal(s.serverInfo.name, 'stub');
  assert.deepEqual(s.tools.map(t => t.name).sort(), ['echo', 'explode', 'write_thing']);
  assert.ok(s.pid, 'a stdio server is a child process');
});

test('the harness is offered the running server\'s tools, namespaced and switchable', () => {
  const mine = harnessTools.describe().filter(t => t.mcp);
  const echo = mine.find(t => t.name === 'mcp__stub-server__echo');
  assert.ok(echo, `expected a namespaced echo, got ${mine.map(t => t.name).join(', ')}`);
  assert.equal(echo.label, 'Stub Server: echo');
  assert.equal(echo.danger, false, 'readOnlyHint means it changes nothing');
  assert.equal(mine.find(t => t.name === 'mcp__stub-server__write_thing').danger, true);

  // They reach the model as ordinary function declarations…
  const names = harnessTools.schemas().map(s => s.function.name);
  assert.ok(names.includes('mcp__stub-server__echo'));
  assert.ok(names.includes('shell'), 'without displacing the built-in ones');

  // …and the same disabledTools list the ⚙ switches write turns them off.
  const off = harnessTools.schemas(['mcp__stub-server__echo']).map(s => s.function.name);
  assert.equal(off.includes('mcp__stub-server__echo'), false);
});

test('calling one goes through the harness tool dispatcher', async () => {
  assert.equal(
    await harnessTools.call('mcp__stub-server__echo', { message: 'hello' }),
    'echo: hello');

  // A tool the server reports as failed comes back as text, so the model can
  // react to it instead of the turn dying.
  assert.match(await harnessTools.call('mcp__stub-server__explode', {}), /^Error: that did not work/);

  // Switched off, and unknown, are both refusals rather than exceptions.
  assert.match(await harnessTools.call('mcp__stub-server__echo', {}, ['mcp__stub-server__echo']), /switched off/);
  assert.match(await harnessTools.call('mcp__nope__nope', {}), /no MCP tool named/);
});

test('stopping a server withdraws its tools from the model', async () => {
  const r = await post('/api/mcp/stub-server/action', { action: 'stop' });
  assert.equal(r.status, 200);
  assert.equal(r.body.server.state, 'stopped');
  assert.equal(mcpTools.available().length, 0);
  assert.equal(harnessTools.schemas().some(s => s.function.name.startsWith('mcp__')), false);

  // A tool that is no longer offered says why rather than hanging.
  assert.match(await harnessTools.call('mcp__stub-server__echo', {}), /may have stopped/);
});

test('a server that will not start reports it in place, with its own log', async () => {
  await post('/api/mcp', { label: 'Broken', command: process.execPath, args: [STUB, '--fail'] });
  const r = await post('/api/mcp/broken/action', { action: 'start' });

  // 200 with the failure, not a 500: the panel wants to draw this, not catch it.
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.ok(r.body.error, 'says what went wrong');

  const { body } = await get('/api/mcp/broken/log');
  assert.match(body.log, /refusing to start/, 'stderr is kept, since MCP servers log there');

  // A command that does not exist at all is the same kind of answer.
  await post('/api/mcp', { label: 'Absent', command: 'doca-no-such-binary-xyz' });
  const missing = await post('/api/mcp/absent/action', { action: 'start' });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.ok, false);
});

test('unknown servers and actions are refused', async () => {
  assert.equal((await post('/api/mcp/ghost/action', { action: 'start' })).status, 404);
  assert.equal((await post('/api/mcp/stub-server/action', { action: 'sudo' })).status, 400);
  assert.equal((await post('/api/mcp/stub-server/action', { action: 'refresh' })).status, 409);
  assert.equal((await H.api(null, 'DELETE', '/api/mcp/ghost')).status, 404);
});

test('exporting writes one key and leaves the rest of the file alone', async () => {
  const target = path.join(H.tmp, 'mcp-export', 'mcp.json');
  exporter.TARGETS.__test = { label: 'Test', file: target, kind: 'json' };

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ keepMe: 'please', mcpServers: { old: { command: 'x' } } }), 'utf8');

  const r = await post('/api/mcp/export', { target: '__test', ids: ['stub-server'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const written = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(written.keepMe, 'please', 'other settings survive');
  assert.deepEqual(written.mcpServers.old, { command: 'x' }, 'and so do other servers');
  assert.deepEqual(written.mcpServers['stub-server'], { command: process.execPath, args: [STUB] });
  assert.ok(fs.existsSync(`${target}.bak`), 'the previous version is kept');

  // A file that does not parse is left completely alone: overwriting it would
  // throw away whatever else the user had in there.
  fs.writeFileSync(target, '{ this is not json', 'utf8');
  const broken = await post('/api/mcp/export', { target: '__test' });
  assert.equal(broken.status, 409);
  assert.equal(fs.readFileSync(target, 'utf8'), '{ this is not json');

  delete exporter.TARGETS.__test;
});

test('Codex is handed a TOML snippet instead of a rewritten config', async () => {
  const r = await post('/api/mcp/export', { target: 'codex', ids: ['stub-server'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.manual, true);
  assert.match(r.body.snippet, /\[mcp_servers\.stub-server\]/);
  assert.match(r.body.snippet, /command = /);
  assert.equal((await post('/api/mcp/export', { target: 'nope' })).status, 400);
});

test('removing a server takes it out of the registry', async () => {
  for (const id of ['broken', 'absent', 'stub-server']) {
    assert.equal((await H.api(null, 'DELETE', `/api/mcp/${id}`)).status, 200);
  }
  assert.deepEqual((await get('/api/mcp')).body.servers, []);
});

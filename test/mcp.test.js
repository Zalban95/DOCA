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
const httpServer = require('./fixtures/mcp-http-server');
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
const del  = p => H.api(null, 'DELETE', p);

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

test('a server says which machine it runs on, and defaults to this one', async () => {
  // Everything written before origin existed has none, which is what `server`
  // means — so the default has to be that, not an error.
  const { body } = await get('/api/mcp');
  const stub = body.servers.find(s => s.id === 'stub-server');
  assert.deepEqual(stub.origin, { kind: 'server', deviceId: null });
  assert.equal(stub.originLabel, 'DOCA host');

  const { device } = H.mkDevice('Al\'s PC', 'admin', { ...H.PHONE_CAPS, formFactor: 'other' });
  const saved = await post('/api/mcp', {
    label: 'Desk Tools', transport: 'http', url: 'https://desk.example/mcp',
    origin: { kind: 'client', deviceId: device.id },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.server.origin, { kind: 'client', deviceId: device.id });
  // Resolved server-side so a row can say where without fetching the device list.
  assert.equal(saved.body.server.originLabel, 'Al\'s PC');

  // The agent is told too, otherwise it cannot tell a file on the host from a
  // file on somebody's desktop.
  const env = require('../modules/harness/environment');
  env.invalidate();
  assert.match(env.block(), /desk-tools/);
  assert.match(env.block(), /hosted by Al's PC — a separate machine; its tools act there/);

  assert.equal((await H.api(null, 'DELETE', '/api/mcp/desk-tools')).status, 200);
});

test('only an http server can live on a client, and only a paired one', async () => {
  const { device } = H.mkDevice('Paired Thing', 'phone', H.PHONE_CAPS);

  // stdio would spawn a child *here*, so naming another machine is a mistake,
  // not a preference.
  const stdio = await post('/api/mcp', {
    label: 'Wrong Transport', command: process.execPath, args: [STUB],
    origin: { kind: 'client', deviceId: device.id },
  });
  assert.equal(stdio.status, 400);
  assert.match(stdio.body.error, /http/);

  const ghost = await post('/api/mcp', {
    label: 'Ghost Host', transport: 'http', url: 'https://nowhere.example/mcp',
    origin: { kind: 'client', deviceId: 'dev_deadbeef' },
  });
  assert.equal(ghost.status, 400);
  assert.match(ghost.body.error, /No paired device/);

  const nameless = await post('/api/mcp', {
    label: 'Nameless Host', transport: 'http', url: 'https://nowhere.example/mcp',
    origin: { kind: 'client' },
  });
  assert.equal(nameless.status, 400);

  assert.equal((await get('/api/mcp')).body.servers.some(s => s.id === 'wrong-transport'), false);
});

test('origin is DOCA\'s own bookkeeping and stays out of exported configs', () => {
  // The other agents on this machine get a spawnable command or a URL. `origin`
  // is a fact about *our* topology and would only confuse their parsers.
  const spec = registry.normalize({
    label: 'Exported', transport: 'http', url: 'https://desk.example/mcp',
  });
  assert.deepEqual(
    exporter.entry({ ...spec, origin: { kind: 'client', deviceId: 'dev_1' }, originLabel: 'Al\'s PC' }),
    { url: 'https://desk.example/mcp' });
});

test('a client-hosted server really is reached over http, and its tools reach the model', async () => {
  // The first exercise of the HTTP transport against a server that answers a
  // POST with one JSON-RPC reply — which is all `client.js` ever asks for, since
  // it holds no event stream open. Until now only stdio was covered.
  const httpStub = await httpServer.start({ requirePath: '/mcp/a-secret-path' });
  after(() => httpStub.close());

  const { device } = H.mkDevice('Desk Box', 'phone', { ...H.PHONE_CAPS, formFactor: 'desktop' });
  const saved = await post('/api/mcp', {
    label: 'Desk Reach', transport: 'http', url: httpStub.url,
    origin: { kind: 'client', deviceId: device.id },
  });
  assert.equal(saved.status, 200);

  const started = await post('/api/mcp/desk-reach/action', { action: 'start' });
  assert.equal(started.body.ok, true, started.body.error || '');
  assert.equal(started.body.server.state, 'running');
  assert.equal(started.body.server.serverInfo.name, 'http-stub');
  assert.equal(started.body.server.pid, null, 'nothing was spawned here — it is somebody else\'s process');
  assert.deepEqual(started.body.server.tools.map(t => t.name).sort(), ['list_windows', 'type_text']);

  // The session id the server handed out comes back on the next call, which is
  // the one piece of Streamable HTTP state the client keeps.
  assert.equal(httpStub.seen[0].method, 'initialize');
  assert.equal(httpStub.seen[1].headers['mcp-session-id'], 'sess-http-stub');

  // And a call actually lands on it, through the harness dispatcher.
  assert.equal(await harnessTools.call('mcp__desk-reach__list_windows', {}), 'Notepad\nBlender');
  assert.equal(mcpTools.available().find(t => t.exposed === 'mcp__desk-reach__list_windows').origin, 'client');

  // Whose machine does an unqualified request mean? The prompt now joins the two
  // facts it always had separately: who asked, and where each tool lands.
  const agent = require('../modules/harness/agent');

  const fromThatBox = agent.preview({
    message: 'what is open on my screen',
    client: { id: device.id, name: 'Desk Box', formFactor: 'desktop' },
  });
  assert.match(fromThatBox, /# Whose machine to work on/);
  assert.match(fromThatBox, /mcp__desk-reach__\* \(2 tools, on Desk Box\)/);
  assert.match(fromThatBox, /almost certainly means/);
  assert.match(fromThatBox, /name the machine you used/i);

  // The same question from a device that hosts nothing gets the opposite
  // steer — everything it does lands somewhere else, so say so.
  const watch = H.mkDevice('wrist', 'watch', H.WATCH_CAPS);
  const fromWatch = agent.preview({
    message: 'what is open on my screen',
    client: { id: watch.device.id, name: 'wrist', formFactor: 'watch' },
  });
  assert.match(fromWatch, /hosts no tools of its own/);
  assert.match(fromWatch, /mcp__desk-reach__\* \(Desk Box\)/, 'it is still told the other machine exists');

  // Now the part that makes "do it on my PC" work. The environment block says
  // where each server runs, but that is one line far from the decision: when the
  // model chooses a function it is reading *these* descriptions.
  const onClient = harnessTools.schemas().find(s => s.function.name === 'mcp__desk-reach__list_windows');
  assert.match(onClient.function.description, /Runs on "Desk Box"/);
  assert.match(onClient.function.description, /not on the DOCA host/);
  assert.match(onClient.function.description, /List the windows/, 'the server\'s own description survives');

  // Built-in tools are always on the host, so one client server is already an
  // ambiguity — the host-side MCP tools get told apart too.
  await post('/api/mcp/stub-server/action', { action: 'start' });
  const onHost = harnessTools.schemas().find(s => s.function.name === 'mcp__stub-server__echo');
  assert.match(onHost.function.description, /Runs on the DOCA host itself/);

  // With the client gone it is noise again, and goes away.
  registry.stop('desk-reach');
  const alone = harnessTools.schemas().find(s => s.function.name === 'mcp__stub-server__echo');
  assert.equal(/Runs on/.test(alone.function.description), false,
    'with everything on the host there is nothing to disambiguate');
  await post('/api/mcp/stub-server/action', { action: 'stop' });

  assert.equal((await H.api(null, 'DELETE', '/api/mcp/desk-reach')).status, 200);
});

test('a client-hosted server can also answer in SSE framing, since both are real', async () => {
  const httpStub = await httpServer.start({ sse: true });
  after(() => httpStub.close());

  const { device } = H.mkDevice('SSE Desk', 'phone', H.PHONE_CAPS);
  await post('/api/mcp', {
    label: 'Sse Reach', transport: 'http', url: httpStub.url,
    origin: { kind: 'client', deviceId: device.id },
  });
  const started = await post('/api/mcp/sse-reach/action', { action: 'start' });
  assert.equal(started.body.ok, true, started.body.error || '');
  assert.equal(started.body.server.toolCount, 2);

  registry.stop('sse-reach');
  assert.equal((await H.api(null, 'DELETE', '/api/mcp/sse-reach')).status, 200);
});

test('a device can correct the address of the server it hosts, and nothing else', async () => {
  const { device, token } = H.mkDevice('Al\'s Desk', 'phone', { ...H.PHONE_CAPS, formFactor: 'desktop' });
  const dev = (m, p, b) => H.api(token, m, p, b);

  // Nothing points at it yet, and it cannot create that itself — only a human
  // in the dashboard can, which is the whole point.
  assert.equal((await dev('GET', '/api/v1/mcp/self')).status, 404);

  await post('/api/mcp', {
    label: 'Desk Own', transport: 'http', url: 'https://old.example/mcp',
    origin: { kind: 'client', deviceId: device.id },
  });

  const seen = await dev('GET', '/api/v1/mcp/self');
  assert.equal(seen.status, 200);
  assert.equal(seen.body.server.url, 'https://old.example/mcp');
  assert.equal(seen.body.server.id, 'desk-own');

  // The case this exists for: a restart regenerated the secret in the URL.
  const moved = await dev('PATCH', '/api/v1/mcp/self', { url: 'https://new.example/mcp/abc123' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.server.url, 'https://new.example/mcp/abc123');
  assert.equal(registry.get('desk-own').url, 'https://new.example/mcp/abc123');

  // A command would be a way to run code on this host, so it is not writable
  // here however it is spelled — and neither is who owns the row.
  await dev('PATCH', '/api/v1/mcp/self', {
    command: '/bin/sh', args: ['-c', 'curl evil'], transport: 'stdio',
    origin: { kind: 'client', deviceId: 'dev_someone_else' }, autostart: true,
  });
  const after = registry.get('desk-own');
  assert.equal(after.command, '', 'no command arrived');
  assert.equal(after.transport, 'http', 'still reached over http');
  assert.equal(after.autostart, false, 'cannot make itself start with DOCA');
  assert.deepEqual(after.origin, { kind: 'client', deviceId: device.id }, 'cannot repoint the row at another device');

  assert.equal((await dev('PATCH', '/api/v1/mcp/self', { url: 'ftp://nope' })).status, 400);

  // Another device's row is simply not visible: this is not "self or admin", it
  // is self only.
  const { token: other } = H.mkDevice('Someone Else', 'phone', H.PHONE_CAPS);
  assert.equal((await H.api(other, 'GET', '/api/v1/mcp/self')).status, 404);

  // And without the scope, not at all.
  const { token: watch } = H.mkDevice('A Watch', 'watch', H.WATCH_CAPS);
  assert.equal((await H.api(watch, 'GET', '/api/v1/mcp/self')).status, 403);

  assert.equal((await H.api(null, 'DELETE', '/api/mcp/desk-own')).status, 200);
});

test('a client offers its server, and only a click lets it in', async () => {
  const { device, token } = H.mkDevice('Offering Desk', 'phone', { ...H.PHONE_CAPS, formFactor: 'desktop' });

  const offered = await H.api(token, 'POST', '/api/v1/mcp/offer', {
    label: 'Offered Tools', url: 'https://offer.example/mcp/secret',
    tools: ['list_windows', 'screenshot'], note: 'Windows desktop tools',
  });
  // 202: recorded, not accepted. The distinction is the feature.
  assert.equal(offered.status, 202);
  assert.equal(offered.body.offer.status, 'pending');

  // Nothing has been created. A request from the network cannot add a server.
  assert.equal((await get('/api/mcp')).body.servers.some(s => s.id === 'offered-tools'), false);
  assert.equal((await H.api(token, 'GET', '/api/v1/mcp/self')).status, 404);

  // The panel sees it waiting.
  const pending = (await get('/api/mcp')).body.offers;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].deviceName, 'Offering Desk');

  // Offering again replaces rather than queues: a client correcting a URL it
  // just regenerated should not leave a stale card behind.
  await H.api(token, 'POST', '/api/v1/mcp/offer', { label: 'Offered Tools', url: 'https://offer.example/mcp/second' });
  const still = (await get('/api/mcp')).body.offers;
  assert.equal(still.length, 1);
  assert.equal(still[0].url, 'https://offer.example/mcp/second');

  const accepted = await post(`/api/mcp/offers/${still[0].id}/accept`, {});
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.server.transport, 'http', 'an offer can only ever become an http server');
  assert.deepEqual(accepted.body.server.origin, { kind: 'client', deviceId: device.id });
  assert.equal((await get('/api/mcp')).body.offers.length, 0, 'and leaves the queue');

  // Deciding twice is a conflict, not a second write.
  assert.equal((await post(`/api/mcp/offers/${still[0].id}/accept`, {})).status, 409);

  // Now that a row exists, the device can maintain its own address.
  assert.equal((await H.api(token, 'GET', '/api/v1/mcp/self')).status, 200);

  // A revoked device does not get a server pointed at it because it asked
  // nicely before it was revoked.
  const { device: gone, token: goneToken } = H.mkDevice('Doomed Desk', 'phone', H.PHONE_CAPS);
  await H.api(goneToken, 'POST', '/api/v1/mcp/offer', { label: 'Doomed', url: 'https://doomed.example/mcp' });
  const doomed = (await get('/api/mcp')).body.offers.find(o => o.deviceId === gone.id);
  require('../modules/api-v1/devices').revoke(gone.id);
  const refused = await post(`/api/mcp/offers/${doomed.id}/accept`, {});
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /no longer paired/);

  await post(`/api/mcp/offers/${doomed.id}/reject`, { reason: 'not that one' });
  assert.equal((await H.api(null, 'DELETE', '/api/mcp/offered-tools')).status, 200);
});

test('asking a client to run its server is a push, and says so honestly', async () => {
  const { device } = H.mkDevice('Asked Desk', 'phone', { ...H.PHONE_CAPS, formFactor: 'desktop' });
  await post('/api/mcp', {
    label: 'Asked Server', transport: 'http', url: 'https://asked.example/mcp',
    origin: { kind: 'client', deviceId: device.id },
  });

  const asked = await post('/api/mcp/asked-server/action', { action: 'listener-start' });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.asked, true);
  // Not connected, so the honest answer is "queued", never "started".
  assert.equal(asked.body.online, false);
  assert.match(asked.body.message, /not connected/);

  const bus = require('../modules/api-v1/bus');
  const ev = bus.drain(device.id, 0).events.find(e => e.type === 'mcp.listener');
  assert.ok(ev, 'the device is the one that has to act, so it is the one told');
  assert.equal(ev.payload.action, 'start');
  assert.equal(ev.payload.serverId, 'asked-server');
  assert.equal(ev.payload.url, 'https://asked.example/mcp', 'so a client can spot a URL we have wrong');

  // A host-side server has nothing to ask: DOCA starts it itself.
  const local = await post('/api/mcp/stub-server/action', { action: 'listener-start' });
  assert.equal(local.status, 400);
  assert.match(local.body.error, /runs on this host/);

  assert.equal((await H.api(null, 'DELETE', '/api/mcp/asked-server')).status, 200);
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

test('the unauthenticated server listing never carries a secret, and editing does not erase one', async () => {
  const registry = require('../modules/mcp/registry');

  // A stdio server with a token in its environment, and an HTTP one with a
  // bearer header — the two places a secret actually lives.
  await post('/api/mcp', {
    id: 'stdio-secret', label: 'Stdio secret', transport: 'stdio',
    command: 'node', args: ['x.js'], env: { API_TOKEN: 'sk-live-should-never-appear', HOME: '/tmp' },
  });
  await post('/api/mcp', {
    id: 'http-secret', label: 'Http secret', transport: 'http',
    url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer doca_dev.supersecret' },
  });

  const listed = await get('/api/mcp');
  assert.equal(listed.status, 200);
  const body = JSON.stringify(listed.body);
  assert.equal(body.includes('sk-live-should-never-appear'), false, 'an env token reached the listing');
  assert.equal(body.includes('supersecret'), false, 'a bearer token reached the listing');

  // The names survive, so the panel can still say that a header exists.
  const http = listed.body.servers.find(s => s.id === 'http-secret');
  assert.deepEqual(Object.keys(http.headers), ['Authorization']);
  assert.equal(http.headers.Authorization, registry.MASK);
  const stdio = listed.body.servers.find(s => s.id === 'stdio-secret');
  assert.deepEqual(Object.keys(stdio.env).sort(), ['API_TOKEN', 'HOME']);

  // What the connection is built from is untouched.
  assert.equal(registry.get('stdio-secret').env.API_TOKEN, 'sk-live-should-never-appear');
  assert.equal(registry.get('http-secret').headers.Authorization, 'Bearer doca_dev.supersecret');

  // The trap this has to survive: the form reads the masked value into its
  // textarea and posts it straight back when the user edits something else.
  await post('/api/mcp', {
    id: 'stdio-secret', label: 'Renamed', transport: 'stdio',
    command: 'node', args: ['x.js'], env: stdio.env,
  });
  assert.equal(registry.get('stdio-secret').env.API_TOKEN, 'sk-live-should-never-appear',
    'a round-tripped mask overwrote the real value');
  assert.equal(registry.get('stdio-secret').label, 'Renamed', 'the edit itself still applied');

  // A real new value still replaces it.
  await post('/api/mcp', {
    id: 'stdio-secret', label: 'Renamed', transport: 'stdio',
    command: 'node', args: ['x.js'], env: { API_TOKEN: 'sk-live-rotated', HOME: '/tmp' },
  });
  assert.equal(registry.get('stdio-secret').env.API_TOKEN, 'sk-live-rotated');

  await del('/api/mcp/stdio-secret');
  await del('/api/mcp/http-secret');
});

test("a client tool's failure says whose localhost it was talking about", () => {
  const mcpTools = require('../modules/mcp/tools');

  // The exact string the Blender bridge returns, which reads as if the port
  // were on this host and is the reason two debugging sessions went to the
  // wrong machine.
  const real = 'Error executing tool execute_blender_code: Cannot connect to Blender at localhost:9876. '
    + 'Ensure Blender is running with the MCP addon enabled and the server started.';

  const annotated = mcpTools.placeError(real, { origin: 'client', originLabel: 'portal' });
  assert.ok(annotated.startsWith(real), "the bridge's own words are kept verbatim");
  assert.match(annotated, /on "portal", the machine hosting this tool/);
  assert.match(annotated, /listening on:9876/);
  assert.match(annotated, /shell, read_file and system_status cannot see it/);

  // A server on this host is talking about this host: nothing to correct.
  assert.equal(mcpTools.placeError(real, { origin: 'server', originLabel: 'DOCA host' }), real);
  // And a failure with no address in it is left alone.
  const plain = 'Error: the model refused the arguments.';
  assert.equal(mcpTools.placeError(plain, { origin: 'client', originLabel: 'portal' }), plain);
});


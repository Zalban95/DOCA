'use strict';

/**
 * Home Assistant's token has one home (TODO C7b, 2.266.0): a key for services, which the MCP connection adds as it
 * starts (registry.withKey) — moved there from the server's header by migration 2.266-ha-token.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const http   = require('node:http');

test.before(() => H.start());
test.after(() => H.stop());

test('the migration moves the header into the keys, once, and leaves a different token alone', () => {
  const { run, MIGRATIONS } = require('../modules/migrations');
  const keys = require('../modules/service-keys');
  const only = MIGRATIONS.filter(m => m.id === '2.266-ha-token');
  const prefs = { mcpServers: [{ id: 'home-assistant', transport: 'http', url: 'http://ha.lan:8123/api/mcp', headers: { Authorization: 'Bearer tok-123' }, origin: { kind: 'server' } }] };
  const { prefs: out, ran } = run(prefs, only);
  assert.deepEqual(out.mcpServers[0].headers, {});
  assert.equal(out.mcpServers[0].key, 'home-assistant');
  assert.equal(ran[0].changed.length, 1);
  assert.deepEqual(keys.list().map(k => [k.name, k.origin, k.hasKey]), [['home-assistant', 'http://ha.lan:8123', true]]);
  assert.equal(run(out, only).ran.length, 0, 'once');

  const other = { mcpServers: [{ id: 'home-assistant', transport: 'http', url: 'http://ha.lan:8123/api/mcp', headers: { Authorization: 'Bearer another' }, origin: { kind: 'server' } }] };
  assert.equal(run(other, only).prefs.mcpServers[0].headers.Authorization, 'Bearer another', 'a different token already holds the name: nothing moves');
  keys.remove('home-assistant');
});

test('a server naming a key is sent it — only to the key\'s own address — and the definition never holds it', async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    seen = req.headers.authorization || null;
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const m = JSON.parse(raw || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (m.id === undefined) { res.statusCode = 202; return res.end(); }
      const result = m.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'ha', version: '1' } } : { tools: [] };
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/mcp`;
  const keys = require('../modules/service-keys'), registry = require('../modules/mcp/registry');
  try {
    keys.save({ name: 'home-assistant', origin: url, key: 'tok-xyz' });
    registry.upsert({ id: 'home-assistant', label: 'HA', transport: 'http', url, key: 'home-assistant' });
    await registry.start('home-assistant');
    assert.equal(seen, 'Bearer tok-xyz');
    assert.ok(!JSON.stringify(registry.get('home-assistant')).includes('tok-xyz'), 'the stored definition never holds the token');
    registry.upsert({ id: 'home-assistant', label: 'HA renamed', transport: 'http', url });   // the MCP form's save sends no key
    assert.equal(registry.get('home-assistant').key, 'home-assistant', 'kept');
    await registry.stop('home-assistant');
    keys.save({ name: 'home-assistant', origin: 'http://elsewhere.lan:8123', key: 'tok-xyz' });
    await assert.rejects(registry.start('home-assistant'), /sent only to http:\/\/elsewhere\.lan:8123/);
  } finally {
    try { await registry.stop('home-assistant'); } catch { /* not running */ }
    server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});

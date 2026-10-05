'use strict';

// DOCA as an MCP server (modules/api-v1/mcp-server.js, TODO H9.2): an MCP client — DOCA's own, here — connects
// with a paired device's token and talks to the hive as that device; tools follow the token's scopes.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let model, script = [];
before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"stub-model"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'); }
      const next = script.shift() || { text: '(script exhausted)' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: next.text } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});
after(async () => { try { require('../modules/mcp/registry').stop('doca-self'); } catch {} await H.stop(); await new Promise(r => model.close(r)); });

const rpc = (token, method, params = {}, id = 1) => H.api(token, 'POST', '/api/v1/mcp', { jsonrpc: '2.0', id, method, params });

test('an MCP client connects with a device token and sees the tools its scopes allow', async () => {
  const phone = H.mkDevice('cli', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(phone.device.id, { userId: H.owner.user.id });
  const reg = require('../modules/mcp/registry');
  reg.upsert({ id: 'doca-self', label: 'DOCA itself', transport: 'http', url: `${H.base}/api/v1/mcp`, headers: { Authorization: `Bearer ${phone.token}` }, autostart: false });
  const started = await reg.start('doca-self');
  assert.ok(started.ok !== false, JSON.stringify(started).slice(0, 300));
  const names = require('../modules/mcp/tools').available().filter(t => t.server === 'doca-self').map(t => t.tool).sort();
  assert.deepEqual(names, ['doca_chat', 'doca_conversations', 'doca_recipes']);
  const viewer = H.mkDevice('look', 'viewer');
  assert.deepEqual((await rpc(viewer.token, 'tools/list')).body.result.tools, [], 'a read-only token gets no tools');
  assert.equal((await rpc(null, 'tools/list', {}, 2)).status, 401);
});

test('doca_chat is a turn as that device, and the answer comes back to the caller', async () => {
  const phone = H.mkDevice('cli2', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(phone.device.id, { userId: H.owner.user.id });
  script = [{ text: 'Four containers are up.' }];
  const r = await rpc(phone.token, 'tools/call', { name: 'doca_chat', arguments: { message: 'how many containers?' } });
  const out = r.body.result.content[0].text;
  assert.match(out, /^Four containers are up\./);
  const sessionId = /\[conversation (\S+)\]/.exec(out)[1];
  assert.equal(require('../modules/harness/session-access').ownerOf(sessionId), H.owner.user.id, 'the person the device belongs to owns it');
  const list = await rpc(phone.token, 'tools/call', { name: 'doca_conversations', arguments: {} });
  assert.match(list.body.result.content[0].text, new RegExp(sessionId));
  require('../modules/recipes/store').save({ title: 'MCP echo', steps: [{ tool: 'list_dir', args: { path: '.' } }] });
  const recipes = await rpc(phone.token, 'tools/call', { name: 'doca_recipes', arguments: { action: 'list' } });
  assert.match(recipes.body.result.content[0].text, /mcp-echo — MCP echo/);
  const ran = await rpc(phone.token, 'tools/call', { name: 'doca_recipes', arguments: { action: 'run', id: 'mcp-echo' } });
  assert.match(ran.body.result.content[0].text, /Recipe done: 1 step/);
});

'use strict';

// A turn whose agent called people_models died on its next step with "person is not defined" (live, 2026-10-17): the
// "Models for people" line of the step's readings had been written into fits.likely(), where neither the person nor its
// list exists, instead of fits.inventory(). And people_models called bare looks (show) rather than refusing.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const http = require('node:http');

let server, replies = [], seen = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'base' }] })); }
      seen.push(JSON.parse(raw));
      const message = replies.shift() || { content: 'Done.' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), apartstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('a turn that called people_models goes on, its next step told what the person may assign', async () => {
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'apartstub', model: 'base', maxSteps: 4, fallbackChain: [], contextWindow: 0 });
  replies = [
    { content: '', tool_calls: [{ id: 'b', type: 'function', function: { name: 'people_models', arguments: '{}' } }] },
    { content: 'ok.' },
  ];
  seen = [];
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('people models', { activate: false });
  const person = { id: H.owner.user.id, orgId: H.owner.orgId, role: 'owner', name: 'Owner' };
  const r = await require('../modules/harness/agent').turn({ message: 'which models do people run on?', sessionId: s.id, client: { kind: 'browser', user: person } });
  assert.equal(r.text, 'ok.');
  const tool = memory.messages(s.id).find(m => m.role === 'tool');
  assert.match(String(tool.content), /Which models|rules|assign/i, 'called bare, it showed');
  assert.ok(!/Error: action/.test(String(tool.content)));
  const second = JSON.stringify(seen[1].messages);
  assert.match(second, /Models for people: Owner may assign/, 'the readings say it under What you have');
});

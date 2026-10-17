'use strict';

// A step's words start a paragraph of their own (turn/step-apart.js; audit 2026-10-17): a turn that said "Let me look."
// then called a tool then answered read "Let me look.Only two…" in its text — a device's answer, a work chat's brief.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const http = require('node:http');

let server, replies = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'base' }] })); }
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

test('words from two steps are two paragraphs in the turn\'s text and on its stream', async () => {
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'apartstub', model: 'base', maxSteps: 4, fallbackChain: [], contextWindow: 0 });
  replies = [
    { content: 'Let me look.', tool_calls: [{ id: 'a', type: 'function', function: { name: 'memory_list', arguments: '{}' } }] },
    { content: 'Only two are running.' },
  ];
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('apart', { activate: false });
  memory.updateSession(s.id, { kind: 'work' });
  const events = [];
  const r = await require('../modules/harness/agent').turn({ message: 'what runs?', sessionId: s.id, emit: e => events.push(e) });
  assert.equal(r.text, 'Let me look.\n\nOnly two are running.');
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), r.text, 'the stream draws the same paragraphs');

  // One step alone gains nothing.
  replies = [{ content: 'Hello.' }];
  assert.equal((await require('../modules/harness/agent').turn({ message: 'hi', sessionId: s.id })).text, 'Hello.');
});

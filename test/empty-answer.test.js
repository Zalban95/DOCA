'use strict';

// A turn that ends without a word is said (turn/empty-answer.js; audit 2026-10-17): Opus through OpenRouter answered
// "rm -rf /" with nothing — no text, no tool — and the person would have seen an empty bubble and no reason.

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
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.finish || (message.tool_calls ? 'tool_calls' : 'stop') }], usage: { prompt_tokens: 100, completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), emptystub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('an empty final answer is said with the provider\'s own finish reason, in the stream and the text', async () => {
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'emptystub', model: 'base', maxSteps: 4, fallbackChain: [], contextWindow: 0 });
  replies = [{ content: '', finish: 'refusal' }];
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('empty', { activate: false });
  const events = [];
  const r = await require('../modules/harness/agent').turn({ message: 'do something bad', sessionId: s.id, emit: e => events.push(e) });
  assert.match(r.text, /emptystub \/ base ended this turn without an answer\. The provider ended it with "refusal"/);
  assert.ok(events.some(e => e.type === 'warning' && e.kind === 'empty-answer'));
  replies = [{ content: 'Fine.' }];
  assert.equal((await require('../modules/harness/agent').turn({ message: 'hi', sessionId: s.id })).text, 'Fine.', 'an answer with words is left as it is');
});

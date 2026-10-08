'use strict';

/**
 * A reply that was all thinking (deep test B, C2): a thinking model spent the whole "Longest reply" on reasoning and
 * answered nothing. It is asked once more with twice the room, said as a warning; still nothing, the notice names the
 * setting. And the default reply cap is one a thinking model can answer within.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let model, seen = [], answerAt = Infinity;
before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"thinker"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const f = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
      f({ choices: [{ delta: { reasoning_content: 'thinking hard…' } }] });
      if (body.max_tokens >= answerAt) f({ choices: [{ delta: { content: 'Here is the answer.' }, finish_reason: 'stop' }] });
      else f({ choices: [{ delta: {}, finish_reason: 'length' }] });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['thinker'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'thinker', maxTokens: 2048 });
});
after(async () => { await H.stop(); await new Promise(r => model.close(r)); });

async function turn() {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('think', { activate: false });
  const events = [];
  const out = await require('../modules/harness/agent').turn({ message: 'plan it', sessionId: s.id, emit: e => events.push(e) });
  return { out, events };
}

test('a reply that was all thinking is asked once more with twice the room, and says so', async () => {
  seen = []; answerAt = 4096;
  const { out, events } = await turn();
  assert.deepEqual(seen.map(b => b.max_tokens), [2048, 4096]);
  assert.match(out.text, /Here is the answer\./);
  const w = events.find(e => e.type === 'warning' && e.kind === 'thinking-retry');
  assert.match(w?.text || '', /spent all 2048 tokens of its reply thinking .*harness\.config\.doca\.maxTokens.*room for 4096/);
  assert.ok(!events.some(e => e.kind === 'truncated'));
});

test('still all thinking: once only, and the notice names the setting', async () => {
  seen = []; answerAt = Infinity;
  const { events } = await turn();
  assert.equal(seen.length, 2, 'one retry, not a loop');
  const t = events.find(e => e.type === 'warning' && e.kind === 'truncated');
  assert.match(t?.text || '', /spent its whole reply \(4096 tokens\) thinking and wrote no answer\. Raise "Longest reply" .*harness\.config\.doca\.maxTokens/);
});

test('the default reply cap leaves a thinking model room, and a small window still checks against the old room', () => {
  const providers = require('../modules/harness/providers');
  const budget = require('../modules/harness/budget');
  assert.ok(providers.defaultParams().maxTokens >= 8192);
  const body = { messages: [{ role: 'user', content: 'x'.repeat(4000 * 4) }], max_tokens: 8192 };   // ~4000 tokens
  const rung = { provider: 'p', model: 'm', contextWindow: 8192, windowSetting: 'w' };
  assert.equal(budget.preflight(body, rung), null, 'sent: 4000 left for the reply is more than the old 2048');
  assert.ok(budget.fitReply(body, rung).max_tokens <= 8192 - 4000, 'and asked for no more than the window has left');
  assert.match(budget.preflight(body, { ...rung, contextWindow: 5000 }), /2048 reserved for the reply/);
});

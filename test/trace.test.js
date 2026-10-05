'use strict';

// A turn's trace (modules/harness/trace.js, TODO H10.1): a scripted model that calls a tool and then answers, so
// the spans can be checked one by one — what was sent, who answered, how long the tool took — and that no word of
// the conversation and no argument value is kept. Exported as OTLP/JSON; another person's turn is a 404.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const memory = require('../modules/harness/memory');

let server, script = [];
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const next = script.shift() || { text: 'done' };
      const usage = { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1000 } };
      if (next.tool) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }] }, { choices: [], usage }])(res);
      return sse([{ choices: [{ delta: { content: next.text } }] }, { choices: [], usage }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { tstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'tstub', model: 'm1', fallbackChain: [], summarizeAfter: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const secret = 'zebra-password-42';

test('a turn leaves a span per model request and per tool call, with names and numbers only', async () => {
  const s = memory.createSession('traced', { activate: false });
  script = [{ tool: 'memory_write', args: { key: 'k', value: secret } }, { text: `the secret is ${secret}` }];
  const r = await require('../modules/harness/agent').turn({ message: `remember ${secret}`, sessionId: s.id });
  const { status, body } = await H.api(null, 'GET', `/api/harness/runs/${r.runId}/trace`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.spans.map(x => x.kind), ['model', 'tool', 'model']);
  const [m1, tool, m2] = body.spans;
  assert.equal(m1.name, 'tstub / m1');
  assert.equal(m1.step, 1);
  assert.equal(m1.data.prompt, 1200);
  assert.equal(m1.data.completion, 30);
  assert.equal(m1.data.cached, 1000, 'cached tokens read the provider\'s own way');
  assert.deepEqual(m1.data.calls, ['memory_write']);
  assert.ok(m1.data.messages >= 2 && m1.data.tools > 0);
  assert.match(m1.data.system, /^[0-9a-f]{12}$/, 'a fingerprint of the system prompt actually sent');
  assert.equal(tool.name, 'memory_write');
  assert.deepEqual(tool.data.args, ['key', 'value'], 'argument names');
  assert.ok(Number.isInteger(tool.ms) && Number.isInteger(m1.ms));
  assert.ok(!JSON.stringify(body.spans).includes(secret), 'no value and no word of the conversation');
});

test('the trace exports as OTLP/JSON: one trace, the turn as root, a span per request and tool', async () => {
  const s = memory.createSession('otlp', { activate: false });
  script = [{ tool: 'memory_search', args: { query: 'x' } }, { text: 'ok' }];
  const r = await require('../modules/harness/agent').turn({ message: 'go', sessionId: s.id });
  const res = await H.api(null, 'GET', `/api/harness/runs/${r.runId}/trace?format=otlp`);
  assert.equal(res.status, 200);
  const spans = res.body.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, 4);
  const [root, ...kids] = spans;
  assert.ok(kids.every(k => k.traceId === root.traceId && k.parentSpanId === root.spanId));
  assert.match(root.traceId, /^[0-9a-f]{32}$/);
  assert.match(root.spanId, /^[0-9a-f]{16}$/);
  assert.equal(kids[0].name, 'chat m1');
  assert.deepEqual(kids[0].attributes.find(a => a.key === 'gen_ai.usage.input_tokens').value, { intValue: '1200' });
  assert.equal(kids[1].name, 'execute_tool memory_search');
  assert.ok(BigInt(kids[1].endTimeUnixNano) >= BigInt(kids[1].startTimeUnixNano));
  assert.equal(res.body.resourceSpans[0].resource.attributes.find(a => a.key === 'service.name').value.stringValue, 'doca');
});

test('another person\'s turn has no trace for them; an unknown run is a 404', async () => {
  const s = memory.createSession('owner only', { activate: false });
  memory.updateSession(s.id, { person: { id: H.owner.user.id } });
  script = [{ text: 'hi' }];
  const r = await require('../modules/harness/agent').turn({ message: 'hi', sessionId: s.id });
  const member = await H.signIn('member', 'trace-member@test.local');
  assert.equal((await H.api(null, 'GET', `/api/harness/runs/${r.runId}/trace`, undefined, { Cookie: member.cookie })).status, 404);
  assert.equal((await H.api(null, 'GET', '/api/harness/runs/run_nope/trace')).status, 404);
});

test('switched off, a turn is not traced; old spans are pruned', async () => {
  const u = require('../modules/utils'); const p = u.loadPrefs();
  u.savePrefs({ ...p, tracing: { enabled: false } });
  try {
    const s = memory.createSession('untraced', { activate: false });
    script = [{ text: 'hi' }];
    const r = await require('../modules/harness/agent').turn({ message: 'hi', sessionId: s.id });
    assert.deepEqual(require('../modules/harness/trace').spans(r.runId), []);
  } finally { u.savePrefs({ ...u.loadPrefs(), tracing: { enabled: true, retainDays: 1 } }); }
  const raw = require('../modules/db').syncHandle();
  raw.prepare("INSERT INTO trace_spans (run_id, seq, at, kind) VALUES ('run_old', 1, '2020-01-01T00:00:00.000Z', 'model')").run();
  require('../modules/harness/trace').prune();
  assert.deepEqual(require('../modules/harness/trace').spans('run_old'), []);
});

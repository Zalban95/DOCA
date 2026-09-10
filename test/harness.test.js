'use strict';

/**
 * Harness suite: the catalog the Controls page draws, and the built-in agent's
 * memory and tool-calling loop.
 *
 * The model is a scripted stub served over HTTP on an ephemeral port and
 * registered as a provider in the temp openclaw.json, so nothing here needs a
 * real key, a network, or an installed CLI.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const http = require('http');
const H = require('./helpers');

const { CONFIG_PATH } = require('../modules/paths');

/* ── Scripted model ───────────────────────────────────── */

let stub, stubUrl;
/** Queued replies, consumed in order. Each is { text } or { tool } or { json }. */
let script = [];
/** Every request body the harness sent, for asserting on the prompt. */
let seen = [];

function sse(res, frames) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

before(async () => {
  stub = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'stub-model' }, { id: 'stub-mini' }] }));
    }
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push(body);
      const next = script.shift() || { text: '(script exhausted)' };

      // A non-streaming request (the summariser) always gets a plain completion.
      if (body.stream === false || next.json) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          choices: [{ message: { content: next.text ?? next.json ?? 'ok', role: 'assistant' } }],
        }));
      }
      if (next.tool) {
        return sse(res, [{ choices: [{ delta: { tool_calls: [{
          index: 0, id: 'call_1', type: 'function',
          function: { name: next.tool, arguments: JSON.stringify(next.args || {}) },
        }] } }] }]);
      }
      // Split the text so the streaming accumulator is exercised, not bypassed.
      const mid = Math.ceil((next.text || '').length / 2);
      return sse(res, [
        { choices: [{ delta: { content: (next.text || '').slice(0, mid) } }] },
        { choices: [{ delta: { content: (next.text || '').slice(mid) } }] },
      ]);
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${stub.address().port}/v1`;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    models: { providers: { stub: { baseUrl: stubUrl, apiKey: 'test-key', models: ['stub-declared'] } } },
  }, null, 2));

  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});

after(async () => {
  await H.stop();
  await new Promise(r => stub.close(r));
});

beforeEach(() => { script = []; seen = []; });

/** POST to an SSE endpoint and collect the parsed `data:` events. */
async function stream(path, body) {
  const res = await fetch(H.base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  return text.split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter(Boolean);
}

const get = (p) => H.api(null, 'GET', p);

/* ── Catalog ──────────────────────────────────────────── */

test('a fresh install defaults to the built-in harness and lists the known ones', async () => {
  const r = await get('/api/harness');
  assert.equal(r.status, 200);
  assert.equal(r.body.default, 'doca');

  const byId = Object.fromEntries(r.body.harnesses.map(h => [h.id, h]));
  assert.equal(byId.doca.kind, 'builtin');
  assert.equal(byId.doca.detected, true, 'the built-in harness is always available');
  assert.equal(byId.doca.isDefault, true);

  // A spread of major providers, each with an installer the UI can offer.
  for (const id of ['openclaw', 'claude', 'codex', 'gemini', 'copilot', 'cursor-agent', 'aider']) {
    assert.ok(byId[id], `${id} is missing from the catalog`);
    assert.equal(byId[id].canInstall, true, `${id} has no install command`);
    assert.ok(byId[id].url, `${id} has no docs link`);
  }
  assert.ok(r.body.harnesses.length >= 14);
});

test('the default can be switched, and only to a harness that exists', async () => {
  assert.equal((await H.api(null, 'POST', '/api/harness/default', { id: 'nope' })).status, 404);

  assert.equal((await H.api(null, 'POST', '/api/harness/default', { id: 'claude' })).status, 200);
  assert.equal((await get('/api/harness')).body.default, 'claude');

  await H.api(null, 'POST', '/api/harness/default', { id: 'doca' });
  assert.equal((await get('/api/harness')).body.default, 'doca');
});

test('unknown harnesses can be added by hand, and removing one restores the default', async () => {
  const bad = await H.api(null, 'POST', '/api/harness/custom', { label: 'No Command' });
  assert.equal(bad.status, 400);

  const made = await H.api(null, 'POST', '/api/harness/custom',
    { label: 'My Agent', cmd: 'my-agent', installCmd: 'echo installing' });
  assert.equal(made.status, 200);
  assert.equal(made.body.harness.id, 'my-agent');
  assert.equal(made.body.harness.kind, 'custom');

  const dup = await H.api(null, 'POST', '/api/harness/custom', { label: 'My  Agent!', cmd: 'x' });
  assert.equal(dup.status, 409, 'the slug collides with the one just added');

  const listed = (await get('/api/harness')).body.harnesses.find(h => h.id === 'my-agent');
  assert.equal(listed.canInstall, true);
  assert.equal(listed.config.launchCmd, 'my-agent');

  await H.api(null, 'POST', '/api/harness/default', { id: 'my-agent' });
  assert.equal((await get('/api/harness')).body.default, 'my-agent');

  assert.equal((await H.api(null, 'DELETE', '/api/harness/custom/my-agent')).status, 200);
  const after = await get('/api/harness');
  assert.equal(after.body.default, 'doca', 'deleting the default falls back to the built-in harness');
  assert.equal(after.body.harnesses.some(h => h.id === 'my-agent'), false);

  assert.equal((await H.api(null, 'DELETE', '/api/harness/custom/claude')).status, 404,
    'a known harness is not removable');
});

test('model parameters round-trip, and providers/models come from the live config', async () => {
  const meta = await get('/api/harness/providers');
  assert.equal(meta.status, 200);
  const providerIds = meta.body.providers.map(p => p.id);
  assert.ok(providerIds.includes('stub'), 'a provider declared in openclaw.json is offered');
  assert.ok(providerIds.includes('ollama') && providerIds.includes('openai'));
  assert.ok(meta.body.tools.some(t => t.name === 'memory_write'));
  assert.ok(meta.body.tools.some(t => t.name === 'shell' && t.danger));

  const models = await get('/api/harness/models?provider=stub');
  assert.deepEqual(models.body.models, ['stub-declared', 'stub-mini', 'stub-model']);
  assert.equal(models.body.error, null);

  const saved = await H.api(null, 'POST', '/api/harness/doca/config',
    { temperature: 0.15, maxSteps: 3, disabledTools: ['shell'] });
  assert.equal(saved.body.config.temperature, 0.15);
  assert.equal(saved.body.config.model, 'stub-model', 'untouched fields survive a partial save');

  const row = (await get('/api/harness')).body.harnesses.find(h => h.id === 'doca');
  assert.deepEqual(row.config.disabledTools, ['shell']);

  const status = await get('/api/harness/status');
  assert.equal(status.body.ready, true);
  assert.equal(status.body.reachable, true);
  assert.equal(status.body.model, 'stub-model');

  await H.api(null, 'POST', '/api/harness/doca/config', { disabledTools: [], maxSteps: 8 });
});

test('a provider with no base URL is reported rather than silently used', async () => {
  const r = await get('/api/harness/models?provider=not-a-provider');
  assert.deepEqual(r.body.models, []);
  assert.match(r.body.error, /no base URL/);
});

/* ── The agent loop ───────────────────────────────────── */

test('a turn calls a tool, feeds the result back, and answers', async () => {
  script = [
    { tool: 'memory_write', args: { key: 'gpu', value: 'RTX 4090, 24 GB', tags: ['hardware'] } },
    { text: 'Noted: RTX 4090.' },
  ];

  const events = await stream('/api/harness/chat', { message: 'The GPU here is an RTX 4090 with 24 GB.' });
  const kinds = events.map(e => e.type);
  assert.ok(kinds.includes('session'));
  assert.deepEqual(kinds.filter(k => k === 'tool_call' || k === 'tool_result'), ['tool_call', 'tool_result']);

  const call = events.find(e => e.type === 'tool_call');
  assert.equal(call.name, 'memory_write');
  assert.equal(call.args.key, 'gpu');
  assert.match(events.find(e => e.type === 'tool_result').result, /Remembered "gpu"/);

  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'Noted: RTX 4090.');
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.code, 0);
  assert.equal(done.steps, 2, 'one tool round plus the answer');

  // The tool declarations really were offered, and the result was fed back in.
  assert.ok(seen[0].tools.some(t => t.function.name === 'memory_write'));
  const followUp = seen[1].messages;
  assert.equal(followUp.at(-1).role, 'tool');
  assert.match(followUp.at(-1).content, /Remembered/);

  // The whole exchange is durable, and the entry is in memory.
  const { entries } = (await get('/api/harness/memory')).body;
  const gpu = entries.find(e => e.key === 'gpu');
  assert.equal(gpu.value, 'RTX 4090, 24 GB');
  assert.equal(gpu.source, 'agent');

  const { sessions, active } = (await get('/api/harness/sessions')).body;
  assert.equal(sessions[0].id, active);
  assert.equal(sessions[0].title, 'The GPU here is an RTX 4090 with 24 GB.');
  const roles = (await get(`/api/harness/sessions/${active}`)).body.messages.map(m => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'tool', 'assistant']);
});

test('what the agent remembered comes back in the next turn, in a new conversation', async () => {
  script = [{ text: 'You have an RTX 4090 with 24 GB.' }];
  const fresh = await H.api(null, 'POST', '/api/harness/sessions', { title: 'later' });

  await stream('/api/harness/chat', { message: 'Which GPU is in this box?', sessionId: fresh.body.session.id });

  const system = seen[0].messages[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /What you remember/);
  assert.match(system.content, /gpu: RTX 4090, 24 GB/, 'the fact survived into a brand-new conversation');
  assert.match(system.content, /# Environment/, 'the live environment is described too');

  // A fresh conversation starts from the user message, not the old transcript.
  assert.equal(seen[0].messages.filter(m => m.role === 'user').length, 1);
});

test('memory can be written and forgotten from the panel', async () => {
  const w = await H.api(null, 'POST', '/api/harness/memory',
    { key: 'models-dir', value: '/mnt/models', pinned: true });
  assert.equal(w.status, 200);
  assert.equal(w.body.entry.source, 'user');

  const again = await H.api(null, 'POST', '/api/harness/memory', { key: 'models-dir', value: '/srv/models' });
  assert.equal((await get('/api/harness/memory')).body.entries.filter(e => e.key === 'models-dir').length, 1,
    'writing the same key updates it instead of duplicating it');
  assert.equal(again.body.entry.value, '/srv/models');
  assert.equal(again.body.entry.pinned, true, 'an update keeps the pin');

  assert.equal((await H.api(null, 'POST', '/api/harness/memory', { key: 'x' })).status, 400);

  // Pinned entries are always in context, whether or not the question matches.
  script = [{ text: 'ok' }];
  await stream('/api/harness/chat', { message: 'hello' });
  assert.match(seen[0].messages[0].content, /models-dir: \/srv\/models/);

  assert.equal((await H.api(null, 'DELETE', '/api/harness/memory/models-dir')).status, 200);
  assert.equal((await H.api(null, 'DELETE', '/api/harness/memory/models-dir')).status, 404);
});

test('the step cap stops a model that keeps calling tools', async () => {
  await H.api(null, 'POST', '/api/harness/doca/config', { maxSteps: 2 });
  script = [
    { tool: 'memory_search', args: { query: 'anything' } },
    { tool: 'memory_search', args: { query: 'again' } },
  ];

  const events = await stream('/api/harness/chat', { message: 'loop please' });
  assert.equal(events.filter(e => e.type === 'tool_call').length, 2);
  assert.match(events.filter(e => e.type === 'text').map(e => e.text).join(''), /Stopped after 2 tool steps/);
  assert.equal(events.at(-1).code, 0);

  await H.api(null, 'POST', '/api/harness/doca/config', { maxSteps: 8 });
});

test('a switched-off tool is refused even if the model asks for it', async () => {
  await H.api(null, 'POST', '/api/harness/doca/config', { disabledTools: ['shell'] });
  script = [{ tool: 'shell', args: { command: 'rm -rf /' } }, { text: 'I cannot.' }];

  const events = await stream('/api/harness/chat', { message: 'wipe the disk' });
  assert.match(events.find(e => e.type === 'tool_result').result, /switched off/);
  assert.equal(seen[0].tools.some(t => t.function.name === 'shell'), false,
    'a disabled tool is not even declared to the model');

  await H.api(null, 'POST', '/api/harness/doca/config', { disabledTools: [] });
});

test('an endpoint that ignores the stream flag still produces an answer', async () => {
  script = [{ json: 'Plain completion, no SSE.' }];
  const events = await stream('/api/harness/chat', { message: 'hi' });
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'Plain completion, no SSE.');
  assert.equal(events.at(-1).code, 0);
});

test('a provider failure is reported on the stream, not as a dead request', async () => {
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'openai', model: '' });
  const noModel = await stream('/api/harness/chat', { message: 'hi' });
  assert.match(noModel.find(e => e.type === 'error').text, /No model chosen/);
  assert.equal(noModel.at(-1).code, 1);

  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});

test('a long conversation folds its older half into a summary', async () => {
  const { body } = await H.api(null, 'POST', '/api/harness/sessions', { title: 'long one' });
  const id = body.session.id;
  await H.api(null, 'POST', '/api/harness/doca/config', { summarizeAfter: 4 });

  for (let i = 0; i < 4; i++) {
    script = [{ text: `reply ${i}` }];
    await stream('/api/harness/chat', { message: `question ${i}`, sessionId: id });
  }
  // 8 rows now exceed the threshold, so the next turn summarises the older half.
  script = [{ text: 'brief: talked about questions 0-1' }, { text: 'reply 4' }];
  await stream('/api/harness/chat', { message: 'question 4', sessionId: id });

  const session = (await get(`/api/harness/sessions/${id}`)).body.session;
  assert.ok(session.summarizedThrough > 0, 'some rows were folded away');
  assert.equal(session.summary, 'brief: talked about questions 0-1');

  // The summary reaches the model, and the folded rows no longer do.
  const last = seen.at(-1).messages;
  assert.match(last[0].content, /Earlier in this conversation\nbrief: talked about questions 0-1/);
  assert.equal(last.some(m => m.content === 'question 0'), false);
  assert.equal((await get(`/api/harness/sessions/${id}`)).body.messages.length > session.summarizedThrough, true,
    'the full transcript is still on disk');

  await H.api(null, 'POST', '/api/harness/doca/config', { summarizeAfter: 40 });
});

test('sessions can be created, switched and deleted', async () => {
  const a = (await H.api(null, 'POST', '/api/harness/sessions', { title: 'alpha' })).body.session;
  const b = (await H.api(null, 'POST', '/api/harness/sessions', { title: 'beta' })).body.session;
  assert.equal((await get('/api/harness/sessions')).body.active, b.id);

  assert.equal((await H.api(null, 'POST', `/api/harness/sessions/${a.id}/activate`)).status, 200);
  assert.equal((await get('/api/harness/sessions')).body.active, a.id);
  assert.equal((await H.api(null, 'POST', '/api/harness/sessions/nope/activate')).status, 404);

  assert.equal((await H.api(null, 'DELETE', `/api/harness/sessions/${a.id}`)).status, 200);
  assert.equal((await get(`/api/harness/sessions/${a.id}`)).status, 404);
  assert.notEqual((await get('/api/harness/sessions')).body.active, a.id);
});

test('the floating chat panel answers through the default harness', async () => {
  script = [{ text: 'Answered by the built-in harness.' }];
  const events = await stream('/api/chat', { message: 'who is answering?' });
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'Answered by the built-in harness.');

  const status = await get('/api/chat/status');
  assert.equal(status.body.harness.id, 'doca');
  assert.equal(status.body.chatEnabled, true);
  assert.match(status.body.hint, /DOCA Harness/);
});

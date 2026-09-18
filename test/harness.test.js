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

/**
 * Held-open responses, so `after()` can destroy them. A stalling provider is
 * one that never ends its response — the test has to be able to end it.
 */
let stalled = [];

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

      // The provider that accepts and never answers: 200, the right
      // content-type, and then either SSE comments forever or no body at all.
      // Observed against DeepSeek, 2026-09-14 — see ISSUES.md H-5.
      if (next.stall) {
        stalled.push(res);
        if (next.stall === 'json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return;                                    // headers, then silence
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const beat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 40);
        res.on('close', () => clearInterval(beat));
        return;
      }

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
  for (const res of stalled) { try { res.destroy(); } catch {} }
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

/* ── A provider that accepts and never answers ────────── */

test('a provider that only sends keep-alives ends the turn and names the setting', async () => {
  await H.api(null, 'POST', '/api/harness/doca/config', { firstTokenTimeoutMs: 900 });
  script = [{ stall: 'sse' }];

  const events = await stream('/api/harness/chat', { message: 'anyone there?' });

  // It ends. Before this it waited forever and the console showed nothing.
  assert.equal(events.at(-1).type, 'done');

  const err = events.find(e => e.type === 'error');
  assert.ok(err, 'the turn reports the stall rather than hanging');
  // Charter rule 12: whose limit, and what to do about it. Never a bare timeout.
  assert.match(err.text, /without sending a token/);
  assert.match(err.text, /firstTokenTimeoutMs/);
  assert.match(err.text, /not the model's/);
  assert.doesNotMatch(err.text, /^timeout$/i);

  // The wait itself was visible while it was happening.
  const waits = events.filter(e => e.type === 'waiting');
  assert.ok(waits.length, 'silence is reported while it lasts, not only once it fails');
  assert.ok(waits.at(-1).frames > 0, 'keep-alive frames are counted, not silently dropped');

  await H.api(null, 'POST', '/api/harness/doca/config', { firstTokenTimeoutMs: 90000 });
});

test('the deadline covers the non-streaming path too', async () => {
  await H.api(null, 'POST', '/api/harness/doca/config', { firstTokenTimeoutMs: 900 });
  script = [{ stall: 'json' }];

  const events = await stream('/api/harness/chat', { message: 'anyone there?' });
  const err = events.find(e => e.type === 'error');
  assert.ok(err, 'a JSON provider that sends headers and no body is the same fault');
  assert.match(err.text, /firstTokenTimeoutMs/);

  await H.api(null, 'POST', '/api/harness/doca/config', { firstTokenTimeoutMs: 90000 });
});

test('a slow first token is not a stall once it arrives', async () => {
  // The deadline is on the first token only: a provider that starts late but
  // does start must not be cut off, or the fix becomes a cap on long answers.
  await H.api(null, 'POST', '/api/harness/doca/config', { firstTokenTimeoutMs: 5000 });
  script = [{ text: 'here I am' }];

  const events = await stream('/api/harness/chat', { message: 'hello' });
  assert.equal(events.filter(e => e.type === 'error').length, 0);
  assert.match(events.filter(e => e.type === 'text').map(e => e.text).join(''), /here I am/);

  await H.api(null, 'POST', '/api/harness/doca/config', { firstTokenTimeoutMs: 90000 });
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

test('every turn carries the standing rules and the memory rules', async () => {
  script = [{ text: 'ok' }];
  await stream('/api/harness/chat', { message: 'hello' });

  const system = seen[0].messages[0].content;
  // In this order: the panel's rules first, then the user's own prompt, then the
  // facts. The charter is not in prefs, so no saved parameter can drop it.
  assert.ok(system.indexOf('# Standing rules') === 0, 'the charter opens the prompt');
  assert.ok(system.indexOf('# Standing rules') < system.indexOf('# Environment'));
  assert.match(system, /Settings belong to the user/);
  assert.match(system, /# How you keep your memory/);
  assert.match(system, /- machine: Hardware, OS, GPUs/, 'the memory categories are in context');
  assert.match(system, /Never store a secret, key, token or password/);
});

test('a settings change the agent wants travels as its own event and writes nothing', async () => {
  script = [
    { tool: 'settings_propose', args: {
      reason: 'the snapshot directory does not exist yet',
      changes: [{ path: 'snapshotSettings.dir', value: '/srv/snapshots' }],
    } },
    { text: 'I have suggested moving the snapshot directory.' },
  ];

  const events = await stream('/api/harness/chat', { message: 'snapshots keep failing' });

  // The console needs this as a card with buttons, not as one more line of tool
  // output, so it is emitted separately from the tool result.
  const proposal = events.find(e => e.type === 'proposal');
  assert.ok(proposal, 'no proposal event was emitted');
  assert.equal(proposal.proposal.changes[0].path, 'snapshotSettings.dir');
  assert.equal(proposal.proposal.status, 'pending');
  assert.match(events.find(e => e.type === 'tool_result').result, /waiting for the user/);

  // Still nothing written, and the next turn is told it is waiting.
  assert.equal(require('../modules/utils').loadPrefs().snapshotSettings?.dir, undefined);

  script = [{ text: 'still waiting' }];
  seen.length = 0;
  await stream('/api/harness/chat', { message: 'and now?' });
  assert.match(seen[0].messages[0].content, /WAITING on the user: snapshotSettings\.dir/);

  await H.api(null, 'POST', `/api/harness/proposals/${proposal.proposal.id}/reject`, { reason: 'not now' });
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

/**
 * The provider's rule, asserted on what we actually sent: a `tool` message is
 * only legal after an assistant message carrying the call it answers, and a call
 * has to be answered. DeepSeek refuses the whole request otherwise — and since
 * the fold boundary is persisted, one bad cut used to break every later turn in
 * that conversation rather than one.
 */
function assertPairedMessages(messages) {
  let open = new Set();
  for (const m of messages) {
    if (m.role === 'tool') {
      assert.ok(open.has(m.tool_call_id),
        `tool result ${m.tool_call_id} has no call in front of it: ${messages.map(x => x.role).join(',')}`);
      open.delete(m.tool_call_id);
      continue;
    }
    assert.equal(open.size, 0, `call(s) ${[...open]} went out without a result`);
    open = new Set((m.tool_calls || []).map(c => c.id || c.function?.name));
  }
  assert.equal(open.size, 0, `call(s) ${[...open]} went out without a result`);
}

test('a fold boundary never lands between a call and its result', () => {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('tool pairs');
  // Six rows, two results in the middle: the older half is three rows, so the
  // boundary computed by counting alone lands on the second result.
  for (const r of [
    { role: 'user', content: 'look at the disk' },
    { role: 'assistant', content: '', tool_calls: [
      { id: 'c1', function: { name: 'shell', arguments: '{}' } },
      { id: 'c2', function: { name: 'shell', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'c1', name: 'shell', content: 'df output' },
    { role: 'tool', tool_call_id: 'c2', name: 'shell', content: 'du output' },
    { role: 'assistant', content: 'Plenty of room.' },
    { role: 'user', content: 'thanks' },
  ]) memory.append(s.id, r);

  const rows = memory.messages(s.id);
  assert.equal(rows[3].role, 'tool', 'the naive halfway row is a result — the case this is about');

  // The message-count path halves the live rows; the token-pressure path folds
  // to the turn start, which is a user row by construction.
  const pending = memory.pendingFold(s.id, 2);
  assert.notEqual(rows[pending.through].role, 'tool', 'the boundary moved off the result');
  assert.equal(pending.through, 4, 'forward, so the whole group folds together');

  memory.updateSession(s.id, { summarizedThrough: pending.through, summary: 'checked the disk' });
  assertPairedMessages(require('../modules/harness/agent').toApiMessages(memory.window(s.id, 0).rows));
});

test('token pressure mid-turn summarises earlier turns only, and never the work in progress', () => {
  const memory = require('../modules/harness/memory');
  const call = (id, n) => [
    { role: 'assistant', content: '', tool_calls: [{ id, function: { name: 'shell', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: id, name: 'shell', content: `output ${n}` },
  ];

  // One long turn and nothing before it: nothing may fold, and no model call is made.
  const alone = memory.createSession('one long turn');
  memory.append(alone.id, { role: 'user', content: 'render the watch' });
  for (let i = 0; i < 12; i++) for (const r of call(`a${i}`, i)) memory.append(alone.id, r);
  assert.equal(memory.pendingFold(alone.id, 0, { force: true }), null,
    'folding half of the turn in progress lost the code the agent was iterating on, then did it again next step');

  // Earlier turns exist: those fold, up to exactly where this turn starts.
  const s = memory.createSession('history then a long turn');
  for (const r of [
    { role: 'user', content: 'what is on the disk' }, ...call('b1', 1), { role: 'assistant', content: 'plenty' },
    { role: 'user', content: 'and memory' }, ...call('b2', 2), { role: 'assistant', content: 'fine' },
  ]) memory.append(s.id, r);
  const turnStart = memory.messages(s.id).length;
  memory.append(s.id, { role: 'user', content: 'now render the watch' });
  for (let i = 0; i < 12; i++) for (const r of call(`c${i}`, i)) memory.append(s.id, r);

  const pending = memory.pendingFold(s.id, 0, { force: true });
  assert.equal(pending.through, turnStart, 'everything before this turn, nothing of it');
  memory.updateSession(s.id, { summarizedThrough: pending.through, summary: 'checked disk and memory' });
  assert.equal(memory.pendingFold(s.id, 0, { force: true }), null,
    'once earlier turns are folded, the next step under pressure has nothing to fold — no repeat');
});

test('the history cap never drops the request of the turn in progress', () => {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('cap vs a long turn');
  memory.append(s.id, { role: 'user', content: 'an old question' });
  memory.append(s.id, { role: 'assistant', content: 'an old answer' });
  memory.append(s.id, { role: 'user', content: 'render the watch' });
  for (let i = 0; i < 15; i++) {
    memory.append(s.id, { role: 'assistant', content: '', tool_calls: [{ id: `d${i}`, function: { name: 'shell', arguments: '{}' } }] });
    memory.append(s.id, { role: 'tool', tool_call_id: `d${i}`, name: 'shell', content: 'ok' });
  }
  const { rows } = memory.window(s.id, 24);
  assert.equal(rows[0].content, 'render the watch', 'a 30-row turn under a 24-row cap still starts with its request');
  assert.equal(rows.length, 31);
  assert.ok(!rows.some(r => r.content === 'an old question'), 'older turns are still capped');
  assertPairedMessages(require('../modules/harness/agent').toApiMessages(rows));
});

test('the history cap does not cut a pair either, and repairs a boundary that did', () => {
  const memory = require('../modules/harness/memory');
  const agent = require('../modules/harness/agent');
  const s = memory.createSession('capped');
  for (const r of [
    { role: 'user', content: 'run it' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'shell', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', name: 'shell', content: 'output' },
    { role: 'assistant', content: 'Ran it.' },
  ]) memory.append(s.id, r);

  // A cap of two would start the window on the result.
  const capped = memory.window(s.id, 2);
  assert.equal(capped.rows[0].role !== 'tool', true);
  assertPairedMessages(agent.toApiMessages(capped.rows));

  // And the state a session was left in before there was a rule: a stored
  // boundary pointing straight at a result. It has to recover on its own — the
  // turn fails before the next fold could move it.
  memory.updateSession(s.id, { summarizedThrough: 2 });
  assertPairedMessages(agent.toApiMessages(memory.window(s.id, 0).rows));
});

test('half a tool pair is never sent, in either direction', () => {
  const { toApiMessages } = require('../modules/harness/agent');
  const out = toApiMessages([
    { role: 'tool', tool_call_id: 'folded', name: 'shell', content: 'a result whose call is gone' },
    { role: 'user', content: 'hello' },
    // Stopped between the call and the result: nothing said, nothing answered.
    { role: 'assistant', content: '', tool_calls: [{ id: 'unanswered', function: { name: 'shell', arguments: '{}' } }] },
    // Same, but it said something first, so the words survive as plain text.
    { role: 'assistant', content: 'Let me look.', tool_calls: [{ id: 'also-unanswered', function: { name: 'shell', arguments: '{}' } }] },
    // A provider that sends no call id: the result was filed under the name.
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'read_file', name: 'read_file', content: 'file contents' },
  ]);

  assertPairedMessages(out);
  assert.deepEqual(out.map(m => m.role), ['user', 'assistant', 'assistant', 'tool']);
  assert.equal(out[1].content, 'Let me look.');
  assert.equal(out[1].tool_calls, undefined, 'a call nobody answered does not travel');
  assert.equal(out[2].tool_calls.length, 1, 'the id-less pair is intact');
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

test('the floating chat panel forwards tool calls as structured events', async () => {
  script = [
    { tool: 'memory_read', args: { key: 'owner' } },
    { text: 'Done.' },
  ];
  // Seed a memory entry so the tool succeeds without depending on prior turns.
  await H.api(null, 'POST', '/api/harness/memory', { key: 'owner', value: 'Al' });
  const events = await stream('/api/chat', { message: 'who owns this?' });
  const call = events.find(e => e.type === 'tool_call');
  assert.ok(call, `expected tool_call in ${events.map(e => e.type)}`);
  assert.equal(call.name, 'memory_read');
  assert.equal(call.args.key, 'owner');
  assert.ok(events.find(e => e.type === 'tool_result'));
  assert.match(events.filter(e => e.type === 'text').map(e => e.text).join(''), /Done/);
});

/* ── Token ledger ─────────────────────────────────────── */

test('every model call is kept in the usage ledger, measured or estimated, and can be summed', async () => {
  const usage = require('../modules/harness/usage');
  const before = usage.summary({ days: 1, by: 'kind' });
  const count = kind => (before.rows.find(r => r.key === kind)?.calls || 0);

  script = [{ tool: 'memory_search', args: { query: 'x' } }, { text: 'nothing there' }];
  await stream('/api/harness/chat', { message: 'count me' });

  const after = usage.summary({ days: 1, by: 'kind' });
  const step = after.rows.find(r => r.key === 'step');
  assert.equal(step.calls, count('step') + 2, 'one row per step, the tool step and the answer');
  assert.ok(after.total.prompt > before.total.prompt, 'the stub sends no usage frame, so the prompt is estimated');
  assert.ok(step.estimated >= 2, 'and says so');

  const byModel = (await get('/api/harness/usage?days=1&by=model')).body;
  assert.ok(byModel.rows.some(r => r.key === 'stub/stub-model'));
  assert.equal((await get('/api/harness/usage?by=nonsense')).status, 400);
});

test('a mission\'s event log lives in the data dir, not wherever the process was started', () => {
  const src = fs.readFileSync(require.resolve('../modules/agents/missions.js'), 'utf8');
  assert.match(src, /store\.dir\('agents'\)/, 'appendJsonl takes a real path; a store name resolved against cwd');
});

/* ── Pictures in the chat ─────────────────────────────── */

// 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');

test('show_image puts a picture in the chat, keeps it with the transcript, and never shows the model', async () => {
  const src = require('path').join(H.tmp, 'render.png');
  fs.writeFileSync(src, PNG);
  const { session } = (await H.api(null, 'POST', '/api/harness/sessions', {})).body;
  script = [
    { tool: 'show_image', args: { path: src, caption: 'the bracket, front view' } },
    { text: 'There it is.' },
  ];
  const events = await stream('/api/harness/chat', { message: 'show me', sessionId: session.id });

  const types = events.map(e => e.type);
  const image = events.find(e => e.type === 'image');
  assert.ok(image, `expected an image event in ${types}`);
  assert.ok(types.indexOf('image') < types.indexOf('tool_result'),
    'the picture comes before the Result fold, live and on reload alike');
  assert.equal(image.image.mime, 'image/png');
  assert.equal(image.image.caption, 'the bracket, front view');

  // A copy, so changing the file later cannot change what was shown.
  fs.writeFileSync(src, Buffer.from('changed'));
  const served = await H.api(null, 'GET', `/api/attachments/${encodeURIComponent(image.image.name)}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(served.body, PNG);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /sandbox/, 'an SVG opened in its own tab must not run');

  const t = await get(`/api/harness/sessions/${session.id}`);
  const row = t.body.messages.find(m => m.role === 'tool' && m.name === 'show_image');
  assert.equal(row.images[0].name, image.image.name, 'a reloaded transcript draws it again');

  // The model reads the result line and nothing else about the picture.
  const toolMsg = seen[1].messages.find(m => m.role === 'tool');
  assert.equal(toolMsg.images, undefined);
  assert.match(toolMsg.content, /Shown in the chat/);
});

test('show_image refuses what a chat cannot draw, and says how to fix it', async () => {
  const tools = require('../modules/harness/tools');
  const bmp = require('path').join(H.tmp, 'old.bmp');
  fs.writeFileSync(bmp, Buffer.from('BM'));
  let shown = 0;
  const out = await tools.call('show_image', { path: bmp }, [], { show: () => shown++ });
  assert.match(out, /^Error: .*not a picture a chat can draw.*magick/);
  assert.equal(shown, 0);
});

test('the floating chat draws the picture too, and keeps it for the next page load', async () => {
  const src = require('path').join(H.tmp, 'chart.webp');
  fs.writeFileSync(src, PNG);   // the bytes do not matter to the route, the extension does
  script = [{ tool: 'show_image', args: { path: src } }, { text: 'Done.' }];
  const events = await stream('/api/chat', { message: 'chart?' });
  const image = events.find(e => e.type === 'image');
  assert.ok(image, `expected an image event in ${events.map(e => e.type)}`);
  assert.equal(image.image.mime, 'image/webp');
  const last = (await get('/api/chat/history')).body.messages.at(-1);
  assert.equal(last.images[0].name, image.image.name);
});

test('a device fetches pictures with its token, and only pictures', async () => {
  const attachments = require('../modules/attachments');
  const pic  = attachments.save(PNG, 'shot.png');
  const text = attachments.save(Buffer.from('secret'), 'notes.txt');
  const phone  = H.mkDevice('img-phone', 'phone', H.PHONE_CAPS);
  const viewer = H.mkDevice('img-viewer', 'viewer');

  const ok = await H.api(phone.token, 'GET', `/api/v1/harness/images/${pic.name}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, PNG);
  assert.equal((await H.api(phone.token, 'GET', `/api/v1/harness/images/${text.name}`)).status, 404,
    'harness:chat must not become a way to read every attachment');
  assert.equal((await H.api(viewer.token, 'GET', `/api/v1/harness/images/${pic.name}`)).status, 403);
  assert.equal((await H.api(null, 'GET', `/api/v1/harness/images/${pic.name}`)).status, 401);
});

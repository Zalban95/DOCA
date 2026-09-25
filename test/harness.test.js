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
/** Queued replies, consumed in order. Each is { text }, { tool }, { json } or { think }. */
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

      // A refusal, for the paths that have to tell "the provider said no" from
      // "the model answered no".
      if (next.status) {
        res.writeHead(next.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: next.says || 'nope' } }));
      }

      // A non-streaming request (the summariser, the tool probe) always gets a
      // plain completion — and `call` is how one answers with a tool call
      // instead of text, which is the whole thing the probe is asking about.
      if (body.stream === false || next.json) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const message = {
          role: 'assistant',
          content: next.call ? '' : (next.text ?? next.json ?? 'ok'),
        };
        // A thinking model returns its chain of thought beside the answer, at
        // the same level, on both transports.
        if (next.think) message.reasoning_content = next.think;
        if (next.call) {
          message.tool_calls = [{
            id: 'call_1', type: 'function',
            function: { name: next.call, arguments: JSON.stringify(next.args || { word: 'ok' }) },
          }];
        }
        return res.end(JSON.stringify({
          choices: [{ message }],
          usage: { prompt_tokens: 42, completion_tokens: 6 },
        }));
      }
      if (next.tool) {
        return sse(res, [{ choices: [{ delta: { tool_calls: [{
          index: 0, id: 'call_1', type: 'function',
          function: { name: next.tool, arguments: JSON.stringify(next.args || {}) },
        }] } }] }]);
      }
      if (next.gate) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: next.think } }] })}\n\n`);
        next.gate.then(() => {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: next.text } }] })}\n\n`);
          res.end('data: [DONE]\n\n');
        });
        return;
      }
      // Split the text so the streaming accumulator is exercised, not bypassed.
      const mid = Math.ceil((next.text || '').length / 2);
      const tmid = Math.ceil((next.think || '').length / 2);
      return sse(res, [
        // The reasoning arrives first and in its own field, which is what
        // DeepSeek's thinking mode does — never as content.
        ...(next.think ? [
          { choices: [{ delta: { reasoning_content: next.think.slice(0, tmid) } }] },
          { choices: [{ delta: { reasoning_content: next.think.slice(tmid) } }] },
        ] : []),
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

test('a real specialist turn sends the narrowed prompt on every model request', async t => {
  const agent = require('../modules/harness/agent');
  const providers = require('../modules/harness/providers');
  const memory = require('../modules/harness/memory');
  const profile = { id: 'audit-specialist', label: 'Audit specialist',
    systemPrompt: 'Find the requested memory.', tools: ['memory_search'],
    memory: false, environment: 'minimal' };
  script = [{ tool: 'memory_search', args: { query: 'hello' } }, { text: 'Finished.' }];
  const session = memory.createSession('specialist wire regression');
  t.after(() => memory.deleteSession(session.id));
  await agent.turn({ message: 'hello', profile, sessionId: session.id });
  assert.equal(seen.length, 2, 'exercise prompt construction again after a tool result');
  const full = agent.preview({ message: 'hello' });
  for (const request of seen) {
    const prompt = request.messages[0].content;
    assert.ok(prompt.startsWith(providers.SAFETY_CHARTER));
    assert.ok(prompt.includes(profile.systemPrompt));
    assert.ok(prompt.includes('working on one errand'));
    assert.ok(prompt.includes('# Where you are'));
    assert.ok(!prompt.includes('# How you keep your memory'));
    assert.ok(prompt.length < full.length);
    assert.deepEqual(request.tools.map(t => t.function.name).sort(),
      ['memory_search', 'mission_plan', 'work_chats', 'work_plan']);
  }
});

/** POST to an SSE endpoint and collect the parsed `data:` events. */
async function stream(path, body) {
  const res = await fetch(H.base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  return text.split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter(Boolean);
}

const get = (p) => H.api(null, 'GET', p);

test('direct specialist interaction keeps its saved profile and reports the intervention and outcome upward', async () => {
  const memory = require('../modules/harness/memory');
  const org = require('../modules/harness/organization');
  const work = org.create({ title: 'Leader' });
  const s = memory.createSession('Focused specialist', { activate: false, kind: 'specialist', parentId: work.id,
    profile: { id: 'focused', label: 'Focused', systemPrompt: 'Only check memory.', tools: ['memory_search'], memory: false } });
  script = [{ tool: 'work_chats', args: { action: 'create', title: 'Forbidden leader' } }, { text: 'Reported without delegating.' }];
  await stream('/api/harness/chat', { message: 'Owner intervention', sessionId: s.id });
  assert.match(seen[0].messages[0].content, /Only check memory/);
  assert.ok(!seen[0].tools.some(t => ['shell', 'agent_dispatch', 'settings_propose'].includes(t.function.name)));
  assert.match(memory.messages(s.id).find(m => m.role === 'tool').content, /Only the Orchestrator/);
  for (const id of [work.id, memory.mainSession().id]) {
    assert.ok(org.notices(id).some(n => n.from === s.id && n.type === 'user intervention'));
    assert.ok(org.notices(id).some(n => n.from === s.id && n.type === 'turn completed'));
  }
});

test('shared turn lock covers background, browser and device calls, and protects running archives', async () => {
  const agent = require('../modules/harness/agent');
  const org = require('../modules/harness/organization');
  const s = org.create({ title: 'Busy work' });
  script = [{ stall: 'sse' }];
  const pending = agent.turn({ message: 'Wait for the stub', sessionId: s.id });
  const rejected = assert.rejects(pending, e => e.name === 'AbortError');
  const deadline = Date.now() + 3000;
  while (!seen.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.ok(seen.length);
  await assert.rejects(agent.turn({ message: 'Collision', sessionId: s.id }), /already running/);
  const phone = H.mkDevice('org-lock-phone', 'phone', H.PHONE_CAPS);
  assert.equal((await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: 'Collision', sessionId: s.id })).status, 409);
  assert.throws(() => org.archive(s.id), /running specialists/);
  assert.equal(agent.cancel(s.id), true);
  await rejected;
  assert.equal(agent.isRunning(s.id), false);
  assert.equal(org.session(s.id).state, 'cancelled');
});

test('Orchestrator uses a smaller tool context and failed requests do not consume upward reports', async () => {
  const agent = require('../modules/harness/agent');
  const memory = require('../modules/harness/memory');
  const org = require('../modules/harness/organization');
  const main = memory.mainSession(), work = org.create({ title: 'Report source' });
  const note = org.report(work.id, 'report', 'Decision needed');
  script = [{ status: 500 }];
  await assert.rejects(agent.turn({ message: 'Check status', sessionId: main.id }));
  assert.ok(org.notices(main.id).some(n => n.id === note.id));
  script = [{ text: 'Decision acknowledged.' }];
  seen = [];
  await agent.turn({ message: 'Check status', sessionId: main.id });
  const request = seen[0];
  assert.ok(request.tools.length <= 20);
  assert.ok(!request.tools.some(t => ['shell', 'agent_dispatch'].includes(t.function.name)));
  assert.ok(request.tools.some(t => t.function.name === 'work_chats'));
  assert.match(request.messages.at(-1).content, /Decision needed/);
  assert.doesNotMatch(request.messages[0].content, /Decision needed/);
  assert.ok(!org.notices(main.id).some(n => n.id === note.id));
  assert.equal(agent.breakdown({ sessionId: main.id }).tools.count, request.tools.length);
});

test('floating chat keeps a persistent Orchestrator independent of Harness selection', async t => {
  const memory = require('../modules/harness/memory');
  const store = require('../modules/store');
  const previous = store.readJson('harness/sessions', { sessions: [], active: null });
  t.after(() => store.writeJson('harness/sessions', previous));
  const main = memory.mainSession();
  const work = memory.createSession('Separate work');
  script = [{ text: 'Main answer' }, { text: 'Work answer' }];
  await stream('/api/chat', { message: 'Owner request' });
  assert.equal(memory.listSessions().active, work.id);
  assert.ok(memory.messages(main.id).some(m => m.content === 'Owner request'));
  assert.equal(memory.messages(work.id).length, 0);
  await stream('/api/harness/chat', { message: 'Work request', sessionId: work.id });
  const history = await get('/api/chat/history');
  assert.ok(history.body.messages.some(m => m.content === 'Main answer'));
  assert.ok(!history.body.messages.some(m => m.content === 'Work answer'));
  await H.api(null, 'POST', '/api/chat/clear', {});
  assert.notEqual(memory.mainSession().id, main.id);
  assert.ok(memory.getSession(main.id).archivedAt);
  assert.ok(memory.messages(main.id).length, 'clear retains an archived transcript');
});

test('mission completion reaches the originating conversation once, after a successful model request', async t => {
  const agent = require('../modules/harness/agent');
  const registry = require('../modules/agents/registry');
  const missions = require('../modules/agents/missions');
  const memory = require('../modules/harness/memory');
  const store = require('../modules/store');
  const previous = store.readJson('agents/missions', { missions: [] });
  const enabled = registry.enabled();
  const session = memory.createSession('completion notices');
  t.after(() => {
    store.writeJson('agents/missions', previous);
    registry.setEnabled(enabled);
    memory.deleteSession(session.id);
  });
  registry.setEnabled(true);
  const done = { id: 'msn_notice', label: 'Archivist', state: 'done', task: 'look it up',
    by: session.id, endedAt: '2026-09-20T12:00:00.000Z', result: 'Result stays behind agent_results.' };
  store.writeJson('agents/missions', { missions: [done, { ...done, id: 'msn_other', by: 'other-session' }] });
  const turn = () => agent.turn({ message: 'An unrelated question', sessionId: session.id });

  script = [{ status: 500 }];
  await assert.rejects(turn());
  assert.equal(missions.get(done.id).announcedToAgentAt, undefined, 'failed delivery does not consume the notice');

  script = [{ text: 'The mission finished.' }];
  seen = [];
  await turn();
  assert.doesNotMatch(seen[0].messages[0].content, /msn_notice/, 'mission state is kept out of the cached prefix');
  assert.match(seen[0].messages.at(-1).content, /msn_notice.*NEW done/);
  assert.doesNotMatch(seen[0].messages.at(-1).content, /msn_other|Result stays behind/);
  assert.ok(missions.get(done.id).announcedToAgentAt);
  assert.equal(missions.get('msn_other').announcedToAgentAt, undefined);

  script = [{ text: 'Another answer.' }];
  seen = [];
  await turn();
  assert.doesNotMatch(seen[0].messages.at(-1).content, /msn_notice/);
});

test('the Orchestrator is told about missions, and a specialist mid-errand is not', async t => {
  // The level that dispatches was the one level never told a mission existed.
  // `profileFor` synthesises an Orchestrator profile, and the mission block was
  // gated on *having* a profile — a test written to exempt a narrow errand that
  // caught the wrong end. The README promises the opposite in two places:
  // finished missions reach the originating conversation's next request, and an
  // older mission with no conversation recorded can notify the next Orchestrator
  // conversation (`missions.notices` admits `!m.by` for exactly that case).
  const agent = require('../modules/harness/agent');
  const registry = require('../modules/agents/registry');
  const missions = require('../modules/agents/missions');
  const memory = require('../modules/harness/memory');
  const store = require('../modules/store');
  const previous = store.readJson('agents/missions', { missions: [] });
  const enabled = registry.enabled();
  t.after(() => { store.writeJson('agents/missions', previous); registry.setEnabled(enabled); });
  registry.setEnabled(true);

  // An orchestrator-kind conversation of its own, rather than the shared main
  // one: the predicate turns on `kind`, and this keeps the suite's main
  // transcript out of it. `mainSession()` resolves by `doc.main`, so a second
  // orchestrator row cannot hijack it.
  const orch = memory.createSession('Orchestrator under test', { activate: false, kind: 'orchestrator' });
  const leader = memory.createSession('Leader under test', { activate: false, kind: 'work' });
  const spec = memory.createSession('Specialist under test', { activate: false, kind: 'specialist',
    parentId: leader.id, profile: { id: 'check', label: 'Check', tools: ['memory_search'], memory: false } });
  t.after(() => [orch, leader, spec].forEach(s => memory.deleteSession(s.id)));

  const done = { id: 'msn_orch', label: 'Archivist', state: 'done', task: 'look it up', by: orch.id,
    endedAt: '2026-09-20T12:00:00.000Z', result: 'Result stays behind agent_results.' };
  // Paused, and with no `by`: the running/paused half of the block is global, so
  // this is exactly what a specialist would be shown if the gate were removed.
  const paused = { id: 'msn_paused', label: 'Restart victim', state: 'paused', task: 'half done',
    steps: 3, tokens: 100 };
  store.writeJson('agents/missions', { missions: [done, paused] });

  script = [{ text: 'The mission finished.' }];
  seen = [];
  await agent.turn({ message: 'An unrelated question', sessionId: orch.id });
  const sent = seen[0].messages.map(m => m.content).join('\n');
  assert.match(sent, /msn_orch.*NEW done/, 'the Orchestrator is told a mission it dispatched finished');
  assert.match(sent, /msn_paused.*PAUSED/, 'and about one a restart cut off, since it is the one asked to resume it');
  assert.doesNotMatch(seen[0].messages[0].content, /msn_orch|msn_paused/,
    'but not in the cached prefix — the block stays in the after-history readings (ISSUES.md H-9)');
  assert.ok(missions.get(done.id).announcedToAgentAt, 'and it is consumed once delivered');

  // The half of the gate that is deliberate, pinned so the next person to read
  // this does not delete it along with the fix: a specialist is inside one
  // errand and is told none of this, even though the block is non-empty.
  script = [{ text: 'Working on it.' }];
  seen = [];
  await agent.turn({ message: 'do the errand', sessionId: spec.id });
  assert.doesNotMatch(seen[0].messages.map(m => m.content).join('\n'), /# Missions/,
    'a specialist is not shown the mission board');
});

test('the panel measures the mission block it is now sent', async t => {
  // `breakdown()` is what the environment view draws, and it measured no mission
  // section in either branch — so the moment the block started being sent, the
  // panel's accounting would have under-reported the prompt by its size.
  const agent = require('../modules/harness/agent');
  const registry = require('../modules/agents/registry');
  const memory = require('../modules/harness/memory');
  const store = require('../modules/store');
  const previous = store.readJson('agents/missions', { missions: [] });
  const enabled = registry.enabled();
  t.after(() => { store.writeJson('agents/missions', previous); registry.setEnabled(enabled); });
  registry.setEnabled(true);

  const orch = memory.createSession('Breakdown orchestrator', { activate: false, kind: 'orchestrator' });
  const leader = memory.createSession('Breakdown leader', { activate: false, kind: 'work' });
  const spec = memory.createSession('Breakdown specialist', { activate: false, kind: 'specialist',
    parentId: leader.id, profile: { id: 'check', label: 'Check', tools: ['memory_search'], memory: false } });
  t.after(() => [orch, leader, spec].forEach(s => memory.deleteSession(s.id)));
  store.writeJson('agents/missions', { missions: [{ id: 'msn_measured', label: 'Archivist', state: 'paused',
    task: 'half done', steps: 3, tokens: 100 }] });

  const section = id => agent.breakdown({ sessionId: id }).sections.find(s => s.name === 'missions');
  assert.ok(section(orch.id), 'the Orchestrator\'s reading counts the mission block');
  assert.ok(section(orch.id).tokens > 0);
  assert.ok(section(leader.id), 'and so does a work leader\'s');
  assert.equal(section(spec.id), undefined, 'a specialist is sent none, so none is measured');

  // And the panel view of the same thing, since its whole purpose is showing the
  // user what the agent was told rather than what somebody believes it was told.
  const readings = async id => (await H.api(null, 'GET', `/api/harness/environment?sessionId=${id}`)).body.readings;
  assert.match(await readings(orch.id), /# Missions.*msn_measured/s, 'the panel shows the Orchestrator the mission block');
  assert.doesNotMatch(await readings(spec.id), /# Missions/, 'and shows a specialist none of it');
});

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
  await H.api(null, 'POST', '/api/harness/sessions', {});
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

  // The result is fed back ahead of the trailing readings block, which is the
  // last thing in the request and is not part of the transcript (H-9). What the
  // ordering is for: everything above that block — the system prompt and every
  // history row — stays byte-identical from step to step, so the provider's
  // prefix cache grows instead of stopping at a per-step line.
  // `user`, not a second `system`: a chat template may refuse a system message
  // that is not the first one, and Qwen's does — llama.cpp with --jinja answered
  // 500 and every llamacpp-served turn died on its first step. The position is
  // what H-9 needed; the role was never part of it.
  assert.equal(followUp.at(-1).role, 'user');
  assert.match(followUp.at(-1).content, /## Right now/);
  assert.equal(followUp[0].role, 'system');
  assert.equal(/## Right now/.test(followUp[0].content), false,
    'the readings are not in the system prompt');

  const fed = followUp.findLast(m => m.role === 'tool');
  assert.match(fed.content, /Remembered/);

  // The whole exchange is durable, and the entry is in memory.
  const { entries } = (await get('/api/harness/memory')).body;
  const gpu = entries.find(e => e.key === 'gpu');
  assert.equal(gpu.value, 'RTX 4090, 24 GB');
  assert.equal(gpu.source, 'agent');

  const { sessions, active } = (await get('/api/harness/sessions')).body;
  assert.equal(sessions.find(s => s.id === active).title, 'The GPU here is an RTX 4090 with 24 GB.');
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
  // The readings ride at the end as a `user` row of the panel's own, so what is
  // counted here is the conversation: everything but that.
  const asked = seen[0].messages.filter(m => m.role === 'user' && !/panel readings/.test(m.content));
  assert.equal(asked.length, 1);
  assert.match(asked[0].content, /Which GPU/);
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
  // Including a thinking model's reasoning, which arrives in the same shape it
  // streams in and has to be read off the message rather than off a frame.
  const memory = require('../modules/harness/memory');
  script = [{ json: 'Plain completion, no SSE.', think: 'reasoned in one piece' }];
  const events = await stream('/api/harness/chat', { message: 'hi' });
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'Plain completion, no SSE.');
  assert.equal(events.find(e => e.type === 'thinking').text, 'reasoned in one piece');
  assert.equal(events.at(-1).code, 0);

  const row = memory.messages(memory.activeSession().id).at(-1);
  assert.equal(row.content, 'Plain completion, no SSE.');
  assert.equal(row.reasoning.text, 'reasoned in one piece',
    'the non-streaming path drops the field the streaming path keeps');
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

/* ── Can this model call tools? ───────────────────────── */

/**
 * The probe behind the line under each fallback rung.
 *
 * The three verdicts are three different things and the panel shows them
 * differently, so each one is driven here against the same scripted provider
 * the rest of this file uses.
 */
test('a model that calls a tool is a yes, and one request settles it', async () => {
  const toolcheck = require('../modules/harness/toolcheck');
  script = [{ call: 'doca_probe' }];

  const v = await toolcheck.check({ provider: 'stub', model: 'stub-model' });
  assert.equal(v.supported, true);
  assert.deepEqual(v.attempts, ['auto'], 'a tool call on the first ask needs no second ask');
  assert.match(v.detail, /as soon as/);

  // The request really carried a tool: the verdict is about the provider, not
  // about the probe's own optimism.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tools?.[0]?.function?.name, 'doca_probe');
  assert.equal(seen[0].tool_choice, 'auto', 'the first attempt offers the tool rather than requiring it');
  assert.equal(seen[0].stream, false, 'a tool call arrives in the JSON body, so there is nothing to stream');
});

test('a model that answers prose is asked twice before it is called unable to', async () => {
  const toolcheck = require('../modules/harness/toolcheck');
  // A model can say "I would call doca_probe" without calling it, which is not
  // the same as being unable to — so the second attempt requires the call.
  script = [{ text: 'Sure, calling doca_probe with "ok".' }, { text: 'The word is ok.' }];

  const v = await toolcheck.check({ provider: 'stub', model: 'stub-mini' });
  assert.equal(v.supported, false);
  assert.deepEqual(v.attempts, ['auto', 'forced'], 'prose once is not proof; prose twice is');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].tool_choice?.function?.name, 'doca_probe', 'the second ask requires the call');

  // A model that only calls the tool when forced is a yes — with the caveat,
  // because a turn that offers a tool without insisting would get prose.
  script = [{ text: 'I would call it.' }, { call: 'doca_probe' }];
  const forced = await toolcheck.check({ provider: 'stub', model: 'stub-mini' });
  assert.equal(forced.supported, true);
  assert.deepEqual(forced.attempts, ['auto', 'forced']);
  assert.match(forced.detail, /only calls a tool when the call is required/);
});

test('a provider that refuses the call is not a verdict about the model', async () => {
  const toolcheck = require('../modules/harness/toolcheck');
  const usage = require('../modules/harness/usage');

  // A rejected key is the check failing to reach the model, not a fact about
  // it — reporting "cannot call tools" here would slander something never
  // asked, and send the user looking in the wrong place.
  script = [{ status: 401, says: 'invalid api key' }];
  const auth = await toolcheck.check({ provider: 'stub', model: 'stub-model' });
  assert.equal(auth.supported, null);
  assert.match(auth.detail, /key was rejected/);
  assert.deepEqual(auth.attempts, [], 'nothing was asked, so nothing was attempted');

  // A provider that refuses the request *because of* the tools field has
  // answered the question, and said so itself.
  script = [{ status: 400, says: 'this model does not support tools' }];
  const refuses = await toolcheck.check({ provider: 'stub', model: 'stub-model' });
  assert.equal(refuses.supported, false);
  assert.match(refuses.detail, /does not support tools/);

  // The words that matter are the provider's. `budget.explain` writes a
  // sentence of its own around them, and it names the provider — which is how
  // an unrelated refusal from a provider whose id contains "tool" could be
  // mistaken for this one.
  script = [{ status: 400, says: 'unsupported parameter' }];
  const other = await toolcheck.check({ provider: 'stub', model: 'stub-model' });
  assert.equal(other.supported, null, 'a 400 that is not about tools is not a verdict');

  // A refusal of the *second* attempt is the provider declining to be told what
  // to do, not the model declining to call. This is DeepSeek's thinking mode,
  // verbatim, observed live on 2026-09-20: the same model calls a tool happily
  // when one is offered, and `deepseek-v4-pro` was being reported as unable to
  // call tools at all because the retry that settles a prose answer is refused.
  script = [{ text: 'I would call doca_probe.' }, { status: 400, says: 'Thinking mode does not support this tool_choice' }];
  const insisted = await toolcheck.check({ provider: 'stub', model: 'stub-mini' });
  assert.equal(insisted.supported, null, 'a refused insistence says nothing about the model');
  assert.deepEqual(insisted.attempts, ['auto'], 'and the check says only what it managed to ask');
  assert.match(insisted.detail, /answered in prose when the tool was offered/);
  assert.match(insisted.detail, /does not support this tool_choice/, 'in the provider\'s own words');

  // Half a rung is not a question.
  assert.equal((await toolcheck.check({ provider: 'stub' })).supported, null);
  assert.equal((await toolcheck.check({})).supported, null);
  assert.match((await toolcheck.check({ provider: 'stub' })).detail, /nothing to check/);

  // A successful probe is counted, and counted as its own kind: a setting that
  // quietly spends money has to be visible where the money is counted. Only the
  // successes are — a call that was refused never reached a model and never
  // cost anything, so it has no row.
  const counted = () => usage.summary({ days: 1, by: 'kind' }).rows.find(r => r.key === 'probe')?.calls || 0;
  const before = counted();
  script = [{ call: 'doca_probe' }];
  await toolcheck.check({ provider: 'stub', model: 'stub-model' });
  assert.equal(counted(), before + 1);
});

test('the probe is the route the panel calls, and it changes nothing', async () => {
  script = [{ call: 'doca_probe' }];
  const r = await get('/api/harness/tool-check?provider=stub&model=stub-model');
  assert.equal(r.status, 200);
  assert.equal(r.body.supported, true);

  // It is not behind requireBrowser, because it applies no setting — the agent
  // may ask about its own fallback. The route that *saves* the chain still is.
  const src = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  assert.match(src, /app\.get\s*\('\/api\/harness\/tool-check',\s*harness\.handleToolCheck\)/);
  assert.equal(/tool-check'[^)]*requireBrowser/.test(src), false);

  // A rung naming a provider that is not configured is answered, not thrown at.
  script = [];
  const missing = await get('/api/harness/tool-check?provider=ghost&model=x');
  assert.equal(missing.status, 200);
  assert.equal(missing.body.supported, null);
  assert.match(missing.body.detail, /no base URL/);
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

test('show_media refuses what a chat cannot show, and says how to fix it', async () => {
  const tools = require('../modules/harness/tools');
  const bmp = require('path').join(H.tmp, 'old.bmp');
  fs.writeFileSync(bmp, Buffer.from('BM'));
  let shown = 0;
  const out = await tools.call('show_media', { path: bmp }, [], { show: () => shown++ });
  assert.match(out, /^Error: .*not something a chat can show.*ffmpeg/);
  assert.equal(shown, 0);
});

test('show_media plays video and audio, and show_image still works under its old name', async () => {
  const tools = require('../modules/harness/tools');
  const path  = require('path');

  // The bytes do not matter to the route or the tool: the extension decides the
  // type, and the browser decides whether it can play it.
  const clip = path.join(H.tmp, 'render.mp4');
  const note = path.join(H.tmp, 'reply.ogg');
  fs.writeFileSync(clip, Buffer.from('fake mp4'));
  fs.writeFileSync(note, Buffer.from('fake ogg'));

  const shown = [];
  const ctx = { show: m => shown.push(m) };
  assert.match(await tools.call('show_media', { path: clip, caption: 'the turntable' }, [], ctx), /video/);
  assert.match(await tools.call('show_media', { path: note }, [], ctx), /audio/);

  assert.deepEqual(shown.map(m => m.kind), ['video', 'audio'], 'the kind travels, so a client never parses a mime type');
  assert.deepEqual(shown.map(m => m.mime), ['video/mp4', 'audio/ogg']);
  assert.equal(shown[0].caption, 'the turntable');

  // Served with the same headers as a picture, and playable — which is what the
  // Files tab has always done for the same file.
  const served = await H.api(null, 'GET', `/api/attachments/${encodeURIComponent(shown[0].name)}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'video/mp4');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('accept-ranges') || '', /bytes/, 'a player seeks by asking for a byte range');

  // The name it shipped under is an alias, not a second implementation.
  const old = await tools.call('show_image', { path: clip }, [], ctx);
  assert.match(old, /Shown in the chat/);
  assert.equal(shown.at(-1).kind, 'video');
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

test('a device fetches what the chat shows, and nothing else in the folder', async () => {
  const attachments = require('../modules/attachments');
  const pic  = attachments.save(PNG, 'shot.png');
  const plan = attachments.save(Buffer.from('# Plan\n\nstep one\n'), 'shown-plan.md');
  const other = attachments.save(Buffer.from('PK not for a chat'), 'archive.zip');
  const phone  = H.mkDevice('img-phone', 'phone', H.PHONE_CAPS);
  const viewer = H.mkDevice('img-viewer', 'viewer');

  const ok = await H.api(phone.token, 'GET', `/api/v1/harness/images/${pic.name}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, PNG);

  // A plan is a kind the chat shows, so a phone can open the one it was sent.
  // This widened what `harness:chat` reaches — deliberately, and only to the
  // kinds a conversation puts in front of a person.
  assert.equal((await H.api(phone.token, 'GET', `/api/v1/harness/images/${plan.name}`)).status, 200);

  // Everything else in the folder is still not readable through this route.
  assert.equal((await H.api(phone.token, 'GET', `/api/v1/harness/images/${other.name}`)).status, 404,
    'harness:chat must not become a way to read every attachment');
  assert.equal((await H.api(viewer.token, 'GET', `/api/v1/harness/images/${pic.name}`)).status, 403);
  assert.equal((await H.api(null, 'GET', `/api/v1/harness/images/${pic.name}`)).status, 401);
});

test('a tool result is the same string on every step, so the prefix stays cacheable', async () => {
  const agentMod = require('../modules/harness/agent');

  // Rows are appended as a turn runs; `toApiMessages` must not rewrite the ones
  // already sent. It used to: a backward walk kept results whole until 12,000
  // characters were spent and clipped the rest, so a result was verbatim on the
  // step that produced it and a head+tail+path on the next. The message array
  // was not append-only, and the provider's prefix cache stops at the first byte
  // that differs — anchored at the oldest result to change, which sits right
  // after the system prompt, so only the system prompt stayed cacheable
  // (ISSUES.md H-9b). An earlier version of this suite used `ls` and `date`,
  // whose output fits the old budget, and so never exercised it. This does.
  const big = n => 'L'.repeat(n) + '\n' + 'R'.repeat(n);
  const round = (i, len) => ([
    { role: 'assistant', content: null,
      tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'shell', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${i}`, name: 'shell', content: big(len) },
  ]);

  const rows1 = [...round(1, 30000)];
  const seenAtStep1 = agentMod.toApiMessages(rows1, { sessionId: 'stability' })
    .find(m => m.role === 'tool').content;

  // Two more rounds arrive. The first result must be untouched.
  const rows3 = [...round(1, 30000), ...round(2, 30000), ...round(3, 30000)];
  const seenAtStep3 = agentMod.toApiMessages(rows3, { sessionId: 'stability' })
    .filter(m => m.role === 'tool')[0].content;

  assert.equal(seenAtStep3, seenAtStep1,
    'an already-sent tool result was rewritten when later results arrived');

  // A row under the cap passes through whole and is never touched later.
  const small = agentMod.toApiMessages([...round(1, 200)], { sessionId: 'stability' })
    .find(m => m.role === 'tool').content;
  assert.equal(small.length, 401);

  // A result over the cap is clipped — by its own size, not by its neighbours.
  const huge = agentMod.toApiMessages([...round(4, 40000)], { sessionId: 'stability' })
    .find(m => m.role === 'tool').content;
  assert.ok(huge.length < 40000, 'an oversized result is clipped');
  assert.match(huge, /full output: .*read_file to retrieve/);

  // The same row clips to the same string whether or not other rows exist.
  const alone = agentMod.toApiMessages([...round(5, 40000)], { sessionId: 'stability' })
    .find(m => m.role === 'tool').content;
  const withOthers = agentMod.toApiMessages([...round(1, 100), ...round(5, 40000)], { sessionId: 'stability' })
    .filter(m => m.role === 'tool')[1].content;
  assert.equal(alone.length, withOthers.length,
    'clipping depends on the row alone, not on how much else is in the prompt');
});

test('a proposal is filed against the conversation that made it', async () => {
  // settings.propose() and installs.propose() have always taken a sessionId and
  // stored it; nothing ever passed one, so every proposal was anonymous. With
  // one conversation open that is invisible; with several, the pending list
  // cannot be read against the transcript it came from.
  const made = await H.api(null, 'POST', '/api/harness/sessions', { title: 'proposal-origin' });
  const sessionId = made.body.session.id;

  script = [
    { tool: 'settings_propose', args: {
        reason: 'the window is bigger than this',
        changes: [{ path: 'harness.config.doca.contextWindow', value: 200000 }],
    } },
    { text: 'Proposed.' },
  ];
  await stream('/api/harness/chat', { message: 'bump the window', sessionId });

  const props = (await get('/api/harness/proposals')).body;
  const mine = props.pending.find(p => p.sessionId === sessionId);
  assert.ok(mine, 'the proposal does not name the session it came from');
  assert.equal(mine.status, 'pending');

  // And an installer proposal is filed the same way.
  script = [
    { tool: 'install_propose', args: { kind: 'ollama-model', id: 'qwen3', reason: 'needed for the errand' } },
    { text: 'Proposed.' },
  ];
  await stream('/api/harness/chat', { message: 'get me qwen3', sessionId });

  const installsList = (await get('/api/harness/installs')).body;
  const inst = installsList.pending.find(i => i.sessionId === sessionId);
  assert.ok(inst, 'the install proposal does not name the session it came from');
});

test('a large tool result is spilled in full, not spilled already-truncated', async () => {
  // The bug this pins: `clip()` truncated at 8,000 in tools.js, the row stored
  // the truncated text, and the spill file wrote the row — so the escape hatch
  // contained a copy of the thing it was meant to let you escape. It was worse
  // than useless: 8,000 < TOOL_MAX_CHARS (16,000), so no built-in tool could
  // ever produce a result long enough to trigger the spill at all, and the only
  // time it fired (through read_file) the file it wrote was already clipped.
  const toolsMod = require('../modules/harness/tools');
  const agentMod = require('../modules/harness/agent');
  const fs = require('node:fs');

  // Real command, real output, through the real tool.
  // The shell tool spawns /bin/bash by design — the panel manages a Linux host —
  // so on a Windows development machine every shell call is ENOENT and there is
  // no large result to spill. Skipped rather than failed, and rather than
  // weakening the assertion to whatever this platform can produce.
  if (process.platform === 'win32') return;
  // Not `seq`: node is the one command guaranteed present wherever these run.
  const out = await toolsMod.call('shell', {
    command: 'node -e "for(let i=1;i<=8000;i++)console.log(i)"',
  });
  assert.ok(out.length > 16000,
    `a shell result is still capped below the transcript clip (${out.length} chars)`);

  // And it arrives whole — no "[truncated]" from the tool layer.
  assert.equal(/\[truncated,/.test(out), false, 'the tool layer still truncates before the spill can see it');
  assert.match(out, /8000$/, 'the last line survived');

  // Now the transcript layer: the spill file must hold every character.
  const rows = [
    { role: 'user', content: 'big' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'cbig', type: 'function',
        function: { name: 'shell', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'cbig', name: 'shell', content: out },
  ];
  const msg = agentMod.toApiMessages(rows, { sessionId: 's_spill_full' }).find(m => m.role === 'tool');
  assert.match(msg.content, /full output: .*read_file to retrieve/, 'no spill pointer was offered');
  assert.ok(msg.content.length < out.length, 'the prompt got the head and tail, not the whole thing');

  const path = msg.content.match(/full output: (.+?) —/)[1];
  const spilled = fs.readFileSync(path, 'utf8');
  assert.equal(spilled, out, 'the spill file is not the full text');
  assert.equal(/\[truncated,/.test(spilled), false, 'the spill file holds already-truncated text');
  assert.match(spilled, /8000$/, 'the spill file is missing the end of the output');
});

test('the tool-layer cap stays above the transcript clip', () => {
  // The relationship, not the numbers, is what matters: if the inner cap drops
  // back below the outer one, the spill becomes unreachable again and every
  // large result is silently truncated with no way to get the rest. Pinned
  // because the two live in different files and nothing else connects them.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'harness', 'toolbox', 'common.js'), 'utf8');
  const toolCap = Number(src.match(/const MAX_OUT\s*=\s*(\d+)/)[1]);

  const agentSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'harness', 'turn', 'messages.js'), 'utf8');
  const transcriptCap = Number(agentSrc.match(/const TOOL_MAX_CHARS\s*=\s*(\d+)/)[1]);

  assert.ok(toolCap > transcriptCap,
    `MAX_OUT (${toolCap}) must exceed TOOL_MAX_CHARS (${transcriptCap}), or the spill is unreachable`);
});

/* ── The fallback chain ───────────────────────────────── */

test('an empty chain is inert: one rung, and the full give-up time', () => {
  require('../modules/harness/agent').forgetDegraded();
  const agentMod = require('../modules/harness/agent');
  const providers = require('../modules/harness/providers');
  const ep = providers.endpoint('stub');
  const p = { firstTokenTimeoutMs: 90000, failoverAfterMs: 20000, fallbackChain: [] };

  const rungs = agentMod.rungsFor({ ep, model: 'stub-model', p });
  assert.equal(rungs.length, 1, 'no chain means no second attempt');
  assert.equal(rungs[0].timeoutMs, 90000,
    'the only rung must get the full deadline, or upgrading shortens how long a turn waits');
  assert.equal(rungs[0].last, true);
});

test('a chain gives every rung but the last the shorter deadline', () => {
  require('../modules/harness/agent').forgetDegraded();
  // Reusing the 90 s deadline per rung is the trap: three rungs would wait three
  // minutes before saying anything, which is slower than having no chain.
  const agentMod = require('../modules/harness/agent');
  const providers = require('../modules/harness/providers');
  const ep = providers.endpoint('stub');
  const p = {
    firstTokenTimeoutMs: 90000, failoverAfterMs: 20000,
    fallbackChain: [{ provider: 'stub', model: 'stub-mini' }, { provider: 'ollama', model: 'qwen3' }],
  };

  const rungs = agentMod.rungsFor({ ep, model: 'stub-model', p });
  assert.equal(rungs.length, 3, 'primary plus two');
  assert.deepEqual(rungs.map(r => r.timeoutMs), [20000, 20000, 90000],
    'the last rung must get the full deadline so giving up still takes as long as it always did');
  assert.deepEqual(rungs.map(r => r.last), [false, false, true]);
  assert.deepEqual(rungs.map(r => r.model), ['stub-model', 'stub-mini', 'qwen3']);
});

test('a chain entry naming a provider that is gone is skipped, not fatal', () => {
  require('../modules/harness/agent').forgetDegraded();
  const agentMod = require('../modules/harness/agent');
  const providers = require('../modules/harness/providers');
  const ep = providers.endpoint('stub');
  let threw = false;
  let rungs;
  try {
    rungs = agentMod.rungsFor({ ep, model: 'm', p: {
      firstTokenTimeoutMs: 90000, failoverAfterMs: 20000,
      fallbackChain: [{ provider: 'no-such-provider', model: 'x' }, { provider: 'ollama', model: 'qwen3' }],
    } });
  } catch { threw = true; }

  assert.equal(threw, false, 'a stale entry must not break every turn');
  assert.equal(rungs.length, 2, 'the unknown one is dropped, the rest survive');
  assert.equal(rungs[1].provider, 'ollama');
});

test('the same entry twice is not a chain that waits for itself', () => {
  require('../modules/harness/agent').forgetDegraded();
  const agentMod = require('../modules/harness/agent');
  const providers = require('../modules/harness/providers');
  const ep = providers.endpoint('stub');
  const rungs = agentMod.rungsFor({ ep, model: 'stub-model', p: {
    firstTokenTimeoutMs: 90000, failoverAfterMs: 20000,
    fallbackChain: [{ provider: 'stub', model: 'stub-model' }, { provider: 'stub', model: 'stub-model' }],
  } });
  assert.equal(rungs.length, 1, 'duplicating the primary would just pay the stall twice');
});

test('a rung that stalled goes to the back, but is not written off', () => {
  // "re-probe rather than blacklisting" — a model that came back has to become
  // usable again without a restart, so the degraded one is deprioritised rather
  // than dropped.
  //
  // The marking here used to be a no-op — `agentMod._degradeForTest?.(primary)`,
  // a method that has never existed — so the only thing this test ever asserted
  // was the order of a chain nothing had touched, twice. It rotates the chain
  // now, which is the reason it is here at all, and which is what H-18 needed a
  // working test of.
  const agentMod = require('../modules/harness/agent');
  const providers = require('../modules/harness/providers');
  agentMod.forgetDegraded();

  const ep = providers.endpoint('stub');
  const p = {
    firstTokenTimeoutMs: 90000, failoverAfterMs: 20000,
    fallbackChain: [{ provider: 'ollama', model: 'qwen3' }],
  };
  const order = () => agentMod.rungsFor({ ep, model: 'stub-model', p }).map(r => `${r.provider}/${r.model}`);

  assert.deepEqual(order(), ['stub/stub-model', 'ollama/qwen3'], 'healthy first, in order');

  agentMod.markDegraded(ep, 'stub-model');
  assert.deepEqual(order(), ['ollama/qwen3', 'stub/stub-model'],
    'a rung that stalled a moment ago is tried last, not dropped');
  // "How long ago", not "exactly now": this is a wall-clock delta, and
  // asserting it is 0 made the test fail whenever the millisecond happened to
  // tick over between marking and reading. What it is here to pin is that the
  // field is carried at all and is fresh.
  const stalledMsAgo = agentMod.rungsFor({ ep, model: 'stub-model', p })[1].stalledMsAgo;
  assert.ok(stalledMsAgo >= 0 && stalledMsAgo < 1000,
    `and it carries how long ago it stalled, which is what the report of it is made of (got ${stalledMsAgo})`);

  assert.equal(agentMod.DEGRADED_MS, 5 * 60 * 1000, 'the rest period is minutes, not forever');
  agentMod.forgetDegraded();
  assert.deepEqual(order(), ['stub/stub-model', 'ollama/qwen3'], 'forgetting restores the order');

  // And it comes back on its own, which is the whole reason it is a rest and not
  // a blacklist: "blacklisting would make one bad afternoon permanent". The
  // clock is moved rather than waited out; the map is untouched, so this is the
  // deadline expiring and nothing else.
  agentMod.markDegraded(ep, 'stub-model');
  const realNow = Date.now;
  Date.now = () => realNow() + agentMod.DEGRADED_MS + 1000;
  try {
    assert.deepEqual(order(), ['stub/stub-model', 'ollama/qwen3'], 'the rest period ends without a restart');
  } finally { Date.now = realNow; }
  agentMod.forgetDegraded();
});

test('a turn that will not run on the configured model says which way it was passed over', () => {
  // The decision `complete()` makes before its first request, on its own, so the
  // three answers can be read without a provider in the way.
  const agentMod  = require('../modules/harness/agent');
  const providers = require('../modules/harness/providers');
  const ep = providers.endpoint('stub');
  const rung = (provider, model, extra = {}) => ({
    provider, model, ep: providers.endpoint(provider), last: false, timeoutMs: 0, ...extra,
  });
  const primary = rung('stub', 'stub-model', { stalledMsAgo: 41000 });
  const backup  = rung('ollama', 'qwen3');
  const hop = (candidates, rungs) => agentMod.openingHop({ ep, model: 'stub-model', candidates, rungs });

  assert.equal(hop([primary, backup], [primary, backup]), null,
    'the configured model is answering: there is nothing to announce');

  // A stall in the last few minutes rotated the chain, so the turn starts on the
  // backup without the configured model being asked at all.
  const rotated = hop([backup, primary], [backup, primary]);
  assert.equal(rotated.reason, 'degraded');
  assert.equal(rotated.from.provider, 'stub', 'the model named as not answering is the configured one');
  assert.equal(rotated.from.model, 'stub-model');
  assert.equal(rotated.to.model, 'qwen3');
  assert.equal(rotated.seconds, 41, 'and the report can say how long ago it stalled');
  assert.equal(rotated.remaining, 1);

  // A declared window too small is the other way the lead changes, and it is not
  // a stall: it must not be described as one.
  const skipped = hop([primary, backup], [backup]);
  assert.equal(skipped.reason, 'context');
  assert.equal(skipped.seconds, 0);
  assert.equal(skipped.remaining, 0);

  // Rotated, and then the rung that took the lead could not fit either: the
  // configured model is answering after all. Nothing is announced, because the
  // rule is about who answers rather than about the order — the skip that put it
  // back in front is reported by the preflight's own `onSkip`.
  assert.equal(hop([backup, primary], [primary]), null);
});

test('a stalled model falls through to the next, and says so on screen', async () => {
  // The whole point, end to end against a provider that holds the connection
  // open and never sends a token — which is what `deepseek-flash` did for three
  // minutes on 2026-09-14 while `deepseek-v4-pro` on the same key answered in
  // 430 ms. The unit of failure was the model, so the chain is per model.
  const agentMod = require('../modules/harness/agent');
  const catalog   = require('../modules/harness/catalog');
  agentMod.forgetDegraded();

  // A second provider id, pointing at the same stub server: two keys for one
  // endpoint is exactly the case the chain exists for.
  const savedCfg = fs.readFileSync(CONFIG_PATH, 'utf8');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    models: { providers: {
      stub:  { baseUrl: stubUrl, apiKey: 'test-key', models: ['stub-declared'] },
      stub2: { baseUrl: stubUrl, apiKey: 'test-key-2', models: ['stub-declared'] },
    } },
  }, null, 2));

  const before = catalog.configFor(catalog.BUILTIN_ID);
  await H.api(null, 'POST', '/api/harness/doca/config', {
    provider: 'stub', model: 'stub-model',
    failoverAfterMs: 300,
    firstTokenTimeoutMs: 60000,
    fallbackChain: [{ provider: 'stub2', model: 'stub-mini' }],
  });

  try {
    // First call stalls with keep-alives and no content; second answers.
    script = [{ stall: 'sse' }, { text: 'answered by the second' }];
    seen = [];

    const events = await stream('/api/harness/chat', { message: 'who answers?' });

    // The answer came from the fallback, and the turn is not an error the user
    // has to read: a stall with somewhere to go is a fallback, not a failure.
    assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'answered by the second');
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.at(-1).code, 0);
    assert.equal(events.filter(e => e.type === 'error').length, 0);

    // And it was not quiet about it — a fallback that happens silently is a
    // worse bug than the outage it hides.
    const hop = events.find(e => e.type === 'failover');
    assert.ok(hop, 'the fallback happened without being announced');
    assert.equal(hop.step, 1);
    assert.equal(hop.from, 'stub');
    assert.equal(hop.to, 'stub2');
    assert.equal(hop.toModel, 'stub-mini');
    assert.match(hop.text, /stopped answering after \d+s/);
    assert.match(hop.text, /continuing on/);
    assert.match(hop.text, /keep-alive/, 'how it failed is part of the report');
    assert.equal(hop.remaining, 1, 'the hop names what is left below it');

    // It really did reach the second provider, rather than retrying the first,
    // and it did so exactly once: one pass down the chain, never a retry loop,
    // which would be a way to bill the user twice for the same silence.
    assert.equal(seen.length, 2, 'one attempt per rung, then the answer');
    assert.equal(seen[0].model, 'stub-model');
    assert.equal(seen[1].model, 'stub-mini');
  } finally {
    fs.writeFileSync(CONFIG_PATH, savedCfg);
    await H.api(null, 'POST', '/api/harness/doca/config', {
      provider: before.provider, model: before.model,
      failoverAfterMs: before.failoverAfterMs,
      firstTokenTimeoutMs: before.firstTokenTimeoutMs,
      fallbackChain: before.fallbackChain,
    });
    agentMod.forgetDegraded();
  }
});

test('a turn that starts on the backup, because the configured model stalled a moment ago, says so', async () => {
  // The demotion is what keeps every turn in the next five minutes from paying
  // the same stall again — but it rotates the chain before the lead is compared
  // with anything, so this turn used to arrive with no row in the console, no
  // line in the log, and no `fallbacks` on the outcome that a client which was
  // asleep is the only reader of. The backup's answer then read as the
  // configured model's, which is the failure the announcement exists to prevent.
  const agentMod = require('../modules/harness/agent');
  const catalog  = require('../modules/harness/catalog');
  agentMod.forgetDegraded();

  const savedCfg = fs.readFileSync(CONFIG_PATH, 'utf8');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    models: { providers: {
      stub:  { baseUrl: stubUrl, apiKey: 'test-key', models: ['stub-declared'] },
      stub2: { baseUrl: stubUrl, apiKey: 'test-key-2', models: ['stub-declared'] },
    } },
  }, null, 2));

  const before = catalog.configFor(catalog.BUILTIN_ID);
  await H.api(null, 'POST', '/api/harness/doca/config', {
    provider: 'stub', model: 'stub-model',
    failoverAfterMs: 300,
    firstTokenTimeoutMs: 60000,
    fallbackChain: [{ provider: 'stub2', model: 'stub-mini' }],
  });

  try {
    // One turn to make the configured model stall — which is what marks it
    // degraded — and the backup answers it.
    script = [{ stall: 'sse' }, { text: 'answered by the second' }];
    await stream('/api/harness/chat', { message: 'who answers?' });

    // The next turn, seconds later and well inside DEGRADED_MS. One scripted
    // reply, so whichever model asks for it first is the one that answers.
    script = [{ text: 'answered by the second again' }];
    seen = [];
    const events = await stream('/api/harness/chat', { message: 'and now?' });

    assert.deepEqual(seen.map(r => r.model), ['stub-mini'],
      'the configured model is not asked at all — that is what the demotion is for');

    const hop = events.find(e => e.type === 'failover');
    assert.ok(hop, 'the turn started on another model without saying so');
    assert.equal(hop.step, 1);
    assert.equal(hop.from, 'stub');
    assert.equal(hop.fromModel, 'stub-model', 'the model named as not answering is the configured one');
    assert.equal(hop.to, 'stub2');
    assert.equal(hop.toModel, 'stub-mini');
    assert.match(hop.text, /stopped answering \d+s ago and is being passed over/);
    assert.match(hop.text, /continuing on/);
    assert.equal(hop.frames, 0, 'nothing stalled in this turn, so there are no keep-alive frames to report');
    assert.equal(hop.remaining, 1, 'the configured model is still below it, not written off');
  } finally {
    fs.writeFileSync(CONFIG_PATH, savedCfg);
    await H.api(null, 'POST', '/api/harness/doca/config', {
      provider: before.provider, model: before.model,
      failoverAfterMs: before.failoverAfterMs,
      firstTokenTimeoutMs: before.firstTokenTimeoutMs,
      fallbackChain: before.fallbackChain,
    });
    agentMod.forgetDegraded();
  }
});

/* ── A thinking model's chain of thought ──────────────── */

test('provider thinking streams separately from the answer and is echoed only to its provider', async () => {
  // DeepSeek's thinking mode answers with `reasoning_content` beside `content`,
  // and for any request carrying tools it 400s the whole turn when that field is
  // missing from an earlier assistant message of the same conversation. The
  // panel never read the field, so nothing could put it back and the mission was
  // over — permanently, since every later request in that session was malformed
  // by the same rule (ISSUES.md H-10).
  const memory = require('../modules/harness/memory');
  const made = await H.api(null, 'POST', '/api/harness/sessions', { title: 'thinking' });
  const sessionId = made.body.session.id;

  script = [{ think: 'They asked a question. I should answer it.', text: 'The answer.' }];
  seen = [];
  const events = await stream('/api/harness/chat', { message: 'what is it?', sessionId });

  assert.equal(events.filter(e => e.type === 'thinking').map(e => e.text).join(''),
    'They asked a question. I should answer it.');
  assert.ok(events.findIndex(e => e.type === 'thinking') < events.findIndex(e => e.type === 'text'));
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'The answer.');

  const row = memory.messages(sessionId).find(r => r.role === 'assistant');
  assert.equal(row.content, 'The answer.', 'the answer is stored as the answer');
  assert.equal(row.reasoning.text, 'They asked a question. I should answer it.');
  assert.equal(row.reasoning.provider, 'stub', 'filed under the provider that sent it');

  // The turn after that is the one that used to die: the field goes back.
  script = [{ text: 'Second.' }];
  seen = [];
  await stream('/api/harness/chat', { message: 'again', sessionId });
  const sent = seen.at(-1).messages.find(m => m.content === 'The answer.');
  assert.equal(sent.reasoning_content, 'They asked a question. I should answer it.',
    'the provider that asked for its reasoning back did not get it');
  assert.equal(seen.at(-1).messages.at(-2).reasoning_content, undefined,
    'The second answer had no reasoning of its own');
});

test('both browser chats receive thinking before the provider releases its answer', async () => {
  for (const route of ['/api/harness/chat', '/api/chat']) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    script = [{ think: 'Checking the inputs.', text: 'Finished.', gate }];
    const res = await fetch((await H.start()) + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ message: 'live preview check' }), signal: AbortSignal.timeout(5000),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = '';
    try {
      while (!received.includes('Checking the inputs.')) {
        const { done, value } = await reader.read();
        assert.equal(done, false, route + ' ended before thinking arrived');
        received += decoder.decode(value, { stream: true });
      }
      assert.ok(received.includes('"type":"thinking"'), route);
      assert.equal(received.includes('Finished.'), false, 'the answer is still held at the provider');
    } finally { release(); }
    while (!(await reader.read()).done) { /* finish the turn before the next request */ }
  }
  const history = await H.api(null, 'GET', '/api/chat/history');
  const answer = history.body.messages.at(-1);
  assert.equal(answer.content, 'Finished.');
  assert.equal(answer.working.find(s => s.kind === 'thinking').body, 'Checking the inputs.');
});

test('a hop does not hand one provider\'s reasoning to the next', async () => {
  // The field belongs to the provider that sent it, in both directions. The
  // messages are built for the rung the turn starts on; a stall hands them to a
  // different provider, which never asked for the field and may refuse a body
  // carrying it.
  const agentMod = require('../modules/harness/agent');
  const catalog  = require('../modules/harness/catalog');
  agentMod.forgetDegraded();

  const savedCfg = fs.readFileSync(CONFIG_PATH, 'utf8');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    models: { providers: {
      stub:  { baseUrl: stubUrl, apiKey: 'test-key', models: ['stub-declared'] },
      stub2: { baseUrl: stubUrl, apiKey: 'test-key-2', models: ['stub-declared'] },
    } },
  }, null, 2));

  const before = catalog.configFor(catalog.BUILTIN_ID);
  await H.api(null, 'POST', '/api/harness/doca/config', {
    provider: 'stub', model: 'stub-model',
    failoverAfterMs: 300, firstTokenTimeoutMs: 60000,
    fallbackChain: [{ provider: 'stub2', model: 'stub-mini' }],
  });

  try {
    const made = await H.api(null, 'POST', '/api/harness/sessions', { title: 'hop-thinking' });
    const sessionId = made.body.session.id;

    script = [{ think: 'thinking about the question', text: 'First.' }];
    await stream('/api/harness/chat', { message: 'hello', sessionId });

    script = [{ stall: 'sse' }, { text: 'Second.' }];
    seen = [];
    await stream('/api/harness/chat', { message: 'again', sessionId });

    assert.equal(seen.length, 2, 'one attempt per rung');
    assert.equal(seen[0].messages.find(m => m.content === 'First.').reasoning_content,
      'thinking about the question', 'the provider that asked for it gets it');
    assert.ok(seen[1].messages.some(m => m.content === 'First.'), 'the message itself still travels');
    assert.equal(seen[1].messages.some(m => m.reasoning_content !== undefined), false,
      'a different provider was sent a field it never asked for');
  } finally {
    fs.writeFileSync(CONFIG_PATH, savedCfg);
    await H.api(null, 'POST', '/api/harness/doca/config', {
      provider: before.provider, model: before.model,
      failoverAfterMs: before.failoverAfterMs,
      firstTokenTimeoutMs: before.firstTokenTimeoutMs,
      fallbackChain: before.fallbackChain,
    });
    agentMod.forgetDegraded();
  }
});

test('every request carries exactly one system message, and it is first', async () => {
  // A chat template may refuse a system message that is not the first one, and
  // Qwen's does: llama.cpp with --jinja answers
  // `500 Jinja Exception: System message must be at the beginning`. The readings
  // moved below the history to protect the cached prefix (H-9) and went as a
  // second system message, so from that moment every llamacpp-served turn died
  // on its first step — mission or chat — while providers that tolerate it
  // carried on, which is why it read as a model problem.
  script = [
    { tool: 'memory_search', args: { query: 'anything' } },
    { text: 'Nothing to report.' },
  ];
  await stream('/api/harness/chat', { message: 'look something up' });

  assert.ok(seen.length >= 2, 'a tool step and an answer');
  for (const body of seen) {
    const roles = body.messages.map(m => m.role);
    const systems = roles.filter(r => r === 'system');
    assert.equal(systems.length, 1, `one system message, got ${systems.length}: ${roles.join(', ')}`);
    assert.equal(roles[0], 'system', `the system message is first, got ${roles.join(', ')}`);
  }

  // And the readings are still there, still last, still saying whose they are.
  const last = seen.at(-1).messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content, /panel readings, not from the user/);
  assert.match(last.content, /## Right now/);
});

test('a plan is shown as a document, opened rather than drawn', async () => {
  // A plan pasted into a conversation scrolls away and a plan written to a file
  // is never opened, so it travels the same road as a picture — copied into
  // attachments, kept with the conversation, addressed by name — and differs
  // only in what a client does with it, which is why it is a `kind`.
  const tools = require('../modules/harness/tools');
  const p = require('path').join(H.tmp, 'plan.md');
  fs.writeFileSync(p, '# Plan\n\n1. Measure the shelf\n2. Cut it\n3. Render it\n');

  const shown = [];
  const out = await tools.call('show_media', { path: p, caption: 'Shelf plan' }, [], { show: m => shown.push(m) });
  assert.match(out, /doc/);
  assert.equal(shown[0].kind, 'doc');
  assert.equal(shown[0].mime, 'text/markdown');
  assert.equal(shown[0].caption, 'Shelf plan');

  // Served as text, with the same headers as any other attachment, so the
  // window that opens it reads the file rather than a copy in the transcript.
  const served = await H.api(null, 'GET', `/api/attachments/${encodeURIComponent(shown[0].name)}`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /text\/markdown/);
  assert.match(String(served.body), /Measure the shelf/);

  // And a device is offered it under the same route as the rest of the media.
  const phone = H.mkDevice('plan-phone', 'phone', H.PHONE_CAPS);
  const got = await H.api(phone.token, 'GET', `/api/v1/harness/images/${shown[0].name}`);
  assert.equal(got.status, 200);
});

test('manual approval stops the tool, and the answer decides whether it runs', async () => {
  // The whole point, end to end: the turn is genuinely blocked between the
  // model asking for a tool and the tool running, and it is the click that
  // lets it through. A test that only checked `gate()` would pass with the
  // wiring absent.
  const agent    = require('../modules/harness/agent');
  const approval = require('../modules/harness/approval');
  const memory   = require('../modules/harness/memory');

  approval.setMode('manual');
  approval.settings().always.forEach(approval.forget);
  const session = memory.createSession({ label: 'approval' });

  const run = async decision => {
    script = [{ tool: 'shell', args: { command: 'echo let-me-through' } }, { text: 'done' }];
    const events = [];
    const turn = agent.turn({
      message: 'run it', sessionId: session.id, emit: e => events.push(e),
    });

    const deadline = Date.now() + 5000;
    let asked;
    while (!(asked = events.find(e => e.type === 'approval' && e.state === 'asked')) && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 10));
    assert.ok(asked, 'the turn asked');
    assert.equal(asked.tool, 'shell');
    assert.deepEqual(asked.keys, ['shell:echo'], 'and offered to remember the verb, not the whole tool');
    assert.equal(events.some(e => e.type === 'tool_result'), false,
      'nothing ran while the question was open');

    assert.equal(approval.decide(asked.id, decision), true);
    await turn;
    return events.find(e => e.type === 'tool_result');
  };

  const denied = await run('deny');
  assert.match(denied.result, /Refused by the user/);
  assert.doesNotMatch(denied.result, /let-me-through/, 'the command did not run');

  const allowed = await run('once');
  assert.match(allowed.result, /let-me-through/, 'answering yes ran it');
  assert.deepEqual(approval.settings().always, [], 'and "once" remembered nothing');

  // "Always" is what makes the mode usable: the second identical call is not
  // asked about at all.
  const remembered = await run('always');
  assert.match(remembered.result, /let-me-through/);
  assert.deepEqual(approval.settings().always, ['shell:echo']);

  script = [{ tool: 'shell', args: { command: 'echo let-me-through' } }, { text: 'done' }];
  const quiet = [];
  await agent.turn({ message: 'again', sessionId: session.id, emit: e => quiet.push(e) });
  assert.equal(quiet.some(e => e.type === 'approval'), false, 'not asked a second time');
  assert.match(quiet.find(e => e.type === 'tool_result').result, /let-me-through/);

  approval.forget('shell:echo');
  approval.setMode('auto');
});

test('a turn from a watch is asked on the watch, with full auto as the third choice', async () => {
  // A permission card drawn in a dashboard nobody has open is a turn that
  // blocks for five minutes and gives up. The device that started the turn is
  // where its owner is looking, so the question goes there too.
  const agent    = require('../modules/harness/agent');
  const approval = require('../modules/harness/approval');
  const memory   = require('../modules/harness/memory');

  approval.setMode('manual');
  approval.settings().always.forEach(approval.forget);
  const watch = H.mkDevice('approval-watch', 'watch', H.WATCH_CAPS);
  const session = memory.createSession({ label: 'from the wrist' });

  // A prompt the watch has answered stays in its list as an outcome view until
  // the watch confirms it — that is `prompts`' design, and `reach.ask` leaves a
  // single target's copy alone on purpose. So each round waits for a prompt it
  // has not already answered, rather than re-answering the last one.
  const seen = new Set();
  const askOnWatch = async choiceId => {
    script = [{ tool: 'shell', args: { command: 'echo from-the-wrist' } }, { text: 'done' }];
    const events = [];
    const turn = agent.turn({
      message: 'do it', sessionId: session.id, emit: e => events.push(e),
      client: { id: watch.device.id, kind: 'watch', name: 'Watch', formFactor: 'watch', label: 'a watch' },
    });

    let p = null;
    for (let i = 0; i < 100 && !p; i++) {
      const list = await H.api(watch.token, 'GET', '/api/v1/prompts');
      p = (list.body.prompts || []).find(x => !seen.has(x.id));
      if (!p) await H.sleep(50);
    }
    assert.ok(p, 'the watch was asked');
    seen.add(p.id);
    assert.match(p.title, /Allow shell/);
    assert.deepEqual(p.choices.filter(c => c.type === 'option').map(c => c.id),
      ['approve', 'deny', 'full_auto'],
      'three options — Full auto included, because the alternative on a wrist is tapping Approve forty times');
    assert.ok(p.choices.some(c => c.type === 'dismiss'), 'and a way out, like every prompt');

    await H.api(watch.token, 'POST', `/api/v1/prompts/${p.id}/select`,
      { selectionId: `sel-${Math.random().toString(16).slice(2)}`, choiceId });
    await turn;
    return events;
  };

  const denied = await askOnWatch('deny');
  assert.match(denied.find(e => e.type === 'tool_result').result, /Refused by the user/);

  const allowed = await askOnWatch('approve');
  assert.match(allowed.find(e => e.type === 'tool_result').result, /from-the-wrist/);
  assert.equal(approval.settings().mode, 'manual', 'approving once does not unlatch the mode');

  // Full auto is a real escalation and is meant to be: it is the user, on
  // their own device, turning the leash off for the whole panel.
  const auto = await askOnWatch('full_auto');
  assert.match(auto.find(e => e.type === 'tool_result').result, /from-the-wrist/);
  assert.equal(approval.settings().mode, 'auto', 'and the panel is in auto afterwards');

  approval.setMode('auto');
});

/* ── One-off calls: the chain, high demand, and empty answers (2026-09-25) ── */

async function withChain(chain, fn) {
  const agentMod = require('../modules/harness/agent');
  agentMod.forgetDegraded();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model', fallbackChain: chain });
  try { return await fn(agentMod); }
  finally {
    await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model', fallbackChain: [] });
    agentMod.forgetDegraded();
  }
}

test('a one-off call uses the fallback chain when the provider is out of capacity', async () => {
  await withChain([{ provider: 'stub', model: 'stub-mini' }], async agentMod => {
    script = [{ status: 503, says: 'Service unavailable: high demand' }, { text: 'from the fallback' }];
    seen.length = 0;
    assert.equal(await agentMod.ask({ system: 's', user: 'u' }), 'from the fallback');
    assert.deepEqual(seen.map(b => b.model), ['stub-model', 'stub-mini'], 'high demand hops, like a stall');
  });
});

test('a rate limit or a refusal is still an answer, and does not hop', async () => {
  await withChain([{ provider: 'stub', model: 'stub-mini' }], async agentMod => {
    for (const status of [429, 401]) {
      script = [{ status, says: 'no' }, { text: 'must not be reached' }];
      seen.length = 0;
      await assert.rejects(agentMod.ask({ system: 's', user: 'u' }));
      assert.equal(seen.length, 1, `${status} is about this request: no hop`);
      script = [];
    }
  });
});

test('a reasoning model that spends the whole reply thinking gets one retry with room, then an explanation — never an empty answer', async () => {
  const agentMod = require('../modules/harness/agent');
  script = [{ text: '', think: 'thinking about the rules for a long time' }, { text: 'Rule 3 is vague.' }];
  seen.length = 0;
  assert.equal(await agentMod.ask({ system: 's', user: 'u', maxTokens: 900 }), 'Rule 3 is vague.');
  assert.deepEqual(seen.map(b => b.max_tokens), [900, 4000], 'the retry has room for thinking and answering');

  script = [{ text: '', think: 'still thinking' }, { text: '', think: 'and still' }];
  await assert.rejects(agentMod.ask({ system: 's', user: 'u', maxTokens: 900 }), /spent its whole reply thinking/);
});

'use strict';

// Nobody waits for a working conversation (harness/inbox.js), and the Orchestrator stays free by code
// (harness/turn/handoff.js) — decided with the owner 2026-10-04.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const agent = require('../modules/harness/agent');
const memory = require('../modules/harness/memory');
const inbox = require('../modules/harness/inbox');

let server, script = [], seen = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', async () => {
      const body = JSON.parse(raw);
      seen.push(body);
      const next = script.shift() || { text: 'done' };
      if (next.delayMs) await H.sleep(next.delayMs);
      const message = next.tool
        ? { content: '', tool_calls: [{ id: `c${seen.length}`, type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args || {}) } }] }
        : { content: next.text };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { istub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'istub', model: 'm', fallbackChain: [], summarizeAfter: 0, compactTokens: 0, orchestratorWorkSteps: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });
beforeEach(() => { script = []; seen = []; });

const userTexts = body => body.messages.filter(m => m.role === 'user').map(m => String(m.content));
const until = async (ok, ms = 4000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await H.sleep(20); return ok(); };

test('a message written while a turn works is read before its next step, as a user row', async () => {
  const s = memory.createSession('mid-turn', { activate: false });
  script = [{ tool: 'system_status', delayMs: 300 }, { text: 'answered both' }];
  const events = [];
  let read = false;
  const running = agent.turn({ message: 'first thing', sessionId: s.id, emit: e => events.push(e) });
  await until(() => seen.length === 1);
  const q = agent.send({ message: 'and one more thing', sessionId: s.id }, { onRead: () => { read = true; } });
  assert.equal(q.queued, true, 'not refused');
  const r = await running;
  assert.equal(read, true);
  assert.ok(userTexts(seen[1]).some(t => t.includes('and one more thing')), 'the second step saw it');
  assert.ok(events.some(e => e.type === 'user_added' && e.text === 'and one more thing'));
  assert.match(r.text, /answered both/);
  assert.equal(inbox.waiting(s.id).length, 0);
});

test('what is still waiting when the turn ends starts the next turn at once', async () => {
  const s = memory.createSession('next turn', { activate: false });
  script = [{ text: 'first reply', delayMs: 300 }, { text: 'second reply' }];
  const first = agent.turn({ message: 'one', sessionId: s.id });
  await until(() => seen.length === 1);
  let answer = null;
  agent.send({ message: 'two', sessionId: s.id }, { onAnswer: x => { answer = x; } });
  await first;
  assert.ok(await until(() => memory.messages(s.id).some(m => m.role === 'assistant' && m.content === 'second reply')), 'two got its own turn');
  const users = memory.messages(s.id).filter(m => m.role === 'user').map(m => m.content);
  assert.deepEqual(users.slice(-2), ['one', 'two'], 'in order, never interleaved');
  assert.equal(answer, null, 'onAnswer is for a message read inside another turn');
});

test('the panel route: a busy conversation answers "queued", then "read" (no 409)', async () => {
  const s = memory.createSession('route', { activate: false });
  script = [{ tool: 'system_status', delayMs: 400 }, { text: 'ok' }];
  const running = agent.turn({ message: 'working', sessionId: s.id });
  await until(() => seen.length === 1);
  const res = await fetch(`${H.base}/api/harness/chat`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ message: 'are you there?', sessionId: s.id }) });
  const types = (await res.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)).type);
  assert.deepEqual(types, ['queued', 'queued_read', 'done']);
  await running;
});

test('the Orchestrator does N steps of work, then the job moves to a work chat and it is free', async () => {
  require('../modules/harness/catalog').saveConfig('doca', { orchestratorWorkSteps: 1 });
  const main = memory.mainSession();
  script = [{ tool: 'shell', args: { command: 'echo one' } }, { tool: 'shell', args: { command: 'echo two' } }];
  const r = await agent.turn({ message: 'build the thing', sessionId: main.id });
  assert.equal(r.handedOff, true);
  assert.match(r.text, /carries on in the work chat/);
  const rows = memory.messages(main.id);
  const calls = rows.filter(m => m.role === 'assistant' && m.tool_calls).flatMap(m => m.tool_calls.map(c => c.id));
  const results = rows.filter(m => m.role === 'tool').map(m => m.tool_call_id);
  for (const id of calls) assert.ok(results.includes(id), `call ${id} has its result`);
  assert.match(rows.filter(m => m.role === 'tool').at(-1).content, /Not run here: the job moved/);
  const chat = memory.listSessions().sessions.find(x => x.kind === 'work' && x.title === 'build the thing');
  assert.ok(chat, 'a work chat holds the job');
  await until(() => !agent.isRunning(chat.id));
  const task = memory.messages(chat.id).find(m => m.role === 'user').content;
  assert.match(task, /build the thing/);
  assert.match(task, /echo one/, 'what was done travels with it');
  assert.match(task, /It was about to: shell/);
  require('../modules/harness/catalog').saveConfig('doca', { orchestratorWorkSteps: 0 });
});

test('reading, memory and coordinating are not work', () => {
  const { isWork } = require('../modules/harness/turn/handoff');
  const call = (name, args = {}) => ({ function: { name, arguments: JSON.stringify(args) } });
  assert.equal(isWork(call('shell', { command: 'rm -rf build' })), true);
  assert.equal(isWork(call('write_file', { path: '/tmp/x', content: 'y' })), true);
  assert.equal(isWork(call('read_file', { path: '/tmp/x' })), false);
  assert.equal(isWork(call('work_chats', { action: 'list' })), false);
  assert.equal(isWork(call('memory_write', { key: 'k', value: 'v' })), false);
});

'use strict';

// Chat tabs (asked 2026-10-04): several chats per project with their sub-agents, a mode, an approval switch
// and a model each; what waits for a conversation is listed and withdrawable.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const memory = require('../modules/harness/memory');
const agent = require('../modules/harness/agent');

let server, script = [], seen = [], project, member;
before(async () => {
  await H.start();
  member = await H.signIn('member');
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (!raw) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[]}'); }
      seen.push(JSON.parse(raw));
      const next = script.shift() || { text: 'done' };
      const message = next.tool ? { content: '', tool_calls: [{ id: `c${seen.length}`, type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args || {}) } }] } : { content: next.text };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { tstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'tstub', model: 'm', fallbackChain: [], summarizeAfter: 0, compactTokens: 0 });
  const root = fs.mkdtempSync(path.join(H.tmp, 'tabs-'));
  project = (await H.api(null, 'POST', '/api/projects', { root })).body.project;
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });
beforeEach(() => { script = []; seen = []; });

test('a project has several chats, and what they start is listed with them as sub-agents', async () => {
  const first = (await H.api(null, 'POST', `/api/projects/${project.id}/chat`)).body.sessionId;
  const second = (await H.api(null, 'POST', `/api/projects/${project.id}/chats`, { title: 'Refactor' })).body.chat.id;
  const child = memory.createSession('helper', { activate: false, kind: 'work', parentId: second });
  const list = (await H.api(null, 'GET', `/api/projects/${project.id}/chats`)).body.chats;
  assert.deepEqual(list.filter(c => !c.sub).map(c => c.id).sort(), [first, second].sort());
  const sub = list.find(c => c.id === child.id);
  assert.ok(sub && sub.sub && sub.parentId === second, 'the sub-agent is there, under its parent');
  assert.equal(list.find(c => c.id === second).title, 'Refactor');
});

test('a tab is renamed, set to a mode, and its approval switch is a host\'s', async () => {
  const id = (await H.api(null, 'POST', `/api/projects/${project.id}/chats`, {})).body.chat.id;
  const r = await H.api(null, 'POST', `/api/harness/sessions/${id}/settings`, { title: 'Bugs', mode: 'debug', approval: 'manual' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.title, 'Bugs'); assert.equal(r.body.mode, 'debug'); assert.equal(r.body.approval, 'manual');
  assert.equal((await H.api(null, 'POST', `/api/harness/sessions/${id}/settings`, { mode: 'yolo' })).status, 400);
  const mine = memory.createSession('member tab', { activate: false });
  require('../modules/harness/session-access').claim({ ...member.user, role: 'member' }, mine.id);
  const m = await H.api(null, 'POST', `/api/harness/sessions/${mine.id}/settings`, { approval: 'auto' }, { Cookie: member.cookie });
  assert.equal(m.status, 403, 'a member does not switch off the questions');
  assert.equal((await H.api(null, 'POST', `/api/harness/sessions/${mine.id}/settings`, { mode: 'ask' }, { Cookie: member.cookie })).status, 200);
});

test('Plan mode runs nothing that changes anything, and says why; approving its plan switches to Agent', async () => {
  const s = memory.createSession('planning', { activate: false });
  require('../modules/harness/modes').set(s.id, 'plan');
  script = [{ tool: 'shell', args: { command: 'touch /tmp/should-not-exist-doca' } }, { text: 'ok' }];
  const events = [];
  await agent.turn({ message: 'go', sessionId: s.id, emit: e => events.push(e) });
  assert.match(events.find(e => e.type === 'tool_result').result, /Plan mode/);
  assert.match(seen[0].messages[0].content, /# Mode: Plan/);
  const org = require('../modules/harness/organization');
  org.plan(s.id, { action: 'draft', title: 'T', steps: ['one'] });
  org.plan(s.id, { action: 'propose' });
  const plan = org.plan(s.id, { action: 'approve', revision: 1 }, { user: true });
  script = [{ text: 'carrying out' }];
  org.carryOut(s.id, plan, { name: 'Dashboard console', kind: 'dashboard' });
  assert.equal(require('../modules/harness/modes').of(s.id), 'agent');
});

test('a conversation\'s own approval switch wins over the panel\'s', () => {
  const approval = require('../modules/harness/approval');
  approval.setMode('auto');
  const s = memory.createSession('asks', { activate: false });
  memory.updateSession(s.id, { approval: 'manual' });
  assert.ok(approval.gate('shell', { command: 'ls -la' }, { sessionId: s.id }), 'asked in a Manual tab');
  assert.equal(approval.gate('shell', { command: 'ls -la' }, { sessionId: memory.createSession('free', { activate: false }).id }), null);
});

test('what waits for a conversation is listed, and can be withdrawn', async () => {
  const s = memory.createSession('waiting', { activate: false });
  const inbox = require('../modules/harness/inbox');
  const q = inbox.put(s.id, { message: 'later please' });
  const list = await H.api(null, 'GET', `/api/harness/sessions/${s.id}/inbox`);
  assert.equal(list.body.waiting[0].message, 'later please');
  const left = await H.api(null, 'DELETE', `/api/harness/sessions/${s.id}/inbox/${q.id}`);
  assert.deepEqual(left.body.waiting, []);
});

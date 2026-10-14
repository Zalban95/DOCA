'use strict';

/**
 * A project's chats make work chats and teams (asked 2026-10-14), one level down and no further (harness/org-depth.js):
 * what a project's chat makes is level 3 and makes nothing — no work chat, no team, no specialist. The Orchestrator keeps
 * what it had.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let server, script = [];
const sse = (res, delta) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 } })}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  await H.start();
  // The script for a test's own turn; anything else (a work chat starting on its task) answers in one line.
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const msgs = JSON.parse(raw || '{}').messages || [];
      const mine = msgs.some(m => m.role === 'user' && /MAKE IT/.test(String(m.content)));
      const next = mine && !msgs.some(m => m.role === 'tool') ? script.shift() : null;
      if (next?.tool) return sse(res, { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] });
      return sse(res, { content: 'Done.' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { pstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'pstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 4 });
  const registry = require('../modules/agents/registry');
  registry.setEnabled(true);
  registry.save({ id: 'builder', label: 'Builder', role: 'You are the builder.', kits: ['files'], maxSteps: 3 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); require('../modules/agents/registry').setEnabled(false); await H.stop(); });

const org = () => require('../modules/harness/organization');
const memory = () => require('../modules/harness/memory');
const projects = () => require('../modules/projects/store');

function project(name) {
  const root = fs.mkdtempSync(path.join(H.tmp, 'pct-'));
  const p = projects().create({ root, name });
  return { p, chat: projects().newChat(p.id, { title: `${name} chat` }) };
}

test('a project\'s chat creates a work chat for its project, one level down', async () => {
  const { p, chat } = project('Alpha');
  const v = await org().tool({ action: 'create', title: 'Write the tests' }, { sessionId: chat.id });
  assert.equal(v.parentId, chat.id, 'it reports to the chat that made it');
  assert.equal(memory().getSession(v.id).level, 3);
  assert.equal(require('../modules/harness/org-depth').level(org().session(v.id)), 3);
  const tab = projects().chats(p.id).find(c => c.id === v.id);
  assert.ok(tab, 'it is among the project\'s chat tabs');
  assert.equal(tab.sub, true, 'drawn ↳ beside the chat that made it');
  assert.ok(org().canManage(chat.id, v.id), 'the project chat manages what it made');
  assert.match(org().block(chat.id), /may also create work chats/);
  assert.match(org().block(v.id), /level 3/);
});

test('what a project\'s chat made creates nothing further: no work chat, no team, no specialist', async () => {
  const { chat } = project('Beta');
  const v = await org().tool({ action: 'create', title: 'Helper' }, { sessionId: chat.id });
  await assert.rejects(org().tool({ action: 'create', title: 'Deeper' }, { sessionId: v.id }), /level 3 makes no work chats/);
  await assert.rejects(require('../modules/teams').create({ title: 'Deeper team', tasks: [{ agent: 'builder', task: 'x' }] }, { by: v.id }), /level 3 makes no teams/);
  assert.throws(() => require('../modules/agents/missions').dispatch({ agentId: 'builder', task: 'x', by: v.id }), /level 3 makes no specialists/);
  const team = require('../modules/harness/toolbox/teams').find(t => t.name === 'team');
  assert.match(await team.run({ action: 'create', title: 'x', tasks: [{ agent: 'builder', task: 'x' }] }, { sessionId: v.id }), /level 3/);
});

test('a project\'s chat makes a team for its project, and a work chat task lands one level down', async () => {
  const { p, chat } = project('Gamma');
  const tool = require('../modules/harness/toolbox/teams').find(t => t.name === 'team');
  const out = await tool.run({ action: 'create', title: 'Docs', goal: 'Docs written',
    tasks: [{ id: 'w', agent: 'work', title: 'Write the docs', task: 'Write the docs page.' }] }, { sessionId: chat.id });
  assert.match(out, /made/, out);
  const t = require('../modules/teams').get(/Team (\S+) made/.exec(out)[1]);
  assert.equal(t.projectId, p.id, 'the team belongs to the project');
  const sid = t.tasks[0].sessionId;
  assert.ok(sid, 'a work chat was made for the task');
  assert.equal(memory().getSession(sid).parentId, chat.id);
  assert.equal(memory().getSession(sid).level, 3);
  assert.ok(projects().chats(p.id).some(c => c.id === sid && c.sub), 'the team\'s work chat is among the project\'s tabs');
  await require('../modules/teams').stop(t.id, { why: 'test over' });
});

test('the Orchestrator is unchanged; a work chat outside a project still makes none', async () => {
  const main = memory().mainSession();
  const v = await org().tool({ action: 'create', title: 'Orchestrated' }, { sessionId: main.id });
  assert.equal(v.parentId, main.id);
  assert.equal(memory().getSession(v.id).level, undefined, 'level 2, as every work chat it made before');
  await assert.rejects(org().tool({ action: 'create', title: 'No' }, { sessionId: v.id }), /Only the Orchestrator and a project's chats/);
  assert.match(org().block(v.id), /cannot create another leader layer/);
});

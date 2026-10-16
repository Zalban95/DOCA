'use strict';

// Mastermind and worker (turn/model-route.js): which model answers each step, decided by what the step is — no model
// asks which model to ask. Empty settings are the old behaviour; a person's choice wins; allotment narrows.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const route = () => require('../modules/harness/turn/model-route');
const memory = () => require('../modules/harness/memory');
const catalog = () => require('../modules/harness/catalog');
const utils = () => require('../modules/utils');

let model;
before(async () => { await H.start(); model = await stubModel(); });
after(async () => { await model.close(); await H.stop(); });

function setRoles(mastermind, worker) {
  const prefs = utils().loadPrefs();
  utils().savePrefs({ ...prefs, harness: { ...(prefs.harness || {}), models: { mastermind, worker } } });
}

async function stubModel() {
  const m = { seen: [], reply: () => ({ content: 'Fine.' }) };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw);
      const fold = /^Merge the notes/.test(body.messages?.[0]?.content || '');
      if (!fold) m.seen.push(body);
      const message = fold ? { content: 'Earlier: nothing.' } : m.reply(m.seen.length - 1, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), rolestub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  m.use = reply => { m.seen = []; m.reply = reply; return m; };
  m.close = async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); };
  return m;
}

const call = (id, name, args = {}) => ({ content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

// Four steps: list a folder (plan), list again (carry on), read a missing file (fails), answer (re-plan / finish).
const fourSteps = i => [call('a', 'list_dir', { path: H.tmp }), call('b', 'list_dir', { path: H.tmp }),
  call('c', 'read_file', { path: path.join(H.tmp, 'no-such-file.txt') }), { content: 'Done.' }][i] || { content: 'Done.' };

async function runTurn(sessionId, events = []) {
  catalog().saveConfig('doca', { provider: 'rolestub', model: 'base', maxSteps: 8, fallbackChain: [], contextWindow: 0 });
  return require('../modules/harness/agent').turn({ message: 'look around', sessionId, emit: e => events.push(e) });
}

test('the rule: the Orchestrator plans, a specialist works, a conversation plans first, works after results, re-plans after a failure', () => {
  setRoles('rolestub/big', 'rolestub/small');
  try {
    const r = route();
    const rows = (calls, failed) => [{ role: 'user', content: 'x' },
      { role: 'assistant', content: '', tool_calls: calls.map((n, i) => ({ id: `c${i}`, function: { name: n, arguments: '{}' } })) },
      ...calls.map((n, i) => ({ role: 'tool', tool_call_id: `c${i}`, name: n, content: failed ? 'Error: no such file' : 'ok' }))];
    assert.equal(r.roleOf({ profile: { level: 'orchestrator' }, session: { kind: 'orchestrator' }, step: 5, rows: rows(['shell']) }), 'mastermind');
    assert.equal(r.roleOf({ profile: { id: 'coder', level: 'specialist' }, session: { kind: 'specialist' }, step: 1, rows: [] }), 'worker');
    const work = { kind: 'work' };
    assert.equal(r.roleOf({ session: work, step: 1, rows: [] }), 'mastermind', 'the first step reads the request and plans');
    assert.equal(r.roleOf({ session: work, step: 2, rows: rows(['shell']) }), 'worker', 'a step after results carries on');
    assert.equal(r.roleOf({ session: work, step: 3, rows: rows(['work_plan']) }), 'mastermind', 'after the plan changes or a step is done: decide, review');
    assert.equal(r.roleOf({ session: work, step: 3, rows: rows(['shell'], true) }), 'mastermind', 'after a failure: re-plan');
    assert.equal(r.roleOf({ session: work, step: 3, rows: [...rows(['shell']), { role: 'user', content: 'also this' }] }), 'mastermind', 'a new message is read by the mastermind');
    // Not routed: the person's choice, a definition's own model, a call.
    assert.equal(r.roleOf({ session: { kind: 'work', modelChoice: { provider: 'x', model: 'y' } }, step: 1 }), null);
    assert.equal(r.roleOf({ profile: { id: 'coder', model: 'own' }, session: { kind: 'specialist' }, step: 1 }), null);
    assert.equal(r.roleOf({ session: work, client: { mode: 'assistant' }, step: 1 }), null);
    assert.deepEqual(r.parse('DeepSeek4f/deepseek/v4-pro'), { provider: 'DeepSeek4f', model: 'deepseek/v4-pro' }, 'the provider is before the first slash');
    assert.equal(r.parse('no-slash'), null);
  } finally { setRoles('', ''); }
});

test('empty settings are the old behaviour: every step on the harness\'s model, no role named', async () => {
  setRoles('', '');
  const m = model.use(fourSteps);
  const events = [];
  const s = memory().createSession('roles off', { activate: false });
  await runTurn(s.id, events);
  assert.deepEqual(m.seen.map(b => b.model), ['base', 'base', 'base', 'base']);
  assert.ok(events.filter(e => e.type === 'step').every(e => !('role' in e)), 'no role on the step event');
  assert.equal(route().roleOf({ session: { kind: 'work' }, step: 1 }), null);
});

test('a conversation: the mastermind plans and re-plans, the worker carries on — and the trace and usage say which', async () => {
  setRoles('rolestub/big', 'rolestub/small');
  try {
    const m = model.use(fourSteps);
    const events = [];
    const s = memory().createSession('roles on', { activate: false });
    const r = await runTurn(s.id, events);
    assert.equal(r.text, 'Done.');
    assert.deepEqual(m.seen.map(b => b.model), ['big', 'small', 'small', 'big'], 'plan, carry on, carry on, re-plan after the failure');
    assert.deepEqual(events.filter(e => e.type === 'step').map(e => e.role), ['mastermind', 'worker', 'worker', 'mastermind']);
    assert.deepEqual(events.filter(e => e.type === 'step').map(e => e.model), ['big', 'small', 'small', 'big']);
    const spans = require('../modules/harness/trace').spansOf?.(s.id);
    if (spans) assert.ok(spans.some(x => x.data?.role === 'worker'));
  } finally { setRoles('', ''); }
});

test('the person\'s choice of model wins over both roles', async () => {
  setRoles('rolestub/big', 'rolestub/small');
  try {
    const m = model.use(fourSteps);
    const s = memory().createSession('roles chosen', { activate: false });
    catalog().saveConfig('doca', { provider: 'rolestub', model: 'base', fallbackChain: [] });
    require('../modules/harness/turn/choice').set(s.id, { provider: 'rolestub', model: 'picked' });
    await runTurn(s.id);
    assert.deepEqual([...new Set(m.seen.map(b => b.model))], ['picked']);
  } finally { setRoles('', ''); }
});

test('a role\'s model is used only when allotted; the harness\'s order follows it as the fallback chain', async () => {
  setRoles('rolestub/big', 'rolestub/small');
  try {
    const levels = require('../modules/auth/levels');
    const L = levels.create({ name: 'Role interns', rights: ['read', 'chat'], tools: { allow: ['*'] }, resources: { model: ['rolestub/base', 'rolestub/small'] } }, { actorLevel: 'owner' });
    const u = await H.signIn(L.id, 'roles-intern@test.local');
    const person = { ...u.user, role: L.id };
    const p = { provider: 'rolestub', model: 'base', fallbackChain: [{ provider: 'other', model: 'x' }] };
    const master = route().paramsFor('mastermind', p, { person });
    assert.equal(master.model, 'base', 'the mastermind is not allotted: the turn\'s own model answers');
    assert.equal(master._roleSkipped, 'not allotted');
    const worker = route().paramsFor('worker', p, { person });
    assert.equal(worker.model, 'small');
    assert.deepEqual(worker.fallbackChain.map(e => `${e.provider}/${e.model}`), ['rolestub/base', 'other/x'], 'then the harness\'s order');
    const owner = route().paramsFor('mastermind', p, { person: { ...H.owner.user, role: 'owner' } });
    assert.equal(owner.model, 'big', 'an admin is not narrowed');
  } finally { setRoles('', ''); }
});

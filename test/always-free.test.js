'use strict';

// Always free (experiment alwaysFree, docs/experiments/always-free.md): the main chat hands a clear job to a work chat
// before any model is asked, moves any other real work there at its first call (one quick visible action excepted),
// and steers a running job's living plan through `background` — and without the flag nothing of it happens.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const agent = require('../modules/harness/agent');
const memory = require('../modules/harness/memory');
const experiments = require('../modules/experiments');

let server, script = [], seen = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(404); res.end('{}'); return; }
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', async () => {
      const body = JSON.parse(raw);
      seen.push(body);
      // A worker's request (its first user row is the task) answers from its own script, or "worked".
      const worker = /handed to you before any work was done|\[plan\]/.test(JSON.stringify(body.messages.filter(m => m.role === 'user').map(m => m.content)));
      const next = (worker ? null : script.shift()) || { text: worker ? 'worked' : 'done' };
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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { fstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'fstub', model: 'm', fallbackChain: [], summarizeAfter: 0, compactTokens: 0, orchestratorWorkSteps: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });
beforeEach(() => { script = []; seen = []; });

const flag = on => { experiments.setDeveloper(true); experiments.set('alwaysFree', on); };
const until = async (ok, ms = 4000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await H.sleep(20); return ok(); };
// A fresh main chat per test, the earlier tests' jobs put away (resetMain hands its children to the new one).
const freshMain = () => {
  for (const s of memory.listSessions().sessions.filter(x => x.kind === 'work' && !x.archivedAt)) memory.updateSession(s.id, { archivedAt: new Date().toISOString() });
  return memory.resetMain();
};
const childrenOf = id => memory.listSessions().sessions.filter(s => s.parentId === id && s.kind === 'work' && !s.archivedAt);
const settle = async id => until(() => !agent.isRunning(id));
const held = body => (body.tools || []).map(t => t.function.name);

test('off: the main chat works as before — no fork, no background tool, orchestratorWorkSteps 0 is off', async () => {
  flag(false);
  const main = freshMain();
  script = [{ tool: 'shell', args: { command: 'echo inline' } }, { text: 'did it here' }];
  const r = await agent.turn({ message: 'build the whole app from scratch', sessionId: main.id });
  assert.equal(r.handedOff, undefined, 'nothing handed on');
  assert.match(r.text, /did it here/);
  assert.equal(childrenOf(main.id).length, 0);
  assert.ok(!held(seen[0]).includes('background'), 'the tool is absent while the flag is off');
});

test('a clear job leaves before any model is asked, carrying its files, and the line names it', async () => {
  flag(true);
  const main = freshMain();
  const file = require('../modules/attachments').save(Buffer.from('a screenshot'), 'shot.png');
  const r = await agent.turn({ message: 'Build the whole landing page app from scratch, with a contact form', sessionId: main.id, attachments: [file.name] });
  assert.equal(r.handedOff, true);
  assert.equal(r.steps, 0, 'no model step in the main chat');
  assert.match(r.text, /^On it — \*\*Build the whole landing page app from scratch, with a conta…\*\* is running in the background/);
  assert.match(r.text, new RegExp(require('../modules/branding').name('product')), 'the product name from branding');
  const [chat] = childrenOf(main.id);
  assert.ok(chat, 'a work chat holds the job');
  await settle(chat.id);
  const task = memory.messages(chat.id).find(m => m.role === 'user');
  assert.match(task.content, /contact form/);
  assert.deepEqual(task.attachments.map(a => a.name), [file.name], 'the person\'s file went with it');
  const s = memory.getSession(chat.id);
  assert.equal(s.plan.state, 'living');
  assert.deepEqual(s.plan.from, ['person']);
  assert.equal(s.job.origin.sessionId, main.id);
  assert.ok(!seen.some(b => /You are the Orchestrator/.test(b.messages[0].content)), 'the Orchestrator\'s model was never asked');
});

test('the safety net: the first real work call moves the job on, with what was read; a look stays', async () => {
  flag(true);
  const main = freshMain();
  script = [{ tool: 'today', args: {} }, { tool: 'shell', args: { command: 'docker image prune -f' } }];
  const r = await agent.turn({ message: 'can you clean up the old docker images?', sessionId: main.id });
  assert.equal(r.handedOff, true);
  assert.match(r.text, /carries on in the background/);
  const rows = memory.messages(main.id);
  assert.match(rows.filter(m => m.role === 'tool').at(-1).content, /Not run here: the job moved/);
  const [chat] = childrenOf(main.id);
  await settle(chat.id);
  const task = memory.messages(chat.id).find(m => m.role === 'user').content;
  assert.match(task, /It was about to: shell/);
  assert.match(task, /today\(/, 'the look it took travels with it');
});

test('one quick visible action stays in the main chat; a second one hands on', async () => {
  flag(true);
  const main = freshMain();
  script = [{ tool: 'remind', args: { text: 'water', at: 'in 10 minutes' } }, { text: 'Reminder set.' }];
  const r = await agent.turn({ message: 'remind me to water the plants in 10 minutes', sessionId: main.id });
  assert.equal(r.handedOff, undefined);
  assert.equal(childrenOf(main.id).length, 0);
  script = [{ tool: 'remind', args: { text: 'a', at: 'in 1 minute' } }, { tool: 'remind', args: { text: 'b', at: 'in 2 minutes' } }];
  const r2 = await agent.turn({ message: 'two reminders please', sessionId: main.id });
  assert.equal(r2.handedOff, true);
});

test('a call is the front whatever assistant.calls says: a job forks with a spoken line, a quick one gets the short kit', async () => {
  flag(true);
  const main = freshMain();
  const call = { name: 'Phone', kind: 'phone', mode: 'call' };
  const r = await agent.turn({ message: 'Research and write a full report on every heat pump on the market, from scratch, comparing all the models', sessionId: main.id, client: call });
  assert.equal(r.handedOff, true);
  assert.match(r.text, /^Checking that now/);
  assert.doesNotMatch(r.text, /\*\*/, 'nothing to read out as markup');
  script = [{ text: 'It is sunny.' }];
  await agent.turn({ message: 'is it sunny?', sessionId: main.id, client: call });
  const kit = held(seen.find(b => /is it sunny/.test(JSON.stringify(b.messages))));
  assert.ok(kit.includes('background') && kit.includes('remind') && !kit.includes('shell'), `the front's kit: ${kit.join(', ')}`);
});

test('background: the person adds a step — flagged, read by the worker, its words rendered from the plan', async () => {
  flag(true);
  const main = freshMain();
  await agent.turn({ message: 'Build the whole landing page app from scratch, with a contact form', sessionId: main.id });
  const [chat] = childrenOf(main.id);
  await settle(chat.id);
  const bg = require('../modules/harness/background');
  const said = bg.act({ action: 'add', text: 'make the header blue' }, { sessionId: main.id });
  assert.match(said, /Added to \*\*Build the whole landing page app from scratch, with a conta…\*\* as step 2/);
  const plan = memory.getSession(chat.id).plan;
  assert.deepEqual(plan.from, ['person', 'person']);
  assert.equal(plan.edits.at(-1).action, 'add');
  await settle(chat.id);
  const told = memory.messages(chat.id).filter(m => m.role === 'user').map(m => m.content);
  assert.ok(told.some(t => /^\[plan\] The person added step 2 through the main chat: "make the header blue"/.test(t)), 'the worker was told');
  assert.ok(memory.getSession(chat.id).plan.edits.at(-1).readAt, 'and its turn took it');
  // The readings: what runs behind, by step.
  const block = require('../modules/harness/organization').block(main.id);
  assert.match(block, /# In the background \(1 working\)/);
  assert.match(block, /step 1 of 2 next/);
});

test('an edit while the worker works waits for its next step, and is unread until then', async () => {
  flag(true);
  const main = freshMain();
  await agent.turn({ message: 'Build the whole thing from scratch: an app with every page and a footer', sessionId: main.id });
  const [chat] = childrenOf(main.id);
  await settle(chat.id);
  // Keep the worker busy, then add.
  const busy = agent.send({ sessionId: chat.id, message: '[plan] keep going', client: { name: 'test', kind: 'agent' } });
  const said = require('../modules/harness/background').act({ action: 'add', job: chat.id, text: 'add a footer' }, { sessionId: main.id });
  assert.match(said, /will pick that up after its current step|is reading it now/);
  await busy;
  await settle(chat.id);
  assert.ok(memory.getSession(chat.id).plan.edits.at(-1).readAt);
});

test('cancel: a queued step at once, a running one is asked; a stale rewrite is refused, naming the person\'s step', async () => {
  flag(true);
  const main = freshMain();
  await agent.turn({ message: 'Build the whole app from scratch, every page and a contact form on it', sessionId: main.id });
  const [chat] = childrenOf(main.id);
  await settle(chat.id);
  const org = require('../modules/harness/organization');
  org.plan(chat.id, { action: 'add', text: 'write the tests' }, { by: 'worker' });
  org.plan(chat.id, { action: 'progress', step: 1, state: 'running' });
  const bg = require('../modules/harness/background');
  assert.match(bg.act({ action: 'cancel', step: 2 }, { sessionId: main.id }), /Cancelled step 2/);
  assert.equal(memory.getSession(chat.id).plan.progress[2], 'cancelled');
  assert.match(bg.act({ action: 'cancel', step: 1 }, { sessionId: main.id }), /Asked .* to drop step 1/);
  assert.equal(memory.getSession(chat.id).plan.progress[1], 'running', 'never cancelled under the worker');
  await settle(chat.id);
  bg.act({ action: 'add', text: 'a dark mode' }, { sessionId: main.id });
  // Before the worker read it, a draft that ignores it is refused.
  const plan = memory.getSession(chat.id).plan;
  memory.updateSession(chat.id, { plan: { ...plan, edits: plan.edits.map(e => ({ ...e, readAt: undefined })) } });
  assert.throws(() => org.plan(chat.id, { action: 'draft', title: 'New', steps: ['x'] }), /changed since you read it.*a dark mode/);
  const ok = org.plan(chat.id, { action: 'draft', title: 'New', steps: ['x', 'a dark mode'], basedOn: memory.getSession(chat.id).plan.version });
  assert.equal(ok.state, 'living', 'a living plan stays living');
  await settle(chat.id);
});

test('split: a step that is not this job\'s becomes a work chat of its own', async () => {
  flag(true);
  const main = freshMain();
  await agent.turn({ message: 'Build the whole site from scratch, every page and a contact form on it', sessionId: main.id });
  const [chat] = childrenOf(main.id);
  await settle(chat.id);
  const org = require('../modules/harness/organization');
  org.plan(chat.id, { action: 'add', text: 'book the dentist' }, { by: 'person' });
  const r = org.plan(chat.id, { action: 'split', step: 2, why: 'not part of the site' });
  assert.equal(memory.getSession(chat.id).plan.progress[2], 'cancelled');
  assert.match(r.moved.title, /Book the dentist/);
  assert.equal(memory.getSession(r.moved.sessionId).parentId, main.id);
  await settle(r.moved.sessionId);
});

test('stop ends a job; work.parallel lines one up, which starts when another ends', async () => {
  flag(true);
  const main = freshMain();
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), work: { parallel: 1 } });
  try {
    await agent.turn({ message: 'Build the whole first app from scratch, every page and a contact form', sessionId: main.id });
    const second = await agent.turn({ message: 'Build the whole second app from scratch, every page and a contact form', sessionId: main.id });
    assert.match(second.text, /lined up/);
    const [a, b] = childrenOf(main.id).sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.title.localeCompare(y.title));
    await settle(a.id);
    assert.equal(memory.getSession(b.id).job.state, 'queued');
    assert.match(require('../modules/harness/background').act({ action: 'stop', job: a.id }, { sessionId: main.id }), /Stopped/);
    assert.equal(memory.getSession(a.id).job.state, 'stopped');
    assert.deepEqual(require('../modules/harness/work-cap').next(), [b.id], 'the lined-up job starts');
    await settle(b.id);
  } finally { savePrefs({ ...loadPrefs(), work: { parallel: 0 } }); }
});

test('only the main chat holds background; a work chat edits its own plan', () => {
  flag(true);
  const off = require('../modules/harness/turn/tool-shape').off(null).map(x => x.name);
  assert.ok(off.includes('background'), 'a work chat (no profile) does not hold it');
  const orch = require('../modules/harness/turn/tool-shape').off({ level: 'orchestrator' }).map(x => x.name);
  assert.ok(!orch.includes('background'));
  assert.ok(require('../modules/agents/registry').NEVER.includes('background'), 'never a specialist\'s');
  flag(false);
});

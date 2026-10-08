'use strict';

// Manual that asks what matters (harness/approval-matters.js; the owner, 2026-10-08): real turns against a scripted
// model, each making one tool call, in Manual with `manualAsks: what-matters` — what can be undone and stays on this
// machine runs unasked; what cannot, or leaves it, is still a person's question; `everything` is Manual as it was.

const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const approval = require('../modules/harness/approval');

let server, script = [];
const owner = () => ({ ...H.owner.user, role: 'owner' });

test.before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const next = script.shift() || { text: 'done' };
      const message = next.tool ? { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } : { content: next.text };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { mstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'mstub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
});
test.after(async () => { approval.setMode('auto'); server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

/** One real turn making one call, as the owner at the dashboard. Asked: denied at once, so nothing outward runs. */
async function call(name, args, { sessionId } = {}) {
  const memory = require('../modules/harness/memory');
  const s = sessionId || memory.createSession(`matters ${name}`, { activate: false }).id;
  script = [{ tool: name, args }, { text: 'done' }];
  const events = [];
  const agent = require('../modules/harness/agent');
  const onEvt = e => {
    if (e.sessionId !== s) return;
    events.push(e);
    if (e.type === 'approval' && e.state === 'asked') setImmediate(() => approval.decide(e.id, 'deny'));
  };
  agent.events.on('event', onEvt);
  try { await agent.turn({ message: 'go', sessionId: s, emit: () => {}, client: { name: 'Dashboard console', kind: 'dashboard', user: owner() } }); }
  finally { agent.events.off('event', onEvt); }
  const asked = events.find(e => e.type === 'approval' && e.state === 'asked');
  return { asked, result: events.find(e => e.type === 'tool_result')?.result || '', call: events.find(e => e.type === 'tool_call') };
}

test('a new install asks what matters; the setting is the owner\'s, guarded and never proposable', async () => {
  assert.equal(approval.settings().manualAsks, 'what-matters', 'the shipped default');
  const schema = require('../modules/settings-schema');
  assert.equal(schema.value('harness.approval.manualAsks'), 'what-matters');
  assert.ok(require('../modules/harness/settings').refuse('harness.approval.manualAsks'), 'an agent cannot propose it');
  const noPassword = await H.api(null, 'POST', '/api/harness/approval', { manualAsks: 'everything' }, { 'X-Doca-Password': '' });
  assert.equal(noPassword.status, 401, 'changing it asks for the password, like the mode');
  const bad = await H.api(null, 'POST', '/api/harness/approval', { manualAsks: 'nothing' });
  assert.equal(bad.status, 400);
  const ok = await H.api(null, 'POST', '/api/harness/approval', { manualAsks: 'everything' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.manualAsks, 'everything');
  approval.setManualAsks('what-matters');
});

test('an install from before keeps Manual asking everything until its owner chooses', () => {
  const { run, MIGRATIONS } = require('../modules/migrations');
  const old = run({ harness: { approval: { mode: 'manual', always: ['read_file'] } } }, MIGRATIONS);
  assert.equal(old.prefs.harness.approval.manualAsks, 'everything');
  assert.deepEqual(old.prefs.harness.approval.always, ['read_file'], 'the rest is untouched');
  const chosen = run({ harness: { approval: { manualAsks: 'what-matters' } } }, MIGRATIONS);
  assert.equal(chosen.prefs.harness.approval.manualAsks, 'what-matters', 'a choice stays');
});

test('what matters: the day, a screen setting asked for, a project edit, a memory and a reminder run unasked', async () => {
  approval.setMode('manual'); approval.setManualAsks('what-matters');
  const today = await call('today', {});
  assert.equal(today.asked, undefined, 'reading the day is never asked');
  assert.match(today.result, /"notices"/);

  const screen = await call('settings_propose', { reason: 'the person asked', asked: true, screen: 'this', changes: [{ path: 'ambient.place', value: 'Pesaro' }] });
  assert.equal(screen.asked, undefined, 'a setting the person asked for has its way back');

  const root = fs.mkdtempSync(path.join(H.tmp, 'matters-'));
  fs.writeFileSync(path.join(root, 'notes.md'), 'one\n');
  const projects = require('../modules/projects/store');
  const p = projects.create({ root, name: 'Matters' });
  const s = require('../modules/harness/memory').createSession('matters project', { activate: false });
  projects.bind(p.id, s.id);
  const edit = await call('shell', { command: 'mkdir build && touch build/out.txt' }, { sessionId: s.id });
  assert.equal(edit.asked, undefined, 'a project edit runs');
  assert.match(edit.call.risk?.checkpoint || '', /^cp_/, 'after a checkpoint, its way back');
  assert.ok(fs.existsSync(path.join(root, 'build', 'out.txt')));

  const mem = await call('memory_write', { key: 'matters.test', value: 'kept', category: 'fact' });
  assert.equal(mem.asked, undefined, 'memory keeps its last values');
  const remind = await call('remind', { text: 'stretch', at: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal(remind.asked, undefined, 'a reminder to the person\'s own devices');
});

test('what matters: a POST to a stranger, a push, rm outside a project, mail, a sign-in and a payment are still asked', async () => {
  approval.setMode('manual'); approval.setManualAsks('what-matters');
  const cases = [
    ['api_call', { url: 'https://api.example.com/v1/charges', method: 'POST', body: '{}' }, /outward: sends data to a service the owner does not run/],
    ['shell', { command: 'git push origin main' }, /pushes to a remote/],
    ['shell', { command: 'rm -rf /tmp/doca-not-a-project' }, /outward: deletes files outside any project/],
    ['shell', { command: 'mail -s hello someone@example.com' }, /outward: sends mail/],
    ['shell', { command: 'echo $(cat ~/.ssh/id_rsa)' }, /cannot reduce to verbs/],
    ['computer_login', { computer: 'c1', login: 'bank' }, /Always asked/],
    ['mcp__phone__screen_press', { ref: 12, confirm: true }, /pays, buys, signs in/],
  ];
  for (const [name, args, why] of cases) {
    const r = await call(name, args);
    assert.ok(r.asked, `${name} ${JSON.stringify(args)} is asked`);
    assert.match(r.asked.summary, why);
    assert.match(r.result, /Refused by the user/, 'and denied, it did not run');
  }
  assert.ok(fs.existsSync(path.join(H.tmp)), 'nothing was deleted');
});

test('"everything" is Manual as it always was: a memory write is asked too', async () => {
  approval.setMode('manual'); approval.setManualAsks('everything');
  const mem = await call('memory_write', { key: 'matters.everything', value: 'x', category: 'fact' });
  assert.ok(mem.asked, 'asked');
  assert.equal(mem.asked.summary.includes('asked because'), false, 'with today\'s card');
  approval.setMode('auto'); approval.setManualAsks('what-matters');
  assert.equal((await call('memory_write', { key: 'matters.auto', value: 'x', category: 'fact' })).asked, undefined, 'Auto is unchanged');
});

test('the agent is told what Manual asks', () => {
  approval.setMode('manual'); approval.setManualAsks('what-matters');
  assert.match(approval.block(), /Manual asks what matters/);
  approval.setManualAsks('everything');
  assert.match(approval.block(), /asked before each tool call that does something/);
  approval.setMode('auto');
});

'use strict';

/**
 * An approval explained (harness/approval-explain.js, approval-does.js; the owner, 2026-10-09): the agent's words,
 * labelled as the agent's; what the call does, a fixed sentence from the tool and its arguments; the exact request with
 * its secrets masked — and nothing a decision reads changed. Real turns against a scripted model, and a device's prompt.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const approval = require('../modules/harness/approval');
const explain  = require('../modules/harness/approval-explain');
const D        = require('../modules/harness/approval-does');
const { MASK } = require('../modules/secrets-mask');

let server, script = [];
const owner = () => ({ ...H.owner.user, role: 'owner' });

test.before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const next = script.shift() || { text: 'done' };
      const message = next.tool ? { content: next.say || '', tool_calls: [{ id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } : { content: next.text };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { estub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'estub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
});
test.after(async () => { approval.setMode('auto'); server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

/** One real turn in Manual making one call; the question is denied at once. */
async function turn(name, args, { say = '', message = 'go' } = {}) {
  const memory = require('../modules/harness/memory');
  const s = memory.createSession(`explain ${name}`, { activate: false }).id;
  script = [{ tool: name, args, say }, { text: 'done' }];
  const events = [];
  const agent = require('../modules/harness/agent');
  const onEvt = e => {
    if (e.sessionId !== s) return;
    events.push(e);
    if (e.type === 'approval' && e.state === 'asked') setImmediate(() => approval.decide(e.id, 'deny'));
  };
  agent.events.on('event', onEvt);
  try { await agent.turn({ message, sessionId: s, emit: () => {}, client: { name: 'Dashboard console', kind: 'dashboard', user: owner() } }); }
  finally { agent.events.off('event', onEvt); }
  return events.find(e => e.type === 'approval' && e.state === 'asked');
}

test('the mechanical line: a chained shell line is each of its parts, and a computed one says it cannot be read', () => {
  const chained = D.does('shell', { command: 'git status && rm -f a.txt b.txt c.txt && git push origin main' });
  assert.match(chained, /^Runs a command on this machine \(/);
  assert.match(chained, /reads the repository \(git status\); then deletes 3 paths \(a\.txt, b\.txt, c\.txt\); then pushes to origin\./);
  const computed = D.does('shell', { command: 'echo $(rm -rf ~)' });
  assert.match(computed, /built while it runs/, 'a $(…) line is said to be unreadable in advance');
  assert.match(D.way('shell', { command: 'git push --force origin main' }), /^No way back once it runs: rewrites or deletes history/);
});

test('the mechanical line: write_file, api_call with a key, a service', () => {
  const file = path.join(H.tmp, 'notes.md');
  assert.match(D.does('write_file', { path: file, content: 'a\nb' }), /^Creates the file .*notes\.md on this machine \(2 lines\)\.$/);
  fs.writeFileSync(file, 'old');
  assert.match(D.does('write_file', { path: file, content: 'x' }), /^Replaces the file .*notes\.md .*the old version is kept as a backup\.$/);
  assert.match(D.way('write_file', { path: file }), /^Can be undone: the file's previous version is kept/);
  assert.equal(D.does('api_call', { url: 'https://api.hi3d.ai/v1/task', method: 'post', key: 'hi3d', files: { images: 'chair.png' } }),
    'Sends a POST request to api.hi3d.ai with your key "hi3d", uploading 1 file.');
  assert.equal(D.does('service', { service: 'hi3d', operation: 'submitTask' }), 'Calls "submitTask" of the service "hi3d" with the key kept for it.');
});

test('the mechanical line: an MCP tool names the machine from its record; a browser click names the control', () => {
  const reach = require('../modules/auth/reach');
  const was = reach.serverOf;
  const phone = H.mkDevice('Al\'s desk', 'phone', H.PHONE_CAPS).device;
  reach.serverOf = name => (/^mcp__desk__/.test(name) ? { server: 'desk', kind: 'device', deviceId: phone.id } : was(name));
  try {
    assert.equal(D.does('mcp__desk__files_delete', { path: 'C:/x' }), 'Calls files_delete on the device "Al\'s desk" (another machine) with path.');
  } finally { reach.serverOf = was; }

  const computers = require('../modules/computers');
  const get = computers.get;
  computers.get = id => (id === 'abc123' ? { id, name: 'tester-1' } : get(id));
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('click', { activate: false }).id;
  memory.append(s, { role: 'tool', tool_call_id: 'x', name: 'mcp__computer-abc123__browser_snapshot', content: 'Example\n[11] a "Home"\n[12] button "Sign in"\n' });
  try {
    assert.equal(D.does('mcp__computer-abc123__browser_click', { ref: 12, confirm: true }, { sessionId: s }),
      'Clicks "Sign in" (button) in the browser on the computer "tester-1" — marked a decision (it may pay, sign in, submit or confirm), so it is always asked.');
  } finally { computers.get = get; }
});

test('the exact request is the line as it runs, with its secrets masked', () => {
  const line = explain.detailOf('shell', { command: 'API_TOKEN=abc curl -H "Authorization: Bearer sk-live-1" --password hunter2 https://u:pw@x.com/' });
  for (const secret of ['abc ', 'sk-live-1', 'hunter2', ':pw@']) assert.ok(!line.includes(secret), `${secret} is masked: ${line}`);
  assert.ok(line.includes(MASK) && line.startsWith('API_TOKEN='), 'the rest is as typed');
  const json = JSON.parse(explain.detailOf('api_call', { url: 'https://api.x.com/?token=abcdefabcdefabcdefabcdef1', key: 'hi3d', headers: { 'X-Thing': 'secret-value' } }));
  assert.equal(json.key, 'hi3d', 'the key\'s name is shown');
  assert.equal(json.headers['X-Thing'], MASK, 'a header value is masked');
  assert.ok(!json.url.includes('abcdefabcdef'), 'a token in the address is masked');
  assert.match(explain.detailOf('vnc_input', { action: 'type', text: 'hello' }, { mission: true }), /\(5 characters\)/, 'a mission\'s typing is never shown');
});

test('in a real turn the card carries the agent\'s words, labelled, and the request is decided as before', async () => {
  approval.setMode('manual'); approval.setManualAsks('everything');
  const args = { command: 'rm -f old.log && git push origin main' };
  const asked = await turn('shell', args, { say: 'The old log is in the way. I will remove it and push the fix. Then more.' });
  assert.ok(asked, 'asked');
  assert.equal(asked.whyFrom, 'agent');
  assert.equal(asked.why, 'The old log is in the way. I will remove it and push the fix. …', 'a sentence or two of the step\'s text');
  assert.match(asked.does, /deletes 1 path \(old\.log\); then pushes to origin/);
  assert.equal(asked.detail, args.command);
  // What a decision reads is the gate's, unchanged.
  const gate = approval.gate('shell', args, {});
  for (const k of ['tool', 'keys', 'summary', 'forced', 'recheck', 'level']) assert.deepEqual(asked[k], gate[k], k);

  const quiet = await turn('write_file', { path: path.join(os.tmpdir(), 'x.md'), content: 'x' }, { message: 'Write my notes to x.md please' });
  assert.equal(quiet.whyFrom, 'request', 'no words from the agent: the request it answers');
  assert.equal(quiet.why, 'Write my notes to x.md please');
  approval.setMode('auto');
});

test('a phone gets why, what it does and the request folded; a watch gets the two lines short and no code', async () => {
  const req = explain.explain(approval.gate('shell', { command: 'rm -f a b' }, { forceAsk: true }) || { tool: 'shell', keys: ['shell:rm'], summary: 'rm -f a b' },
    'shell', { command: 'rm -f a b' }, { reply: { content: 'Clearing the two stale files.' } });
  const bus = require('../modules/api-v1/bus');
  for (const [kind, caps] of [['phone', H.PHONE_CAPS], ['watch', H.WATCH_CAPS]]) {
    const dev = H.mkDevice(`Explain ${kind}`, kind, caps).device;
    const client = { id: dev.id, kind: dev.kind, formFactor: caps.formFactor, user: owner() };
    const ctrl = new AbortController();
    const { answer } = approval.askAnywhere({ ...req, personId: owner().id }, { client, signal: ctrl.signal });
    let p;
    try {
      await H.sleep(80);
      p = bus.drain(dev.id, 0).events.filter(e => e.type === 'prompt.new').at(-1)?.payload?.prompt;
    } finally { ctrl.abort(); }
    assert.ok(p, `a prompt reached the ${kind}`);
    const text = p.body.map(b => b.text).join('\n');
    assert.match(text, /The agent says: Clearing the two stale files\./);
    assert.match(text, kind === 'phone' ? /deletes 2 paths \(a, b\)/ : /deletes 2 paths;?/);
    const code = p.body.find(b => b.style === 'code');
    if (kind === 'phone') {
      assert.equal(code?.text, 'rm -f a b');
      assert.deepEqual(code.ext, { role: 'detail', collapsed: true, label: 'The exact request' });
    } else {
      assert.equal(code, undefined, 'no code on a wrist');
      assert.ok(!text.includes(require('node:os').hostname()), 'nor the host\'s name');
    }
    await answer;
  }
});

test('a call says what it does, briefly', () => {
  const s = require('../modules/harness/call-answer').sentence;
  assert.equal(s('shell', { command: 'rm -f a.txt b.txt c.txt' }), 'Shall I delete 3 paths? Say yes or no.');
  assert.equal(s('shell', { command: 'git status && git push origin main' }), 'Shall I push to origin? Say yes or no.');
  assert.equal(s('shell', { command: 'echo $(whoami)' }), 'Shall I run a command that builds part of itself as it runs? Say yes or no.');
});

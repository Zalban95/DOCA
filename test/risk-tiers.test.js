'use strict';

/**
 * The risk tiers (experiment riskTiers, harness/risk; TODO H10.11): each call is read, reversible or outward. Off,
 * nothing about a call changes; on, an outward call is asked in every mode, a reversible change in a project is
 * checkpointed first, and the tier is on the call's event, its trace span and its Workstream line.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const H      = require('./helpers');   // first: it points the settings at a temporary folder (see its top)
const { classify } = require('../modules/harness/risk/classify');
const risk        = require('../modules/harness/risk');
const approval    = require('../modules/harness/approval');
const experiments = require('../modules/experiments');
const cases       = require('../bin/lib/risk-cases');

// Labelled honestly and missed on purpose (docs/experiments/risk-tiers.md): a language's own delete is not a verb.
const KNOWN_MISSES = [/shutil\.rmtree/];

const OUTWARD = [['shell', { command: 'git push --force origin main' }], ['shell', { command: 'rm -rf ~/Documents/old' }],
  ['api_call', { url: 'https://api.stripe.com/v1/charges', method: 'POST' }], ['mcp__desk__send_email', {}]];

const flag = (on, dev = on) => { experiments.setDeveloper(true); experiments.set('riskTiers', on); experiments.setDeveloper(dev); };

test.before(() => H.start());
test.after(async () => { flag(false, false); approval.setMode('auto'); await H.stop(); });

test('every labelled call lands in its tier, but the known misses — and nothing reversible is called outward', () => {
  for (const [label, name, args, where] of cases) {
    const got = classify(name, args, where || {}).tier;
    if (KNOWN_MISSES.some(re => re.test(JSON.stringify(args)))) { assert.notEqual(got, label, `${name} ${JSON.stringify(args)} is no longer missed: take it off KNOWN_MISSES`); continue; }
    assert.equal(got, label, `${name} ${JSON.stringify(args)}`);
  }
});

test('one outward segment makes the whole line outward; a delete is reversible only inside the project', () => {
  assert.equal(classify('shell', { command: 'git status && rm -rf /srv/data' }, { root: '/work/p' }).tier, 'outward');
  assert.equal(classify('shell', { command: 'rm -rf build' }, { root: '/work/p' }).tier, 'reversible');
  assert.equal(classify('shell', { command: 'rm -rf build' }).tier, 'outward', 'no project: nothing covers it');
  assert.equal(classify('shell', { command: 'rm -rf .' }, { root: '/work/p' }).tier, 'outward', 'the project folder itself is not inside it');
  assert.equal(classify('shell', { command: 'rm -rf build', cwd: '../elsewhere' }, { root: '/work/p' }).tier, 'outward');
  assert.equal(classify('shell', { command: 'cat a > b' }).tier, 'reversible', 'a redirect writes: never a read');
  const r = classify('write_file', { path: 'a' });
  assert.equal(r.tier, 'reversible');
  assert.match(r.way, /backups/, 'a reversible call names its way back');
});

test('MCP tools by their annotations, then by name; an agents\' computer is reversible', () => {
  assert.equal(classify('mcp__s__do_it', {}, { mcp: { readOnly: true } }).tier, 'read');
  assert.equal(classify('mcp__s__do_it', {}, { mcp: { destructive: true } }).tier, 'outward');
  assert.equal(classify('mcp__s__do_it', {}, { mcp: { openWorld: true } }).tier, 'outward');
  assert.equal(classify('mcp__s__do_it', {}, { mcp: {} }).tier, 'reversible');
  assert.equal(classify('mcp__s__delete_file', {}, {}).tier, 'outward');
  assert.equal(classify('mcp__computer-ab12__desktop_click', {}, {}).tier, 'reversible');
});

test('off — the flag, or developer mode — the gate is exactly what it was', async () => {
  for (const [dev, on] of [[false, false], [true, false], [false, true]]) {
    flag(on, dev);
    approval.setMode('auto');
    for (const [name, args] of OUTWARD) assert.equal(approval.gate(name, args, {}), null, `${name} runs unasked in Auto, as before`);
    assert.equal(await risk.before('shell', { command: 'ls' }, {}), null);
    assert.equal(risk.block(), '');
    approval.setMode('manual');
    assert.ok(approval.gate('write_file', { path: 'x' }, {}), 'Manual still asks');
    assert.equal(approval.gate('write_file', { path: 'x' }, {}).tier, undefined);
  }
  approval.setMode('auto');
});

test('on: outward is asked in Auto, Manual and Unattended, never "always"; a mission is refused; the rest is unchanged', () => {
  flag(true);
  for (const mode of ['auto', 'manual', 'unattended']) {
    approval.setMode(mode, { confirm: 'unattended' });
    for (const [name, args] of OUTWARD) {
      const g = approval.gate(name, args, {});
      assert.ok(g, `${name} is asked in ${mode}`);
      assert.equal(g.tier, 'outward');
      assert.equal(g.keys, null, 'no "always" for what cannot be undone');
      assert.match(g.summary, /outward: .+no way back/);
    }
  }
  approval.setMode('auto');
  assert.equal(approval.gate('write_file', { path: 'x' }, {}), null, 'reversible runs in Auto');
  assert.equal(approval.gate('shell', { command: 'git log' }, {}), null, 'a read runs');
  approval.setMode('manual');
  assert.equal(approval.gate('write_file', { path: 'x' }, {}).tier, undefined, 'Manual still asks reversible calls, as before');
  approval.setMode('auto');
  const g = approval.gate('shell', { command: 'git push -f' }, { mission: true });
  assert.match(approval.missionRefusal(g), /A mission has nobody to ask/);
  const { id, answer } = approval.ask(g, {});
  assert.throws(() => approval.decide(id, 'always'), /only be allowed once/);
  approval.decide(id, 'deny');
  return answer;
});

test('on: a reversible change in a project gets a checkpoint first, named as its way back; the prompt says so', async () => {
  flag(true);
  const root = fs.mkdtempSync(path.join(H.tmp, 'risk-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  const projects = require('../modules/projects/store');
  const p = projects.create({ root, name: 'Risky' });
  const s = require('../modules/harness/memory').createSession('risk', { activate: false });
  projects.bind(p.id, s.id);
  const r = await risk.before('shell', { command: 'rm a.txt' }, { sessionId: s.id });
  assert.equal(r.tier, 'reversible');
  assert.match(r.checkpoint, /^cp_[0-9a-f]{10}$/);
  assert.match(r.way, new RegExp(`checkpoint ${r.checkpoint}`));
  assert.ok(require('../modules/projects/checkpoints').list(p).some(c => c.id === r.checkpoint));
  const out = await risk.before('shell', { command: 'rm -rf /srv/elsewhere' }, { sessionId: s.id });
  assert.equal(out.tier, 'outward');
  assert.equal(out.checkpoint, undefined);
  assert.match(risk.block(), /# Risk tiers[\s\S]*asked of the person in every mode/);
});

test('the tier reaches the Workstream line and the trace span', () => {
  const ws = require('../modules/workstream');
  ws.onEvent({ sessionId: 's1', type: 'tool_call', name: 'shell', args: { command: 'git push -f' }, risk: { tier: 'outward', why: 'rewrites history', way: null } });
  const row = ws.snapshot().activity.at(-1);
  assert.equal(row.tier, 'outward');
  assert.equal(row.why, 'rewrites history');
  ws.onEvent({ sessionId: 's1', type: 'tool_call', name: 'ls', args: {} });
  assert.equal(ws.snapshot().activity.at(-1).tier, undefined, 'off: no tier on the line');

  const trace = require('../modules/harness/trace');
  const runId = `run_risk_${Date.now()}`;
  trace.start(runId, 'sess-risk');
  const events = require('../modules/harness/agent').events;
  events.emit('event', { sessionId: 'sess-risk', type: 'tool_call', name: 'write_file', args: { path: 'a', content: 'secret words' }, risk: { tier: 'reversible', way: 'kept under backups', why: null } });
  events.emit('event', { sessionId: 'sess-risk', type: 'tool_result', name: 'write_file', result: 'ok' });
  trace.finish('sess-risk');
  const span = trace.spans(runId).find(x => x.kind === 'tool');
  if (!require('../modules/db').syncHandle()) return;   // tracing is SQLite's (PostgreSQL is not traced yet)
  assert.ok(span, 'the call has a span');
  assert.equal(span.data.tier, 'reversible');
  assert.equal(span.data.way, 'kept under backups');
  assert.ok(!JSON.stringify(span).includes('secret words'), 'names, never values');
  const attrs = require('../modules/harness/trace-otlp').otlp({ id: runId, startedAt: new Date().toISOString() }, trace.spans(runId))
    .resourceSpans[0].scopeSpans[0].spans.flatMap(x => x.attributes).map(a => a.key);
  assert.ok(attrs.includes('doca.risk.tier'));
});

test('a turn\'s call: the tier rides on tool_call, the card asks in Auto naming it, and a denial stops it', async () => {
  flag(true);
  approval.setMode('auto');
  const { runToolCalls } = require('../modules/harness/turn/tool-calls');
  const s = require('../modules/harness/memory').createSession('risk turn', { activate: false });
  const events = [];
  const tc = (id, command) => ({ id, type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command }) } });
  const run = runToolCalls({ reply: { tool_calls: [tc('c1', 'git push --force origin main')] }, schemas: require('../modules/harness/tools').schemas([]),
    stepDisabled: [], session: s, signal: new AbortController().signal, client: null, profile: null, isMission: false, step: 1,
    say: e => events.push(e), announced: new Set() });
  let waiting;
  for (let i = 0; i < 100 && !(waiting = approval.pending().find(p => p.sessionId === s.id)); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(waiting, 'asked in Auto');
  assert.equal(waiting.tier, 'outward');
  approval.decide(waiting.id, 'deny');
  await run;
  assert.equal(events.find(e => e.type === 'tool_call').risk.tier, 'outward');
  assert.ok(events.some(e => e.type === 'approval' && e.state === 'asked' && e.tier === 'outward'));
  assert.match(events.find(e => e.type === 'tool_result').result, /Refused by the user/);
  flag(false, false);
});

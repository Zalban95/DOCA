'use strict';

// Other agents on this machine, step by step (modules/outside-agents): each agent's own record read by its parser
// (fixtures written for these tests, no real transcripts), tailed by byte and never through a link, said in fixed
// words with secrets masked and never a conversation, said once when both routes bring it, labelling the file it
// edited; the OpenTelemetry receiver on loopback only, open while an agent runs and closed after; switched off, nothing read.
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-oa-'));
process.env.CLAUDE_CONFIG_DIR = path.join(HOME, 'claude');
process.env.CODEX_HOME = path.join(HOME, 'codex');
process.env.GEMINI_CLI_HOME = path.join(HOME, 'gem');

const FIX = path.join(__dirname, 'fixtures', 'outside-agents');
const fix = f => fs.readFileSync(path.join(FIX, f), 'utf8');
const CONVERSATION = /CONVERSATION-TEXT|PRIVATE-THOUGHT|TOOL-OUTPUT|FILE-CONTENT|OLD-CODE|NEW-CODE|PROMPT-TEXT|SWORDFISH|BASE-INSTRUCTIONS/;
const SECRET = new RegExp(`${CONVERSATION.source}|abc123secret|hunter2`);   // a line: neither the conversation nor a secret

const claude = require('../modules/outside-agents/claude');
const codex = require('../modules/outside-agents/codex');
const gemini = require('../modules/outside-agents/gemini');
const words = require('../modules/outside-agents/words');
const dedupe = require('../modules/outside-agents/dedupe');
const tail = require('../modules/outside-agents/tail');
const map = require('../modules/outside-agents/otel/map');

test('Claude Code: tool calls become steps; text, thinking and results are never read', () => {
  const steps = fix('claude.jsonl').split('\n').flatMap(l => claude.parse(l));
  assert.deepEqual(steps.map(s => [s.tool, s.kind]), [['Bash', 'command'], ['Read', 'read'], ['Edit', 'edit'], ['WebFetch', 'tool'], ['Write', 'edit']]);
  assert.equal(steps[0].session, '5f0c2a1e-1111-4222-8333-944455556666');
  assert.equal(steps[0].cwd, '/work/stadia');
  assert.equal(steps[4].sub, true, 'a subagent is marked');
  const said = steps.map(s => `${words.who(s, 'stadia')}: ${words.what(s)}`);
  assert.equal(said[0].split(': ')[0], 'Claude Code · stadia');
  assert.match(said[0], /\$ API_TOKEN=\S+ npm test -- --grep parser/);
  assert.match(said[2], /edited src\/parser\.js$/);
  assert.match(said[4], /^Claude Code \(subagent\) · stadia: edited NOTES\.md/);
  for (const l of said) assert.doesNotMatch(l, SECRET, l);
  assert.doesNotMatch(JSON.stringify(steps), CONVERSATION, 'nothing of the conversation is kept in a step');
});

test('Codex: shell argv, exec_command, local_shell and apply_patch; the turn\'s folder followed', () => {
  const meta = {};
  const steps = fix('codex.jsonl').split('\n').flatMap(l => codex.parse(l, meta));
  assert.deepEqual(steps.map(s => [s.tool, s.kind]), [['shell', 'command'], ['apply_patch', 'edit'], ['exec_command', 'command'], ['local_shell', 'command'], ['view_image', 'tool']]);
  assert.equal(steps[0].command, 'rg -n health src');
  assert.deepEqual(steps[1].files, ['src/app.py', 'tests/test_health.py']);
  assert.equal(steps[2].cwd, '/work/stadia/api', 'turn_context moves the folder');
  assert.equal(steps[3].command, 'git status --short');
  assert.equal(steps[0].session, '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000');
  assert.match(words.what(steps[2]), /--password=\S+/);
  for (const s of steps) assert.doesNotMatch(words.what(s), SECRET);
  assert.doesNotMatch(JSON.stringify(steps), CONVERSATION);
  // A record joined mid-way learns its session and folder from its first line alone.
  const f = path.join(HOME, 'rollout-2026-10-15T11-00-00-0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000.jsonl');
  fs.writeFileSync(f, fix('codex.jsonl'));
  const m = {};
  codex.head(f, m);
  assert.equal(m.session, '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000');
  assert.equal(m.cwd, '/work/stadia');
});

test('Gemini CLI: a session document\'s tool calls, each once; the project named by its hash', () => {
  const seen = new Set();
  const steps = gemini.parseDoc(fix('gemini-session.json'), seen);
  assert.deepEqual(steps.map(s => [s.tool, s.kind]), [['run_shell_command', 'command'], ['replace', 'edit'], ['glob', 'tool']]);
  assert.equal(gemini.parseDoc(fix('gemini-session.json'), seen).length, 0, 'a call is a step once');
  assert.doesNotMatch(JSON.stringify(steps), CONVERSATION);
  assert.equal(gemini.hashOf('/work/stadia').length, 64);
  assert.deepEqual(gemini.parseDoc('{ not json'), []);
});

test('tail: from the byte it stopped at, whole lines only, never through a link or another\'s file', () => {
  const dir = fs.mkdtempSync(path.join(HOME, 'tail-'));
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, 'old 1\nold 2\n');
  const r = tail.reader();
  r.know(f, false);
  assert.deepEqual(r.lines(f).lines, [], 'known from its end: nothing old');
  fs.appendFileSync(f, 'new 1\nnew 2 is still bei');
  assert.deepEqual(r.lines(f).lines, ['new 1']);
  fs.appendFileSync(f, 'ng written ✓\n');
  assert.deepEqual(r.lines(f).lines, ['new 2 is still being written ✓']);
  fs.writeFileSync(f, 'replaced\n');
  assert.deepEqual(r.lines(f).lines, ['replaced'], 'a file that shrank is read from its start');
  const link = path.join(dir, 'b.jsonl');
  fs.symlinkSync(f, link);
  assert.equal(tail.own(link), null);
  assert.deepEqual(r.lines(link).lines, []);
  assert.deepEqual(tail.find(dir, { match: x => x.endsWith('.jsonl') }).map(x => path.basename(x.file)), ['a.jsonl'], 'a link is never listed');
});

test('a command\'s secrets are masked in its line', () => {
  const s = { kind: 'command', command: 'curl -H "Authorization: Bearer sk-live-123" https://u:pw@example.com/x?token=t0p && GITHUB_TOKEN=ghp_1 git push' };
  const line = words.what(s);
  assert.doesNotMatch(line, /sk-live-123|ghp_1|t0p|:pw@/);
  assert.match(line, /^\$ curl/);
  assert.equal(words.what({ kind: 'command', command: "cat > notes.md <<'EOF'\nFILE-CONTENT\nmore\nEOF" }), "$ cat > notes.md <<'EOF' … (3 more lines)", 'a heredoc\'s body is not the command');
});

test('one step said once when both routes bring it; twice when it really ran twice', () => {
  dedupe._reset();
  const step = { agent: 'claude', session: 's', tool: 'Bash', kind: 'command', command: 'npm test' };
  assert.equal(dedupe.again(step, 'record'), false);
  assert.equal(dedupe.again({ ...step }, 'otel'), true, 'the export of the same call is not said again');
  assert.equal(dedupe.again({ ...step }, 'record'), false, 'run again by the same route: said again');
  assert.equal(dedupe.again({ agent: 'claude', session: 's', tool: 'Bash', kind: 'tool' }, 'otel'), true, 'an export without details takes the place of the waiting one');
  assert.equal(dedupe.again({ agent: 'claude', session: 's', tool: 'Bash', kind: 'tool' }, 'otel'), false, 'and is said when none waits');
  assert.equal(dedupe.again({ agent: 'claude', session: 's', kind: 'model', tool: 'model' }, 'otel'), false);
});

test('OpenTelemetry: tool results and model requests from the three agents; prompts and outputs never read', () => {
  const { steps, records } = map.steps('logs', JSON.parse(fix('otlp-logs.json')));
  assert.equal(records, 5);
  assert.deepEqual(steps.map(s => [s.agent, s.kind, s.tool]), [['claude', 'command', 'Bash'], ['claude', 'model', 'model'], ['codex', 'command', 'shell'], ['gemini', 'edit', 'write_file']]);
  assert.equal(steps[0].failed, true);
  assert.equal(steps[0].session, '5f0c2a1e-1111-4222-8333-944455556666');
  assert.match(words.what(steps[0]), /^\$ API_TOKEN=\S+ npm test -- --grep parser \(failed, 7\.0 s\)$/);
  assert.equal(words.what(steps[1]), 'asked claude-x: 1.2k in, 340 out, 40k cached in 2.1 s · $0.0123');
  assert.equal(steps[2].command, 'cargo test');
  const tr = map.steps('traces', JSON.parse(fix('otlp-traces.json')));
  assert.deepEqual(tr.steps.map(s => [s.kind, s.tool]), [['tool', 'Grep'], ['model', 'model']]);
  assert.equal(tr.steps[1].failed, true);
  for (const s of [...steps, ...tr.steps]) { assert.doesNotMatch(JSON.stringify(s), CONVERSATION); assert.doesNotMatch(words.what(s), SECRET); }
  assert.equal(map.steps('metrics', { resourceMetrics: [{ scopeMetrics: [{ metrics: [{}, {}] }] }] }).records, 2);
});

const post = (port, p, body, headers = {}) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
    let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  req.on('error', reject);
  req.end(data);
});
const freePort = () => new Promise(r => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('switched off, nothing is read and nothing listens', async () => {
  await H.start();
  const oa = require('../modules/outside-agents');
  oa._reset();
  const r = await H.api(null, 'GET', '/api/workstream/agents');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  await oa.start();
  assert.equal(oa.on(), false, 'the reader does not start');
  assert.equal(oa.status().files, 0, 'no record is opened');
  assert.equal(r.body.receiver.listening, null);
  assert.ok(r.body.setup.find(s => s.agent === 'claude').text.includes('OTEL_EXPORTER_OTLP_PROTOCOL=http/json'));
});

test('on: records tailed while the Workstream is held, said as lines, and an edit labels the file', async () => {
  await H.start();
  const oa = require('../modules/outside-agents'), ws = require('../modules/workstream');
  oa._reset();
  const proj = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-work-stadia');
  fs.mkdirSync(proj, { recursive: true });
  const old = path.join(proj, 'old-session.jsonl');
  fs.writeFileSync(old, fix('claude.jsonl'));
  await H.sleep(1100);
  const port = await freePort();
  const on = await H.api(null, 'POST', '/api/workstream/agents', { enabled: true, otel: false, otelPort: port });
  assert.equal(on.status, 200);
  assert.equal(on.body.enabled, true);
  await oa.start();
  assert.equal(oa.on(), true);
  await oa.look();
  assert.equal(ws.snapshot().activity.filter(a => a.agent).length, 0, 'what was there before is not replayed');
  // A session begun since, and the old one going on.
  const sess = fix('claude.jsonl').replace(/\/work\/stadia/g, JSON.stringify(HOME).slice(1, -1));   // escaped: a Windows path in JSON
  fs.writeFileSync(path.join(proj, 'new-session.jsonl'), sess);
  fs.appendFileSync(old, sess.split('\n').filter(l => l.includes('toolu_02')).join('\n') + '\n');
  await oa.look();
  const lines = ws.snapshot().activity.filter(a => a.agent);
  assert.equal(lines.length, 6, lines.map(l => l.text).join(' | '));
  assert.ok(lines.every(l => l.kind === 'outside' && /^Claude Code/.test(l.who)));
  assert.ok(lines.some(l => /^\$ API_TOKEN=\S+ npm test/.test(l.text)));
  for (const l of lines) assert.doesNotMatch(`${l.who} ${l.text}`, SECRET);
  const who = await require('../modules/workstream/who').of(path.join(HOME, 'src', 'parser.js'), HOME);
  assert.equal(who.by, 'outside');
  assert.match(who.text, /Claude Code session 5f0c2a1e edited it/);
  // Chronicle reads the same lines, a host's.
  const ch = await H.api(null, 'GET', '/api/chronicle?source=outside');
  assert.equal(ch.status, 200);
  assert.equal(ch.body.rows.length, 6);
  const off = await H.api(null, 'POST', '/api/workstream/agents', { enabled: false });
  assert.equal(off.body.reading, false, 'switched off: the reader stops');
});

test('the receiver: loopback only, open while an agent runs, closed a minute after the last', async () => {
  await H.start();
  const oa = require('../modules/outside-agents'), life = require('../modules/outside-agents/otel/life');
  const receiver = require('../modules/outside-agents/otel/receiver');
  oa._reset();
  const uid = process.getuid?.() ?? null;
  let procs = [{ pid: 999001, ppid: 1, uid, name: 'claude', args: ['claude'], cwd: '/work/stadia' }];
  life._source(async () => ({ procs }));
  const port = await freePort();
  await H.api(null, 'POST', '/api/workstream/agents', { enabled: true, otel: true, otelPort: port });
  let st = await life.check();
  assert.deepEqual(st.listening, { address: '127.0.0.1', port });
  const r = await post(port, '/v1/logs', fix('otlp-logs.json'));
  assert.equal(r.status, 200);
  const otelLines = () => require('../modules/workstream').snapshot().activity.filter(a => a.agent?.via === 'otel');
  for (let i = 0; i < 100 && otelLines().length < 4; i++) await H.sleep(100);   // said after the answer: naming the folder can take a while
  const lines = otelLines();
  assert.ok(lines.some(l => l.who === 'Claude Code · stadia' && /npm test/.test(l.text)), 'its folder from the running process');
  assert.ok(lines.some(l => /asked claude-x/.test(l.text)));
  assert.equal((await post(port, '/v1/logs', 'x', { 'Content-Type': 'application/x-protobuf' })).status, 415);
  assert.equal((await post(port, '/v1/nope', {})).status, 404);
  // A peer that is not this machine is refused even if it reached the socket.
  let code = null;
  receiver.handle({ socket: { remoteAddress: '100.64.1.2' }, url: '/v1/logs', method: 'POST', headers: {} },
    { writeHead: c => { code = c; }, end: () => {} }, () => {});
  assert.equal(code, 403);
  // The last agent ends: open a while longer, then closed.
  procs = [];
  st = await life.check();
  assert.ok(st.listening, 'still open within the minute');
  life.T.graceMs = 0;
  await H.sleep(5);
  st = await life.check();
  assert.equal(st.listening, null);
  const acts = require('../modules/activity').list({ limit: 50 }).filter(a => a.from === 'outside-agents');
  assert.ok(acts.some(a => /listens on 127\.0\.0\.1/.test(a.what)) && acts.some(a => /closed/.test(a.what)), 'both said as activity lines');
  await H.api(null, 'POST', '/api/workstream/agents', { enabled: false });
  await life._stop();
  life.T.graceMs = 60000;
});

test.after(async () => { try { await require('../modules/outside-agents/otel/life')._stop(); } catch { /* */ } await H.stop(); fs.rmSync(HOME, { recursive: true, force: true }); });

test('two looks at once open the receiver once', async () => {
  await H.start();
  const life = require('../modules/outside-agents/otel/life');
  const uid = process.getuid?.() ?? null;
  life._source(async () => ({ procs: [{ pid: 999002, ppid: 1, uid, name: 'codex', args: ['codex'], cwd: '/work' }] }));
  const port = await freePort();
  await H.api(null, 'POST', '/api/workstream/agents', { enabled: true, otel: true, otelPort: port });
  const [a, b] = await Promise.all([life.check(), life.sync()]);
  assert.ok(a.listening && b.listening, JSON.stringify([a, b]));
  assert.equal(life.state().why, null);
  await H.api(null, 'POST', '/api/workstream/agents', { enabled: false });
  assert.equal(life.state().listening, null, 'switched off: closed at once');
});

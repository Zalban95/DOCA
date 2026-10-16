'use strict';

/**
 * Best of N (improvement D2, 2026-10-16; modules/teams/tries.js, tries-score.js): a team's task with `tries: N` runs N
 * attempts at once, each in a git worktree of its own; when they have all ended (or the wait after the first good one is
 * over) the hub scores each by its checks and its test alone and keeps the best — the task after it starts from that
 * one — puts the others away with their scores, and says so in one line. Ties go to the cheaper try, or to a registered
 * reviewer. Budgets are checked per try, as for any mission.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)

let server, repo, project;
const hung = new Set();
const sse = (res, delta, prompt = 100) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: 5 } })}\n\n`); res.end('data: [DONE]\n\n'); };
const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const errands = [];

/**
 * The script, per try (the brief says "You are try K of N"): in the task, `T<K>:<what>` — WRITE=<text> writes out.txt,
 * TEST=<code> writes t.js exiting with it and runs `node t.js`, FAIL answers 500, HANG never answers, TOK=<n> bills n.
 */
before(async () => {
  await H.start();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-tries-'));
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), '# A project\n');
  g('add', '.'); g('commit', '-qm', 'first');
  let n = 0;
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', async () => {
      const msgs = JSON.parse(raw || '{}').messages || [];
      const sys = msgs.find(m => m.role === 'system')?.content || '';
      if (/Merge the notes/.test(sys)) return sse(res, { content: 'Earlier: work.' });
      const all = msgs.map(m => String(m.content || '')).join('\n');
      const errand = msgs.find(m => m.role === 'user' && !String(m.content).startsWith('[panel readings'))?.content || '';
      errands.push(errand);
      const k = /You are try (\d+) of \d+/.exec(all)?.[1];
      const what = k ? new RegExp(`T${k}:(\\S+)`).exec(errand)?.[1] || '' : '';
      const tok = Number(/TOK=(\d+)/.exec(what)?.[1] || 100);
      const did = msgs.flatMap(m => m.tool_calls || []).map(c => c.function.name);
      if (/^FAIL/.test(what)) { res.writeHead(500); return res.end('{"error":"broken"}'); }
      if (/^HANG/.test(what)) { hung.add(res); return; }
      const write = /WRITE=([^,]+)/.exec(what)?.[1];
      if (write && !did.includes('write_file')) return sse(res, call(`w${++n}`, 'write_file', { path: 'out.txt', content: write }), tok);
      const code = /TEST=(\d+)/.exec(what)?.[1];
      if (code != null && !did.includes('write_file')) return sse(res, call(`w${++n}`, 'write_file', { path: 't.js', content: `process.exit(${code})\n` }), tok);
      if (code != null && !did.includes('shell')) return sse(res, call(`s${++n}`, 'shell', { command: 'node t.js' }), tok);
      return sse(res, { content: `Finished: try ${k || '-'} of ${errand.split('\n')[0].slice(0, 50)}` }, tok);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { tstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'tstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 6 });
  const registry = require('../modules/agents/registry');
  registry.setEnabled(true);
  registry.save({ id: 'coder', label: 'Coder', role: 'You write code.', kits: ['files', 'shell'], maxSteps: 6 });
  project = require('../modules/projects/store').create({ root: repo, name: 'Shop' });
});
after(async () => {
  for (const r of hung) try { r.destroy(); } catch { /* gone */ }
  server.closeAllConnections(); await new Promise(r => server.close(r));
  require('../modules/agents/registry').setEnabled(false);
  require('../modules/teams').onTie?.(null);
  await H.stop();
  fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(`${repo}.worktrees`, { recursive: true, force: true });
});

const teams = () => require('../modules/teams');
const tries = () => require('../modules/teams/tries');
const missions = () => require('../modules/agents/missions');
const memory = () => require('../modules/harness/memory');
async function until(fn, ms = 20000, what = 'the condition') {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 50)); }
}
const board = id => teams().view(teams().get(id));
const lead = () => { const id = memory().mainSession().id; memory().updateSession(id, { person: { id: H.owner.user.id } }); return id; };
const ended = id => until(() => (board(id).state !== 'running' ? board(id) : null), 25000, 'the team to end');

test('three tries: the one whose checks all hold is kept, the task after it starts from it, the others are put away with their scores', async () => {
  const made = await teams().create({ title: 'Out file', project: 'Shop', tasks: [
    { id: 'build', agent: 'coder', title: 'Make out.txt', task: 'Make out.txt. T1:WRITE=bad T2:WRITE=good T3:FAIL', tries: 3,
      done: 'out.txt says good', check: { file: 'out.txt', contains: 'good' }, checks: [{ file: 'out.txt' }] },
    { id: 'after', agent: 'coder', title: 'Use it', task: 'Use what build made. T0:', after: ['build'], worktree: false },
  ] }, { by: lead() });
  const first = board(made.id);
  assert.deepEqual(first.tasks.map(t => t.id), ['build-try1', 'build-try2', 'build-try3', 'after']);
  const roots = first.tasks.slice(0, 3).map(t => t.place?.root);
  assert.equal(new Set(roots).size, 3, 'each try works in a worktree of its own');
  assert.ok(first.tasks.slice(0, 3).every(t => /^team\/out-file\/build-try\d$/.test(t.place.branch)));
  assert.equal(first.tasks[3].state, 'waiting', 'the task after it waits for the group');
  assert.equal(first.progress.total, 2, 'the group counts as one task');
  assert.match(await until(() => errands.find(e => /You are try 2 of 3/.test(e)), 5000, 'a try\'s brief'), /judged only mechanically/);

  const end = await ended(made.id);
  assert.equal(end.state, 'done', JSON.stringify(end.tasks.map(t => [t.id, t.state, t.why])));
  const j = teams().get(made.id).trials.build;
  assert.equal(j.winner, 'build-try2');
  assert.equal(j.report, "3 tries — #2 kept: all 2 checks held; #1 failed 'out.txt does not contain \"good\"'; #3 did not finish: " + j.scores.find(s => s.n === 3).why);
  assert.ok(j.scores.find(s => s.n === 1).finished && !j.scores.find(s => s.n === 1).eligible);
  const byId = Object.fromEntries(end.tasks.map(t => [t.id, t]));
  assert.equal(byId['build-try2'].chosen, true);
  assert.equal(byId['build-try1'].chosen, false);
  assert.ok(missions().get(byId['build-try1'].missionId).archivedAt, 'a try set aside is put away');
  assert.ok(!missions().get(byId['build-try2'].missionId).archivedAt, 'the kept one stays');
  assert.ok(fs.existsSync(path.join(byId['build-try1'].place.root, 'out.txt')), 'what a set-aside try made stays where it made it');
  assert.equal(end.progress.done, 2);
  assert.equal(end.progress.total, 2);
  const errand = errands.find(e => e.startsWith('Use what build made'));
  assert.match(errand, /Finished: try 2/, 'the task after the group starts with what the kept try delivered');
  assert.doesNotMatch(errand, /Finished: try 1/);
  const doc = fs.readFileSync(path.join(repo, 'team-out-file.md'), 'utf8');
  assert.match(doc, /## Tries[\s\S]*\*\*build\*\* — 3 tries — #2 kept/);
  const said = await require('../modules/harness/toolbox/teams').find(t => t.name === 'team').run({ action: 'status', team: made.id }, { sessionId: lead() });
  assert.match(said, /build: 3 tries — #2 kept/);

  // A person keeps another (finished) try instead; one that never finished cannot be kept.
  const r = await H.api(null, 'POST', `/api/harness/missions/teams/${made.id}/pick`, { task: 'build', try: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.said, /Try 1 of build is kept now \(it was try 2\)\. after already started/);
  assert.equal(teams().get(made.id).trials.build.winner, 'build-try1');
  assert.match(teams().get(made.id).trials.build.report, /#1 kept \(picked by/);
  const r3 = await H.api(null, 'POST', `/api/harness/missions/teams/${made.id}/pick`, { task: 'build', try: 3 }); assert.equal(r3.status, 409, JSON.stringify(r3.body));
});

test('a tie on every check goes to the cheaper try — or to a registered reviewer', async () => {
  const run = async title => {
    const made = await teams().create({ title, project: 'Shop', tasks: [
      { id: 'b', agent: 'coder', task: 'Make it. T1:WRITE=good,TOK=900 T2:WRITE=good,TOK=100', tries: 2, check: { file: 'out.txt', contains: 'good' } }] }, { by: lead() });
    await ended(made.id);
    return teams().get(made.id).trials.b;
  };
  const cheap = await run('Tie one');
  assert.equal(cheap.winner, 'b-try2');
  assert.match(cheap.report, /^2 tries — #2 kept: its check held; #1 also held, set aside — a tie, kept #2 for fewer tokens/);
  let asked = null;
  tries().onTie(({ tied }) => { asked = tied.map(s => s.id); return 'b-try1'; });
  const reviewed = await run('Tie two');
  tries().onTie(null);
  assert.deepEqual(asked.sort(), ['b-try1', 'b-try2']);
  assert.equal(reviewed.winner, 'b-try1');
  assert.match(reviewed.report, /kept #1 for the review/);
});

test('the test a try ran itself: its exit code decides, and the hub never runs it', async () => {
  const made = await teams().create({ title: 'Tested', project: 'Shop', tasks: [
    { id: 'c', agent: 'coder', task: 'Fix it. T1:TEST=1 T2:TEST=0', tries: 2, test: 'node t.js', check: { file: 't.js' } }] }, { by: lead() });
  const end = await ended(made.id);
  const j = teams().get(made.id).trials.c;
  assert.equal(j.winner, 'c-try2', JSON.stringify(j.scores));
  assert.equal(end.state, 'done');
  assert.match(j.report, /^2 tries — #2 kept: its check held, its test passed; #1 failed '`node t\.js` exited 1'/);
  assert.match(errands.find(e => /You are try 1 of 2/.test(e) && e.startsWith('Fix it')), /the test `node t\.js` passing — run exactly `node t\.js` yourself, as a command of its own/);
});

test('a try that never finishes is stopped after the wait that follows the first good one, and scored as unfinished', async () => {
  const made = await teams().create({ title: 'Slow one', project: 'Shop', tasks: [
    { id: 'd', agent: 'coder', task: 'Make it. T1:WRITE=good T2:HANG', tries: 2, check: { file: 'out.txt', contains: 'good' } }] }, { by: lead() });
  await until(() => teams().get(made.id).trials?.d?.firstDoneAt, 15000, 'the first good try');
  assert.equal(board(made.id).state, 'running', 'the team waits for the other try');
  // The wait (teams.triesWaitMin) passes.
  const team = teams().get(made.id);
  team.trials.d.firstDoneAt = new Date(Date.now() - 3600e3).toISOString();
  require('../modules/teams/store').save(team);
  await teams().advance(made.id);
  const end = await ended(made.id);
  const j = teams().get(made.id).trials.d;
  assert.equal(j.winner, 'd-try1');
  assert.match(j.report, /#2 did not finish: stopped 30 min after the first try whose checks held/);
  assert.equal(end.tasks.find(t => t.id === 'd-try2').state, 'stopped');
});

test('tries are refused without anything to judge them, past the limit, or outside a git project', async () => {
  const by = lead();
  await assert.rejects(teams().create({ title: 'Blind', project: 'Shop', tasks: [{ agent: 'coder', task: 'x', tries: 2, done: 'it is nice' }] }, { by }), /judged by checks alone/);
  await assert.rejects(teams().create({ title: 'Many', project: 'Shop', tasks: [{ agent: 'coder', task: 'x', tries: 9, check: { file: 'a' } }] }, { by }), /at most 5 tries/);
  await assert.rejects(teams().create({ title: 'Both', project: 'Shop', tasks: [{ agent: 'coder', task: 'x', tries: 2, count: 2, check: { file: 'a' } }] }, { by }), /Use one/);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-tries-plain-'));
  require('../modules/projects/store').create({ root: plain, name: 'Plain' });
  await assert.rejects(teams().create({ title: 'No git', project: 'Plain', tasks: [{ agent: 'coder', task: 'x', tries: 2, check: { file: 'a' } }] }, { by }), /not a git repository/);
  fs.rmSync(plain, { recursive: true, force: true });
  // agent_dispatch with tries makes a one-task team and says the multiple.
  const out = await require('../modules/harness/toolbox/agents').find(t => t.name === 'agent_dispatch')
    .run({ agent: 'coder', task: 'Make it. T1:WRITE=good T2:WRITE=good', tries: 2, check: { file: 'out.txt' }, project: 'Shop' }, { sessionId: by });
  assert.match(out, /Team team_[a-f0-9]+ made/);
  assert.match(out, /task runs 2 tries at once — about 2× the tokens of one/);
  await ended(/Team (team_[a-f0-9]+)/.exec(out)[1]);
});

test('budgets apply to each try: a person over their budget gets no try started', async () => {
  const member = await H.signIn('member');
  const by = memory().createSession({ title: 'member chat' }).id;
  memory().updateSession(by, { person: { id: member.user.id } });
  // What they have spent today already: one plain mission.
  const m = missions().dispatch({ agentId: 'coder', task: 'Spend. T0:', by });
  await until(() => missions().get(m.id).state !== 'running', 15000, 'the first mission');
  const set = await H.api(null, 'POST', '/api/spending/budget', { personId: member.user.id, budget: { tokensPerDay: 10 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const made = await teams().create({ title: 'Over budget', project: 'Shop', tasks: [
    { id: 'e', agent: 'coder', task: 'Make it. T1:WRITE=good T2:WRITE=good', tries: 2, check: { file: 'out.txt' } }] }, { by });
  const end = await ended(made.id);
  const j = teams().get(made.id).trials.e;
  assert.equal(end.state, 'failed');
  assert.equal(j.winner, null);
  assert.equal(j.scores.length, 2);
  for (const s of j.scores) assert.match(s.why, /budget/i, 'each try was refused by the budget on its own');
  assert.match(j.report, /^2 tries — none kept/);
});

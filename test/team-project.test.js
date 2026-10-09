'use strict';

/**
 * Teams on a project (asked 2026-10-09: "can teams work on the project, and can we have a small section that lists the
 * members of a team working within it?"; modules/teams/place.js, members.js): a team bound to a project works in it —
 * two specialists that change files at the same time each get a git worktree of their own (`team/<slug>/<task>`), a
 * reading task shares the project's folder — its document is one of the project's pages, and the panel lists the team
 * under the project with its members: the leader, the people who started it, each specialist with its task, state and
 * branch.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)

let server, repo;
const sse = (res, delta) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } })}\n\n`); res.end('data: [DONE]\n\n'); };
const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const errands = [];

/** The script: WRITE:<file> writes it (relative: in wherever the task works); SLOW waits first; then a report. */
before(async () => {
  await H.start();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-teamprj-'));
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
      const errand = msgs.find(m => m.role === 'user' && !String(m.content).startsWith('[panel readings'))?.content || '';
      errands.push(errand);
      const ids = msgs.flatMap(m => m.tool_calls || []).map(c => c.function.name);
      if (/SLOW/.test(errand)) await new Promise(r => setTimeout(r, 1200));
      const write = /WRITE:(\S+)/.exec(errand);
      if (write && !ids.includes('write_file')) return sse(res, call(`w${++n}`, 'write_file', { path: write[1], content: 'made' }));
      return sse(res, { content: `Finished: ${errand.split('\n')[0].slice(0, 60)}` });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { tstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'tstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 6 });
  const registry = require('../modules/agents/registry');
  registry.setEnabled(true);
  registry.save({ id: 'coder', label: 'Coder', role: 'You write code.', kits: ['files'], maxSteps: 6 });
  registry.save({ id: 'reader', label: 'Reader', role: 'You read and report.', kits: ['memory'], maxSteps: 6 });
});
after(async () => {
  server.closeAllConnections(); await new Promise(r => server.close(r));
  require('../modules/agents/registry').setEnabled(false);
  await H.stop();
  fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(`${repo}.worktrees`, { recursive: true, force: true });
});

const teams = () => require('../modules/teams');
const missions = () => require('../modules/agents/missions');
const memory = () => require('../modules/harness/memory');
async function until(fn, ms = 15000, what = 'the condition') {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 50)); }
}
const board = id => teams().view(teams().get(id));
const task = (id, t) => board(id).tasks.find(x => x.id === t);

test('a team on a project: writers in worktrees of their own, a reader in the project folder, the document a page', async () => {
  const projects = require('../modules/projects/store');
  const p = projects.create({ root: repo, name: 'Shop' });
  const lead = memory().mainSession().id;   // the Orchestrator, which works in no project: the team names it
  memory().updateSession(lead, { person: { id: H.owner.user.id } });
  const made = await teams().create({ title: 'Checkout', project: 'Shop', tasks: [
    { id: 'api', agent: 'coder', title: 'The API', task: 'Write the API. SLOW WRITE:api.txt', done: 'api.txt is there', check: { file: 'api.txt' } },
    { id: 'ui', agent: 'coder', title: 'The form', task: 'Write the form. SLOW WRITE:ui.txt', check: { file: 'ui.txt' } },
    { id: 'look', agent: 'reader', title: 'Read the README', task: 'Read it. SLOW' },
    { id: 'join', agent: 'coder', title: 'Join them', task: 'Join them. WRITE:join.txt', after: ['api', 'ui'] },
  ] }, { by: lead });
  assert.equal(made.projectId, p.id, 'the team is bound to the project it named');

  const first = board(made.id);
  const api = first.tasks.find(t => t.id === 'api'), ui = first.tasks.find(t => t.id === 'ui'), look = first.tasks.find(t => t.id === 'look');
  assert.equal(api.place.branch, 'team/checkout/api', 'a writer beside another writer gets its own branch');
  assert.equal(ui.place.branch, 'team/checkout/ui');
  assert.notEqual(api.place.root, ui.place.root);
  assert.equal(look.place.branch, null, 'a reading task shares the folder');
  assert.equal(look.place.root, repo);
  const sessionOf = t => missions().get(t.missionId).sessionId;
  const common = require('../modules/harness/toolbox/common');
  assert.equal(common.cwd({ sessionId: sessionOf(api) }), api.place.root, 'the API task works in its worktree');
  assert.equal(common.cwd({ sessionId: sessionOf(look) }), repo, 'the reader works in the project folder');
  assert.equal(projects.forSession(sessionOf(look)).id, p.id, 'its conversation is the project\'s');
  assert.match(await until(() => errands.find(e => e.startsWith('Write the API')), 5000, 'the API task\'s first request'), /## Where you work\nIn the project's git worktree .* on the branch team\/checkout\/api/);

  // The section: the team under its project, with its members.
  const listed = (await H.api(null, 'GET', `/api/harness/missions/teams?project=${p.id}`)).body.teams;
  assert.deepEqual(listed.map(t => t.id), [made.id]);
  const m = listed[0].members;
  assert.equal(m.leader.kind, 'Orchestrator');
  assert.deepEqual(m.people.map(x => x.name), ['owner'], 'the person who started it, named from their account');
  assert.deepEqual(m.specialists.map(s => [s.task, s.name]), [['api', 'Coder'], ['ui', 'Coder'], ['look', 'Reader'], ['join', 'Coder']]);
  assert.equal(m.specialists[0].state, 'running');
  assert.equal(m.specialists[0].budget, 6);
  assert.equal(m.specialists[0].branch, 'team/checkout/api');
  assert.ok(m.specialists[0].sessionId, 'a member links to its conversation');
  assert.equal(m.specialists[3].state, 'waiting');
  assert.equal(listed[0].project.name, 'Shop');
  assert.deepEqual((await H.api(null, 'GET', '/api/harness/missions/teams?project=prj_nothere')).body.teams, [], 'another project lists none');

  const end = await until(() => (board(made.id).state !== 'running' ? board(made.id) : null), 20000, 'the team to finish');
  assert.equal(end.state, 'done', JSON.stringify(end.tasks.map(t => [t.id, t.state, t.why])));
  assert.ok(fs.existsSync(path.join(api.place.root, 'api.txt')), 'the API landed in its worktree');
  assert.ok(!fs.existsSync(path.join(repo, 'api.txt')) && !fs.existsSync(path.join(repo, 'ui.txt')), 'the project folder is untouched by them');
  const join = end.tasks.find(t => t.id === 'join');
  assert.equal(join.place.branch, null, 'nothing writes beside it: it shares the folder');
  assert.ok(fs.existsSync(path.join(repo, 'join.txt')));
  assert.match(end.tasks.find(t => t.id === 'api').why, /api.txt is there/, 'its contract was read in its own worktree');

  const page = path.join(repo, 'team-checkout.md');
  assert.ok(fs.existsSync(page), 'the document is one of the project\'s pages');
  const doc = fs.readFileSync(page, 'utf8');
  assert.match(doc, /## Where the work is[\s\S]*branch `team\/checkout\/api`/);
  assert.match(doc, /4 of 4 tasks done/);
});

test('a team made from a project chat works in that project; a lone writer shares its folder', async () => {
  const projects = require('../modules/projects/store');
  const p = projects.create({ root: repo, name: 'Shop' });
  const chat = projects.newChat(p.id);
  const tool = require('../modules/harness/toolbox/teams').find(t => t.name === 'team');
  const out = await tool.run({ action: 'create', title: 'Docs pass', tasks: [{ id: 'w', agent: 'coder', task: 'Write it. WRITE:docs.txt' }] }, { sessionId: chat.id });
  assert.match(out, /in the project Shop/);
  const id = /Team (team_[a-f0-9]+)/.exec(out)[1];
  assert.equal(teams().get(id).projectId, p.id);
  assert.equal(task(id, 'w').place.branch, null);
  await until(() => board(id).state === 'done', 15000, 'the lone task');
  assert.ok(fs.existsSync(path.join(repo, 'docs.txt')));
  await assert.rejects(teams().create({ title: 'x', project: 'Nowhere', tasks: [{ agent: 'coder', task: 'x' }] }, { by: chat.id }), /No project called "Nowhere"/);
});

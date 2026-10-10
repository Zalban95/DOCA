'use strict';

/**
 * Agents → Teams (asked 2026-10-10: "Is there a specific place where I can see the teams of agents working, their
 * plan, the state of the project?"; modules/teams/detail.js, tidy.js): one call draws a team's board as a page — each
 * task's specialist's last words, its contract's verdict, the team document's text, and the project as git and its
 * chats say — for whoever may open the leading conversation, nobody else; an ended team is put away by itself after
 * `teams.archiveAfterDays`, lands in the Archive and comes back from it, and one brought back is left alone after.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let server, repo, member;
const sse = (res, delta) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`); res.end('data: [DONE]\n\n'); };
const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

before(async () => {
  await H.start();
  member = await H.signIn('member', 'teams-page-member@test.local');
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-teampage-'));
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), '# A project\n');
  g('add', '.'); g('commit', '-qm', 'the first commit');
  let n = 0;
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', async () => {
      const msgs = JSON.parse(raw || '{}').messages || [];
      if (/Merge the notes/.test(msgs.find(m => m.role === 'system')?.content || '')) return sse(res, { content: 'Earlier: work.' });
      const errand = msgs.find(m => m.role === 'user' && !String(m.content).startsWith('[panel readings'))?.content || '';
      const ids = msgs.flatMap(m => m.tool_calls || []).map(c => c.function.name);
      const write = /WRITE:(\S+)/.exec(errand);
      if (write && !ids.includes('write_file')) return sse(res, call(`w${++n}`, 'write_file', { path: write[1], content: 'made' }));
      return sse(res, { content: `Delivered ${errand.split(/[.\n]/)[0]}.\nThe rest of the report.` });
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
async function until(fn, ms = 15000, what = 'the condition') {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 50)); }
}

let teamId;

test('a team\'s board as a page: last words, verdicts, the document and the project\'s state — for its people only', async () => {
  const projects = require('../modules/projects/store');
  const p = projects.create({ root: repo, name: 'Shop' });
  const memory = require('../modules/harness/memory');
  const lead = memory.mainSession().id;
  memory.updateSession(lead, { person: { id: H.owner.user.id } });
  // A chat of the project with a plan step still open: the page lists it under the project.
  const chat = projects.newChat(p.id, { title: 'Shop planning' });
  memory.updateSession(chat.id, { plan: { state: 'approved', steps: ['Ship the checkout', 'Write the docs'], progress: { 1: 'done' } } });
  const made = await teams().create({ title: 'Checkout', goal: 'A working checkout', project: 'Shop', tasks: [
    { id: 'api', agent: 'coder', title: 'The API', task: 'Write the API. WRITE:api.txt', done: 'api.txt is there', check: { file: 'api.txt' } },
    { id: 'ui', agent: 'coder', title: 'The form', task: 'Write the form. WRITE:ui.txt', check: { file: 'ui.txt' } },
    { id: 'look', agent: 'reader', title: 'Review', task: 'Review them', after: ['api', 'ui'] },
  ] }, { by: lead });
  teamId = made.id;
  await until(() => teams().get(made.id).state !== 'running', 20000, 'the team to finish');

  const r = await H.api(null, 'GET', `/api/harness/missions/teams/${made.id}/detail`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.equal(d.team.state, 'done', JSON.stringify(d.team.tasks.map(t => [t.id, t.state, t.why])));
  assert.equal(d.lines.api.kind, 'report');
  assert.equal(d.lines.api.text, 'Delivered Write the API.', 'its report\'s first line, its own words');
  const api = d.checks.find(c => c.task === 'api');
  assert.equal(api.done, 'api.txt is there');
  assert.deepEqual(api.check, { file: 'api.txt' });
  assert.equal(api.verdict.ok, true);
  assert.ok(api.verdict.at, 'when the hub checked it');
  assert.ok(!d.checks.some(c => c.task === 'look'), 'a task without a contract has no check to show');
  assert.match(d.doc, /^# Team: Checkout/);
  assert.match(d.doc, /3 of 3 tasks done/);
  assert.equal(d.project.name, 'Shop');
  assert.equal(d.project.git.branch, 'main');
  assert.equal(d.project.main[0].subject, 'the first commit');
  assert.deepEqual(d.project.branches.map(b => b.branch).sort(), ['team/checkout/api', 'team/checkout/ui']);
  assert.ok(d.project.branches.every(b => b.commits.length >= 1), 'each task\'s branch with its newest commits');
  assert.deepEqual(d.project.openSteps.map(s => [s.chat, s.n, s.step, s.state]), [['Shop planning', 2, 'Write the docs', 'queued']]);
  assert.match(d.says.look, /^done/);

  assert.equal((await H.api(null, 'GET', `/api/harness/missions/teams/${made.id}/detail`, undefined, { Cookie: member.cookie })).status, 404,
    'someone who may not open the leading conversation sees no team');
  assert.equal((await H.api(null, 'GET', '/api/harness/missions/teams')).body.archiveAfterDays, 7);
});

test('an ended team is put away after teams.archiveAfterDays, comes back from the Archive, and is left alone after', async () => {
  const store = require('../modules/teams/store');
  const tidy = require('../modules/teams/tidy');
  const t = store.get(teamId);
  assert.deepEqual(tidy.sweep(), [], 'ended moments ago: kept on the page');
  t.endedAt = new Date(Date.now() - 8 * 864e5).toISOString();
  store.save(t);
  assert.deepEqual(tidy.sweep(), [teamId]);
  assert.ok(store.get(teamId).archivedAt);
  const visible = (await H.api(null, 'GET', '/api/harness/missions/teams')).body.teams.map(x => x.id);
  assert.ok(!visible.includes(teamId), 'out of the list');
  assert.ok((await H.api(null, 'GET', '/api/harness/missions/teams?all=1')).body.teams.some(x => x.id === teamId), 'still there with the put-away ones');
  const archive = (await H.api(null, 'GET', '/api/archive')).body.items;
  const row = archive.find(i => i.kind === 'team' && i.id === teamId);
  assert.ok(row, 'in the Archive');
  assert.match(row.detail, /done, 3 of 3 tasks done/);
  assert.ok(!(await H.api(null, 'GET', '/api/archive', undefined, { Cookie: member.cookie })).body.items.some(i => i.id === teamId), 'not in someone else\'s');
  assert.equal((await H.api(null, 'POST', `/api/archive/team/${teamId}`, { on: false })).status, 200);
  assert.equal(store.get(teamId).archivedAt, null);
  assert.deepEqual(tidy.sweep(), [], 'brought back by a person: the tidy-up leaves it');
});

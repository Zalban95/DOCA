'use strict';

/**
 * How a team is organised (2026-10-17, after a game team's poor result): a task after several tasks starts from all
 * their branches merged (a conflict named, never forced); a leader adds tasks to its board after a review (`team add`),
 * and an ended team runs again; a check that already holds before any work is refused, since it proves nothing; and a
 * work chat that makes a project works in it from then on.
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
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

before(async () => {
  await H.start();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-teamcraft-'));
  g(repo, 'init', '-q', '-b', 'main'); g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), '# A game\n');
  g(repo, 'add', '.'); g(repo, 'commit', '-qm', 'first');
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const msgs = JSON.parse(raw || '{}').messages || [];
      const errand = msgs.find(m => m.role === 'user' && !String(m.content).startsWith('[panel readings'))?.content || '';
      sse(res, { content: `Finished: ${errand.split('\n')[0].slice(0, 60)}` });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { tstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'tstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 4 });
  const registry = require('../modules/agents/registry');
  registry.setEnabled(true);
  registry.save({ id: 'reader', label: 'Reader', role: 'You read and report.', kits: ['memory'], maxSteps: 4 });
});
after(async () => {
  server.closeAllConnections(); await new Promise(r => server.close(r));
  require('../modules/agents/registry').setEnabled(false);
  await H.stop();
  fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(`${repo}.worktrees`, { recursive: true, force: true });
});

const teams = () => require('../modules/teams');
const memory = () => require('../modules/harness/memory');
async function until(fn, ms = 15000, what = 'the condition') {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 50)); }
}

/** A branch off main holding one commit that writes `file`. */
function branch(name, file, text) {
  g(repo, 'checkout', '-q', '-b', name, 'main');
  fs.writeFileSync(path.join(repo, file), text);
  g(repo, 'add', '.'); g(repo, 'commit', '-qm', `${name}: ${file}`);
  g(repo, 'checkout', '-q', 'main');
  return { branch: name, path: repo };
}

test('a task after several worktree tasks starts from all their branches merged, and a conflict is named', async () => {
  const projects = require('../modules/projects/store');
  const p = projects.create({ root: repo, name: 'Merge game' });
  const a = branch('team/x/enemies', 'enemies.js', 'export const ENEMIES = 5;\n');
  const b = branch('team/x/levels', 'levels.js', 'export const LEVELS = 6;\n');
  const c = branch('team/x/clash', 'README.md', '# Another title\n');
  const d = branch('team/x/clash2', 'README.md', '# Yet another title\n');
  const lead = memory().createSession('lead').id;
  const team = { title: 'X', projectId: p.id, by: lead, tasks: [
    { id: 'enemies', agent: 'reader', place: { root: repo, worktree: a } },
    { id: 'levels', agent: 'reader', place: { root: repo, worktree: b } },
    { id: 'clash', agent: 'reader', place: { root: repo, worktree: c } },
    { id: 'clash2', agent: 'reader', place: { root: repo, worktree: d } },
    { id: 'join', agent: 'reader', after: ['enemies', 'levels'] },
    { id: 'joinc', agent: 'reader', after: ['clash', 'clash2'] },
  ] };
  const place = require('../modules/teams/place');
  assert.equal(place.wantsWorktree(team, team.tasks[4]), true, 'a reader after worktree tasks still gets one: only it holds their work');
  const joined = await place.forTask(team, team.tasks[4]);
  const at = joined.place.worktree.path;
  assert.deepEqual(joined.place.from, ['team/x/enemies', 'team/x/levels']);
  assert.ok(fs.existsSync(path.join(at, 'enemies.js')) && fs.existsSync(path.join(at, 'levels.js')), 'both branches\' files are there');
  assert.equal(g(at, 'status', '--porcelain'), '', 'the merge is committed');

  const clash = await place.forTask(team, team.tasks[5]);
  assert.deepEqual(clash.place.conflicts.map(x => [x.branch, x.files]), [['team/x/clash2', ['README.md']]]);
  assert.deepEqual(clash.place.from, ['team/x/clash']);
  assert.equal(fs.readFileSync(path.join(clash.place.worktree.path, 'README.md'), 'utf8'), '# Another title\n', 'the first branch is the base; nothing forced');
  assert.equal(g(clash.place.worktree.path, 'status', '--porcelain'), '', 'the failed merge was undone');

  // The errand says where it starts and what is left to merge by hand.
  const engine = require('../modules/teams/engine');
  const t = { id: 'joinc', agent: 'reader', title: 'Join', task: 'Join them.', after: [], place: clash.place };
  const said = [];
  const missions = require('../modules/agents/missions');
  const real = missions.dispatch;
  missions.dispatch = o => { said.push(o.context); return { id: 'm_x' }; };
  const realPatch = missions.patch; missions.patch = () => {};
  try { await engine.dispatch({ ...team, id: 'team_x', tasks: [...team.tasks.slice(0, 5), t] }, t); } finally { missions.dispatch = real; missions.patch = realPatch; }
  assert.match(said[0], /starts with the work of the tasks before yours: team\/x\/clash\./);
  assert.match(said[0], /could not be merged in for you.*team\/x\/clash2 \(README\.md\)/);
});

test('a check that already holds before any work is refused; one that fails now, or a test, is taken', async () => {
  const projects = require('../modules/projects/store');
  if (!projects.list().some(x => x.name === 'Merge game')) projects.create({ root: repo, name: 'Merge game' });
  const lead = memory().createSession('lead2').id;
  await assert.rejects(teams().create({ title: 'Weak', project: 'Merge game', tasks: [
    { id: 'story', agent: 'reader', task: 'Write the story.', check: { file: 'README.md', contains: 'game' } }] }, { by: lead }),
  /Task story: its check already holds before any work \(README\.md is there with "game"\), so it proves nothing/);
  const ok = await teams().create({ title: 'Real', project: 'Merge game', tasks: [
    { id: 'story', agent: 'reader', task: 'Write the story.', check: { file: 'story.md' } },
    { id: 'core', agent: 'reader', task: 'Write the core.', check: { file: 'README.md' }, test: 'npm test' }] }, { by: lead });
  assert.ok(ok.id);
  await teams().stop(ok.id);
});

test('team add: more tasks on the board, after ones already there; an ended team runs again, a stopped one refuses', async () => {
  const lead = memory().createSession('lead3').id;
  const made = await teams().create({ title: 'Grow', tasks: [{ id: 'build', agent: 'reader', task: 'Build it.' }] }, { by: lead });
  await until(() => teams().get(made.id).state === 'done', 15000, 'the first task');
  await assert.rejects(teams().add(made.id, { tasks: [{ id: 'build', agent: 'reader', task: 'Again.' }] }, { by: lead }), /already on this team's board/);
  await assert.rejects(teams().add(made.id, { tasks: [{ id: 'fix', agent: 'reader', task: 'Fix.', after: ['nope'] }] }, { by: lead }), /not a task of this team.*build "Build it\."/);
  const grown = await teams().add(made.id, { tasks: [{ id: 'review', agent: 'reader', task: 'Review it.', after: ['Build it.'] },
    { agent: 'reader', task: 'Fix what the review found.', after: ['review'] }] }, { by: lead });
  assert.equal(grown.state, 'running', 'it runs again');
  assert.deepEqual(grown.tasks.map(t => [t.id, t.after]), [['build', []], ['review', ['build']], ['t3', ['review']]]);
  await until(() => teams().get(made.id).state === 'done', 15000, 'the added tasks');
  assert.equal(teams().view(teams().get(made.id)).progress.total, 3);

  const tool = require('../modules/harness/toolbox/teams').find(x => x.name === 'team');
  await teams().stop(made.id);
  const stopped = teams().get(made.id);
  if (stopped.stoppedAt) assert.match(await tool.run({ action: 'add', team: made.id, tasks: [{ agent: 'reader', task: 'More.' }] }, { sessionId: lead }), /was stopped/);
});

test('a work chat that opens a project works in it; the Orchestrator does not', async () => {
  const tools = require('../modules/harness/tools');
  const work = memory().createSession('A game', { kind: 'work' }).id;
  const folder = fs.mkdtempSync(path.join(H.tmp, 'game-'));
  const out = await tools.call('project', { action: 'open', root: folder, name: 'Comet' }, [], { sessionId: work });
  assert.match(out, /This conversation now works in it/);
  assert.equal(require('../modules/projects/store').forSession(work)?.name, 'Comet');
  const main = memory().mainSession().id;
  const folder2 = fs.mkdtempSync(path.join(H.tmp, 'game2-'));
  assert.doesNotMatch(await tools.call('project', { action: 'open', root: folder2, name: 'Orbit' }, [], { sessionId: main }), /now works in it/);
});

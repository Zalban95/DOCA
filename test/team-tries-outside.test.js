'use strict';

/**
 * Best of N for an outside harness, and which run of a test counts (review of 2026-10-16; modules/teams/tries.js,
 * tries-score.js, harness-teams/trajectory.js). A `harness:` try works in its own computer; its branch comes back to the
 * hub as a worktree of its own, and its checks run there — never in the project's folder. Its test is read from the
 * return codes its trajectory records, with the same strict matching as a try on the hub: only the test itself, output
 * redirections aside. No Docker here: the workers' ends are played by harness-teams `finish` on branches made in a
 * scratch repository, with trajectories written as mini-swe-agent writes them.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let repo, project;
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const setAllow = allow => { const u = require('../modules/utils'); const p = u.loadPrefs(); u.savePrefs({ ...p, teams: { ...(p.teams || {}), outside: { allow } } }); };

before(async () => {
  await H.start();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-tries-out-'));
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), '# A project\n');
  g('add', '.'); g('commit', '-qm', 'first');
  project = require('../modules/projects/store').create({ root: repo, name: 'Outside' });
  setAllow(['mini']);
});
after(async () => {
  setAllow([]);
  await H.stop();
  fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(`${repo}.worktrees`, { recursive: true, force: true });
});

test('only the test itself counts as its run: piped, chained or echoed it says nothing', () => {
  const { isTestRun } = require('../modules/teams/tries-score');
  for (const c of ['npm test', '  npm   test ', 'npm test > out.txt', 'npm test 2>&1', 'npm test >> log 2>&1', 'npm test &> log', 'npm test 2>/dev/null'])
    assert.equal(isTestRun(c, 'npm test'), true, c);
  for (const c of ['npm test | tail -20', 'npm test || true', 'echo npm test', 'npm test; echo ok', 'npm test && echo ok', 'cd x && npm test', 'npm tests', 'npm test &', 'npm test > $(f)', 'npm test -- --grep x'])
    assert.equal(isTestRun(c, 'npm test'), false, c);
  const { fromRuns } = require('../modules/teams/tries-score');
  assert.equal(fromRuns('npm test', [{ command: 'npm test | tail -20', code: 0 }], '').state, 'unknown', 'a pipe\'s exit is tail\'s');
  assert.equal(fromRuns('npm test', [{ command: 'npm test || true', code: 0 }], '').state, 'unknown');
  assert.equal(fromRuns('npm test', [{ command: 'echo npm test', code: 0 }], '').state, 'unknown');
  assert.equal(fromRuns('npm test', [{ command: 'npm test 2>&1', code: 1 }, { command: 'npm test > log', code: 0 }], '').state, 'passed');
  assert.equal(fromRuns('npm test', [{ command: 'npm test', code: 0 }, { command: 'sed -i s/a/b/ x', code: 0, changes: true }], '').state, 'unknown', 'a change after it');
});

test('a trajectory\'s commands pair with their return codes; a later edit makes the test not known, a submit does not', () => {
  const tr = require('../modules/harness-teams/trajectory');
  const { fromRuns } = require('../modules/teams/tries-score');
  const traj = cmds => JSON.stringify({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'task' },
    ...cmds.flatMap(([command, rc]) => [{ role: 'assistant', content: 'go', extra: { actions: [{ command }] } }, { role: 'tool', content: `<returncode>${rc}</returncode>\n<output>\n</output>` }])] });
  const runs = tr.runs(traj([['pytest -q', 1], ['sed -i s/-/+/ add.py', 0], ['pytest -q', 0], ['git add -A && git commit -qm fix', 0], ['echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT', 0]]));
  assert.deepEqual(runs.map(r => [r.code, r.changes]), [[1, true], [0, true], [0, true], [0, false], [0, false]]);
  assert.equal(fromRuns('pytest -q', runs, '').state, 'passed');
  assert.equal(fromRuns('pytest -q', tr.runs(traj([['pytest -q', 0], ['echo x > add.py', 0]])), '').state, 'unknown');
  assert.equal(fromRuns('pytest -q', tr.runs(traj([['pytest -q | tail -3', 0]])), '').state, 'unknown');
  assert.equal(fromRuns('pytest -q', tr.runs(traj([['pytest -q 2>&1', 2]])), '').why, '`pytest -q` exited 2');
  assert.equal(tr.runs('{"messages": ['), null, 'half-written: nothing read');
});

test('tries of a harness that records no exit codes are refused; mini-swe-agent\'s are judged; count is not tries', () => {
  const teams = require('../modules/teams');
  setAllow(['mini', 'claude']);
  try {
    assert.throws(() => teams.shape({ title: 'x', tasks: [{ id: 't1', agent: 'harness:claude', task: 'fix', tries: 2, test: 'npm test' }] }, { workChats: true, project: true }),
      /tries of harness:claude cannot be judged yet .*\(mini-swe-agent, harness:mini\)/);
    const s = teams.shape({ title: 'x', tasks: [{ id: 't1', agent: 'harness:mini', task: 'fix', tries: 2, test: 'npm test' }] }, { workChats: true, project: true });
    assert.deepEqual(s.tasks.map(t => t.id), ['t1-try1', 't1-try2']);
    assert.throws(() => teams.shape({ title: 'x', tasks: [{ id: 't1', agent: 'harness:mini', task: 'fix', tries: 2, count: 2, test: 'npm test' }] }, { workChats: true }), /Use one/);
  } finally { setAllow(['mini']); }
  // The hive's default tries apply only to a task its checks or test can judge.
  const u = require('../modules/utils'); const p = u.loadPrefs();
  u.savePrefs({ ...p, teams: { ...(p.teams || {}), tries: 3 } });
  try {
    const tries = require('../modules/teams/tries');
    assert.equal(tries.wanted({ id: 'a', agent: 'coder', task: 'x' }, { project: true }), 1);
    assert.equal(tries.wanted({ id: 'a', agent: 'coder', task: 'x', checks: [] }, { project: true }), 1, 'an empty list of checks judges nothing');
    assert.equal(tries.wanted({ id: 'a', agent: 'coder', task: 'x', test: 'npm test' }, { project: true }), 3);
  } finally { u.savePrefs(p); }
});

test('harness tries: each branch comes back as a worktree of its own and is checked there; its test from its trajectory', async () => {
  const S = require('../modules/harness-teams/store');
  const missions = require('../modules/agents/missions');
  const memory = require('../modules/harness/memory');
  const store = require('../modules/teams/store');
  const lead = memory.mainSession().id;
  // Try 1 and 2 committed out.txt saying good; try 3 committed nothing. The project's own folder has no out.txt.
  const branch = (name, text) => { g('checkout', '-qb', name, 'main'); fs.writeFileSync(path.join(repo, 'out.txt'), text); g('add', '.'); g('commit', '-qm', name); g('checkout', '-q', 'main'); };
  branch('team/mini-fix-try1-a', 'good\n'); branch('team/mini-fix-try2-a', 'good\n');
  const shaped = require('../modules/teams').shape({ title: 'Outside tries', tasks: [{ id: 'fix', agent: 'harness:mini', task: 'Make out.txt good', tries: 3,
    test: 'node t.js', check: { file: 'out.txt', contains: 'good' } }] }, { workChats: true, project: true });
  const team = { id: store.newId(), ...shaped, by: lead, projectId: project.id, state: 'running', createdAt: new Date().toISOString(), loop: { on: false, rounds: 0 }, notes: [], outsideBy: 'asked' };
  const workers = shaped.tasks.map((t, i) => {
    const s = memory.createSession(`mini: ${t.title}`, { activate: false, kind: 'specialist', parentId: lead });
    const m = missions.insert({ id: `msn_out${i}`, agentId: 'harness:mini', label: 'mini-swe-agent', task: t.task, sessionId: s.id, state: 'running', by: lead,
      startedAt: new Date().toISOString(), steps: 0, tokens: 0, team: { id: team.id, task: t.id, title: team.title } });
    t.missionId = m.id; t.startedAt = m.startedAt;
    t.place = { root: repo, worktree: { branch: `team/mini-fix-try${i + 1}-a`, path: null }, outside: true };
    return S.add({ id: `wrk_out${i}`, harness: 'mini', label: 'mini-swe-agent', teamId: team.id, task: t.id, projectId: project.id, branch: `team/mini-fix-try${i + 1}-a`,
      sessionId: s.id, missionId: m.id, state: 'running', startedAt: m.startedAt,
      runs: [[{ command: 'node t.js 2>&1', code: 0, changes: true }], [{ command: 'node t.js | tail -5', code: 0, changes: true }], []][i] });
  });
  store.save(team);
  for (const w of workers) await require('../modules/harness-teams').finish(w.id, { state: 'done', final: 'Done.' });
  await require('../modules/teams').advance(team.id);
  const j = store.get(team.id).trials.fix;
  assert.ok(j?.judgedAt, 'judged once every try ended');
  assert.equal(j.winner, 'fix-try1', j.report);
  const byN = Object.fromEntries(j.scores.map(s => [s.n, s]));
  assert.equal(byN[1].test, 'passed');
  assert.equal(byN[2].test, 'unknown', 'a piped run is not a run of the test');
  assert.match(byN[2].testWhy, /never run by mini-swe-agent/);
  assert.equal(byN[2].held, 1, 'its check held in its own worktree');
  assert.equal(byN[3].eligible, false);
  assert.match(byN[3].failed[0], /not on the hub in a worktree of its own \(it committed nothing\)/, 'never checked in the project\'s folder');
  assert.ok(!fs.existsSync(path.join(repo, 'out.txt')), 'the project\'s own folder was not touched');
  const t1 = store.get(team.id).tasks.find(t => t.id === 'fix-try1');
  assert.ok(t1.place.worktree.path && t1.place.worktree.path !== repo && fs.existsSync(path.join(t1.place.worktree.path, 'out.txt')));
  assert.match(j.report, /^3 tries — #1 kept: its check held, its test passed; #2 also held, set aside .*its test not known/);
});

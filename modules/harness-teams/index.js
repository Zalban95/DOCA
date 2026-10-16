'use strict';

/**
 * Outside harnesses as team members (asked 2026-10-12: "drive teams using the available harnesses if the orchestrator is
 * specifically instructed to use a different harness … 5 Claude CLI with Opus 5.5, or dsh"). A task of a team
 * (modules/teams) whose agent is `harness:<catalog id>` — only when the person named that harness in their request
 * (teams/index.js refuses it otherwise) — is dispatched here instead of to a specialist:
 *
 *   - it works in an agents' computer of its own (computers/), kept per harness so the CLI is installed once and a
 *     person's sign-in made there stays (`agentType: harness:<id>`); never lent to a specialist (computers/whose.js);
 *   - the project's HEAD (or the branch of the task it comes after) is checked out there on the task's own branch
 *     `team/<harness>-<task>-<words>`, and the CLI runs headless in that folder with its own approvals OFF — it can touch
 *     only that box — and never with approvals off on the hub;
 *   - the API key DOCA keeps for its vendor goes into that one process's environment (box.js), never to an agent, a log
 *     or an argument; with none, a CLI signed in by a person in that computer runs on its own sign-in, and one that is
 *     not fails its task saying how to sign in once (Take over);
 *   - it is a mission row like any member (missions bar, devices, Chronicle, Stop), its own commands and words are said
 *     mechanically (worker.js), its commits come back to the hub's repository as that branch while it works and when it
 *     ends, and its end is checked against the task's contract in a worktree of that branch on the hub — merging it is
 *     the person's (Projects → Team branches) or the leader's (`team merge`).
 */
const crypto = require('crypto');
const S = require('./store');
const harnesses = require('./harnesses');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const missions = () => require('../agents/missions');
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const maxWorkers = () => require('../settings-schema').value('teams.outside.maxWorkers');

/** Whether one more outside worker may start now (teams.outside.maxWorkers); a task over it waits, queued. */
const room = () => S.running().length < maxWorkers();

/** A branch name no ref and no worktree on the hub has yet: team/<harness>-<task>-<words>, then -2, -3 … */
async function branchFor(root, row, t) {
  const want = `team/${slug(row.id)}-${slug(t.id)}-${slug(t.title).slice(0, 28)}`.replace(/-+$/, '');
  const git = require('../projects/git').git;
  const fs = require('fs'), path = require('path');
  const taken = async name => fs.existsSync(path.join(`${root}.worktrees`, name.replace(/\//g, '-')))
    || S.running().some(w => w.branch === name) || await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(() => true, () => false);
  let name = want;
  for (let n = 2; await taken(name) && n < 50; n++) name = `${want}-${n}`;
  return name;
}

/** What the CLI is told: its branch, to commit as it goes, the team's notes, and to end with what it did and what is left. */
function preamble(w) {
  return [`You are ${w.label}, working as task ${w.task} of a team that DOCA runs. You work in an isolated computer, in this folder: a git checkout of the project `
    + `on the branch ${w.branch}, which is yours. Commit as you go with clear messages; do not push, and do not switch branches — the hub takes your branch back by itself.`,
  `Your teammates' findings are in ${w.notesIn} (read it when you need to know what they found). To tell them something they need — a path, a decision, a `
    + `pitfall — append one short line to ${w.notesOut}.`,
  'When you finish, end with a short summary: what you did, and what is left.', '', '## Your task', w.prompt].join('\n');
}

/**
 * The engine's call for one `harness:` task (teams/engine.js dispatch): makes its conversation and mission row and starts
 * the worker in the background. Returns the mission row; throws a sentence when it cannot start (the task fails with it).
 */
async function dispatch(team, t, { context = '' } = {}) {
  const row = harnesses.find(String(t.agent).slice('harness:'.length));
  const project = team.projectId ? require('../projects/store').get(team.projectId) : null;
  if (!project) throw bad('An outside harness works on a project: make the team with project: <name>.');
  if (!(await require('../projects/git').top(project.root))) throw bad(`${project.name} is not a git repository: its work comes back as a branch.`);
  if (!(await require('../computers').imageReady())) throw bad('The agents\' computer image is not built yet (Machines → Computers → Build the image).', 409);
  // The task it comes after, when that was a harness task or had a worktree: start from its branch (what it made is there).
  const dep = (t.after || []).map(id => require('../teams/tries').taskFor(team, id)?.place?.worktree?.branch).find(Boolean);   // a task with tries: its kept one
  const from = t.place?.worktree?.branch || dep || 'HEAD';   // a retry carries on from its last try's branch
  const branch = await branchFor(project.root, row, t);
  const id = `wrk_${crypto.randomBytes(5).toString('hex')}`;
  const label = `${row.label}${t.model ? ` (${t.model})` : ''}`;
  const prompt = [t.task, context].filter(Boolean).join('\n\n');
  const memory = require('../harness/memory');
  const session = memory.createSession(`${label}: ${t.title}`.slice(0, 80), { activate: false, kind: 'specialist', parentId: team.by,
    fields: { projectId: project.id, titleLocked: true, team: { id: team.id, task: t.id } },
    profile: { id: `harness:${row.id}`, label: row.label, tools: [], memory: false, systemPrompt: `This conversation is the record of ${row.label} working as an outside team member; it does not answer here.` } });
  memory.append(session.id, { role: 'user', content: prompt });
  const notes = `/home/agent/teams/${id}`;
  const w = S.add({ id, harness: row.id, model: t.model || null, label, teamId: team.id, task: t.id, title: t.title, projectId: project.id,
    branch, from, sessionId: session.id, state: 'starting', steps: 0, prompt, notesIn: `${notes}.team.md`, notesOut: `${notes}.notes`, startedAt: new Date().toISOString() });
  const m = { id: `msn_${crypto.randomBytes(6).toString('hex')}`, agentId: `harness:${row.id}`, label, task: String(t.task).slice(0, 2000), sessionId: session.id,
    state: 'running', by: team.by, chainId: null, startedAt: w.startedAt, endedAt: null, steps: 0, tokens: 0, result: null, error: null,
    plan: require('./worker').PLAN.map(title => ({ title, state: 'queued' })), planAt: w.startedAt,
    team: { id: team.id, task: t.id, title: team.title }, outside: { harness: row.id, model: w.model, worker: id, branch } };
  missions().insert(m);
  S.patch(id, { missionId: m.id });
  t.place = { root: project.root, worktree: { branch, path: null }, outside: true };   // the board shows its branch from the start
  w.missionId = m.id;
  w.runId = require('../harness/runs').begin({ kind: 'outside', sessionId: session.id, missionId: m.id,
    personId: (() => { try { return require('../harness/session-access').ownerOf(team.by); } catch { return null; } })(),
    detail: { harness: row.id, model: w.model, branch, team: team.id, task: t.id } });
  S.patch(id, { runId: w.runId });
  missions().announce(m);
  require('../activity').note({ from: 'harness-teams', what: `started ${label} on task ${t.id} "${t.title}" of team "${team.title}" — branch ${branch}`,
    why: team.outsideBy === 'free' ? 'its switch is "On its own": the Orchestrator started it; the team dispatched the task' : 'the person asked for this harness; the team dispatched the task', sessionId: team.by });
  setImmediate(() => require('./worker').run(S.get(id)));
  return m;
}

/** The branch back on the hub as a worktree, so the task's contract is read where its work is (teams/engine.js cwdOf). */
async function placeOnHub(w) {
  const project = require('../projects/store').get(w.projectId);
  if (!project) return null;
  const git = require('../projects/git').git;
  const has = await git(project.root, ['rev-parse', '--verify', '--quiet', `refs/heads/${w.branch}`]).then(() => true, () => false);
  if (!has) return { root: project.root, shared: true, why: 'it committed nothing', worktree: { branch: w.branch, path: null }, outside: true };
  const path = require('path'), fs = require('fs');
  const root = (await git(project.root, ['rev-parse', '--show-toplevel'])).trim();
  const at = path.join(`${root}.worktrees`, w.branch.replace(/\//g, '-'));
  if (!fs.existsSync(at)) {
    fs.mkdirSync(path.dirname(at), { recursive: true });
    await git(root, ['worktree', 'add', '-q', at, w.branch]);
  }
  return { root: at, worktree: { path: at, branch: w.branch, base: w.base || null, repo: root }, outside: true };
}

/** A worker ended: its place on the board, then its mission (which advances the team), its run and its record. */
async function finish(id, { state, final = '', error = null, cost = null } = {}) {
  const w = S.get(id);
  if (!w || !S.RUNNING.has(w.state) && w.state !== 'sign-in') return;
  S.patch(id, { state, endedAt: new Date().toISOString(), error, cost });
  const place = await placeOnHub(w).catch(e => ({ root: null, why: e.message }));
  const engine = require('../teams/engine');
  if (place) await engine.serial(w.teamId, () => {
    const team = require('../teams/store').get(w.teamId);
    const t = team?.tasks.find(x => x.id === w.task && x.missionId === w.missionId);
    if (t) { t.place = place; require('../teams/store').save(team); }
  });
  const memory = require('../harness/memory');
  if (final) memory.append(w.sessionId, { role: 'assistant', content: final });
  const mstate = state === 'done' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed';
  const m = missions().patch(w.missionId, { state: mstate, endedAt: new Date().toISOString(), result: final || null, error, steps: S.get(id)?.steps || 0 });
  missions().announce(m);
  require('../harness/runs').end(w.runId, { state: mstate, outcome: (error || final || '').split('\n')[0], steps: S.get(id)?.steps || 0 });
  require('../activity').note({ from: 'harness-teams', what: `${w.label} ${mstate} on task ${w.task} — branch ${w.branch}${error ? `: ${error}` : ''}`,
    why: 'its CLI ended in its computer', level: mstate === 'failed' ? 'warn' : 'info', sessionId: w.sessionId });
  // A place for one more worker: other teams' outside tasks that waited for it (teams.outside.maxWorkers) go now.
  for (const r of require('../teams/store').list().filter(x => x.state === 'running' && x.id !== w.teamId)) engine.advance(r.id);
}

/** No key in DOCA and the CLI is not signed in in its computer: the task fails saying how to sign in once. */
function needsSignIn(id, c, row) {
  const w = S.get(id);
  const vendor = row.team?.key?.host || 'its vendor';
  return finish(id, { state: 'failed', error: `${row.label} needs signing in once: DOCA keeps no key for ${vendor} and it is not signed in in its computer "${c.name}" (${c.id}). `
    + `Either add the provider's API key in Field → API keys, or open Machines → Computers → ${c.name} → Take over, run ${row.cmd} in a terminal there and sign in — `
    + 'the computer keeps it for every later team. Then try the task again (team keep_going).' });
}

/** Stop the worker behind a mission (the missions bar's Stop, a team's stop). */
async function stopMission(missionId) {
  const w = S.byMission(missionId);
  if (!w || !S.RUNNING.has(w.state)) return false;
  await require('./worker').stop(w);
  return true;
}

/** After a restart: the CLI behind a mission the hub no longer follows is ended, its branch brought back, the task failed. */
function recover(stuck = []) {
  for (const m of stuck) {
    const w = S.byMission(m.id);
    if (!w) { missions().announce(missions().patch(m.id, { state: 'failed', endedAt: new Date().toISOString(), error: 'cut off by a restart of the hub' })); continue; }
    require('./worker').salvage(w).catch(() => {}).finally(() => finish(w.id, { state: 'failed', error: 'cut off by a restart of the hub; what it had committed is on its branch' }));
  }
}

module.exports = { dispatch, finish, needsSignIn, stopMission, recover, preamble, room, branchFor, maxWorkers };

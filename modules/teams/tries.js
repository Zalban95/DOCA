'use strict';

/**
 * Best of N (improvement D2, the owner's green light of 2026-10-16): a task of a team may ask for several tries of the
 * same errand — `tries: N` — each a task of its own (`<id>-try1` … `<id>-tryN`) in a git worktree of its own (or, for an
 * outside harness, its own computer and branch), all with the same contract. When every try has ended — or
 * `teams.triesWaitMin` after the first one whose checks all held — the hub scores each mechanically (tries-score.js) and
 * keeps the best: its branch and report are the task's result, what the tasks after it start from. The others stay
 * where they are (worktrees and branches untouched, their missions put away) with their scores, and a person may pick
 * another (`pick`). No model judges; when two are equal on everything but cost, the cheaper is kept — unless a tie
 * reviewer has been registered (`onTie`, the hook a "mastermind" review would use).
 *
 * The rest of the team reads a group as one task: `after: ["t1"]` waits for the kept try, the board counts the group as
 * one task (board.summary), and a try that fails is never tried again on its own — its siblings are the retry.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const HARD_MAX = 8;
const value = k => require('../settings-schema').value(k);
const SUFFIX = /-try(\d+)$/;

/** Whether a task has anything mechanical to be judged by: a check, checks, or a test. */
const judged = t => !!(t?.check || (Array.isArray(t?.checks) && t.checks.length) || String(t?.test || '').trim());
/**
 * Whether tries of this agent can be judged: DOCA's own always (its worktree on the hub, its calls in its conversation);
 * an outside harness only when it records each command's return code (a trajectory, harness-teams/trajectory.js) — its
 * branch comes back as a worktree on the hub for the checks (harness-teams/index.js placeOnHub).
 */
function judgeable(agent) {
  if (!require('./outside').isOutside(agent)) return true;
  try { return !!require('../harness-teams/harnesses').all().find(r => `harness:${r.id}` === String(agent))?.team?.output; } catch { return false; }
}

/** Where a try is judged: its own worktree, never the project's folder — `{cwd}`, or `{why}` when it has none on the hub. */
function folder(t) {
  const at = t.place?.worktree?.path;
  if (at && require('fs').existsSync(at)) return { cwd: at };
  return { why: `its work is not on the hub in a worktree of its own${t.place?.why ? ` (${t.place.why})` : ''}, so there is nothing of it to judge` };
}

const maxTries = () => Math.max(1, Math.min(HARD_MAX, value('teams.maxTries')));

/** The tries a task asked for, or the hive's default for a task the checks can judge; throws a sentence over the limit. */
function wanted(t, { project = false } = {}) {
  if (t?.tries == null) {
    const d = Math.floor(Number(value('teams.tries')) || 1);
    return d > 1 && project && judged(t) && judgeable(t?.agent) ? Math.min(d, maxTries()) : 1;   // only a task its checks or test can judge
  }
  const n = Math.floor(Number(t.tries));
  if (!Number.isInteger(n) || n < 1) throw bad(`Task ${t.id || ''}: tries is a whole number, 1 or more.`.replace('  ', ' '));
  if (n > maxTries()) throw bad(`Task ${t.id || ''}: at most ${maxTries()} tries (the setting teams.maxTries).`.replace('  ', ' '));
  if (n > 1 && !judged(t))
    throw bad(`Task ${t.id}: tries are judged by checks alone, and this task has none — give it a check, checks or a test, or one try (the pick would be blind).`);
  if (n > 1 && !judgeable(t.agent))
    throw bad(`Task ${t.id}: tries of ${t.agent} cannot be judged yet — the hub reads a try's test from each command's exit code, which only a harness that records them (mini-swe-agent, harness:mini) leaves. Give this task one try, or count for several workers sharing the plan.`);
  return n;
}

/** A task with tries made into its tries; ids `<id>-try<k>`. `after` naming the task keeps naming the group. */
function expand(tasks = [], { project = false } = {}) {
  const out = [];
  tasks.forEach((t, i) => {
    const id = String(t?.id || `t${i + 1}`).trim().slice(0, 14);
    const n = wanted({ ...t, id }, { project });
    if (n === 1) { out.push(t?.id == null ? { ...t, id } : t); return; }
    if (t.worktree === false) throw bad(`Task ${id}: tries each work in a worktree of their own; leave worktree unset.`);
    for (let k = 1; k <= n; k++) {
      out.push({ ...t, id: `${id}-try${k}`, tries: undefined, worktree: true, trial: { of: id, n: k, tries: n },
        title: `${t.title || String(t.task || '').slice(0, 50)} (try ${k} of ${n})` });
    }
  });
  return out;
}

/** The group ids of a team's tasks: { t1: [task, task, task] }. */
function groups(team) {
  const g = {};
  for (const t of team.tasks || []) if (t.trial) (g[t.trial.of] = g[t.trial.of] || []).push(t);
  return g;
}

/** The task a dependency stands for: the task itself, or the kept try of a group (null while none is kept). */
function taskFor(team, id) {
  const t = (team.tasks || []).find(x => x.id === id);
  if (t) return t;
  const kept = team.trials?.[id]?.winner;
  return kept ? team.tasks.find(x => x.id === kept) || null : null;
}

const ENDED = new Set(['done', 'failed', 'stopped']);

/** A group read as one task for the board: its tries' views in, one view out. */
function groupView(team, of, tryViews) {
  const j = team.trials?.[of] || {};
  const first = tryViews[0] || {};
  const base = { id: of, title: String(first.title || of).replace(/ \(try \d+ of \d+\)$/, ''), agent: first.agent, after: first.after || [],
    group: true, tries: tryViews.length, contract: first.contract || null };
  if (j.judgedAt && j.winner) return { ...base, state: 'done', percent: 100, kept: j.winner, why: j.report };
  if (j.judgedAt) return { ...base, state: 'failed', percent: 0, why: j.report || 'no try held its checks' };
  if (tryViews.every(v => v.state === 'stopped')) return { ...base, state: 'stopped', percent: 0, why: first.why };
  const waiting = tryViews.filter(v => v.state === 'waiting');
  if (waiting.length === tryViews.length) return { ...base, state: 'waiting', percent: 0, waitingOn: waiting[0].waitingOn, ...(waiting[0].blockedBy ? { blockedBy: waiting[0].blockedBy } : {}) };
  const percent = Math.min(99, Math.floor(tryViews.reduce((s, v) => s + (ENDED.has(v.state) ? 100 : v.percent || 0), 0) / tryViews.length));
  if (tryViews.every(v => ENDED.has(v.state))) return { ...base, state: 'checking', percent };
  return { ...base, state: 'running', percent };
}

/** Each try told what it is: one of N, judged by its checks (and the test it runs itself), the best one kept. */
function brief(t) {
  if (!t.trial) return '';
  const test = t.test ? ` and the test \`${t.test}\` passing — run exactly \`${t.test}\` yourself, as a command of its own in your folder (output redirections only: nothing piped or chained after it), as the last thing you do after your last change; the hub reads its exit code from that call` : '';
  return `## You are try ${t.trial.n} of ${t.trial.tries}\nThe same task is given to ${t.trial.tries - 1} other${t.trial.tries === 2 ? '' : 's'} at the same time, each in a folder of its own. `
    + `The hub keeps the best one, judged only mechanically: its checks holding${test}, then fewer failed calls, then fewer tokens and less time. Do the task well; there is nothing to win by hurrying.`;
}

let tieReviewer = null;
/** The hook a model review of a tie would use (the "mastermind"): fn({team, of, tied}) → a try id, or null to keep the cheaper. */
function onTie(fn) { tieReviewer = typeof fn === 'function' ? fn : null; }

/**
 * After a pass has read the board: judge each group whose tries have all ended, or whose wait after its first good try
 * is over (the laggards are stopped first). Returns true when anything was judged. A timer advances the team at a
 * pending deadline, so a try that never ends does not hold the team.
 */
async function judgeReady(team, views, { stopTask } = {}) {
  let judged = false;
  const g = groups(team);
  team.trials = team.trials || {};
  for (const [of, tasks] of Object.entries(g)) {
    const j = team.trials[of] = team.trials[of] || { tries: tasks.length };
    if (j.judgedAt) continue;
    const vs = tasks.map(t => views.find(v => v.id === t.id)).filter(Boolean);
    if (!j.firstDoneAt && vs.some(v => v.state === 'done')) j.firstDoneAt = new Date().toISOString();
    const waitMs = Math.max(1, Number(value('teams.triesWaitMin')) || 30) * 60e3;
    const over = j.firstDoneAt && Date.now() - Date.parse(j.firstDoneAt) >= waitMs;
    if (!vs.every(v => ENDED.has(v.state)) && !over) {
      if (j.firstDoneAt) timer(team.id, Date.parse(j.firstDoneAt) + waitMs - Date.now());
      continue;
    }
    for (const t of tasks) {
      const v = views.find(x => x.id === t.id);
      if (v && !ENDED.has(v.state)) {   // past the wait: stopped, and scored as not finished
        Object.assign(t, { stoppedAt: new Date().toISOString(), stoppedWhy: `stopped ${value('teams.triesWaitMin')} min after the first try whose checks held` });
        try { await stopTask?.(t); } catch { /* it ends at its next step */ }
        Object.assign(v, { state: 'stopped', why: t.stoppedWhy });
      }
    }
    await require('./tries-score').judge(team, of, tasks, vs, { reviewer: tieReviewer });
    judged = true;
  }
  return judged;
}

const _timers = new Map();
function timer(teamId, ms) {
  if (_timers.has(teamId)) return;
  const h = setTimeout(() => { _timers.delete(teamId); require('./engine').advance(teamId); }, Math.max(1000, ms) + 500);
  h.unref?.();
  _timers.set(teamId, h);
}

/** A person picks another try of a group: it becomes the kept one, on the record (tasks after it that started keep theirs). */
async function pick(teamId, of, n, { by = 'a person' } = {}) {
  const store = require('./store');
  const engine = require('./engine');
  let said = '', err = null;
  await engine.serial(teamId, async () => { try {
    const team = store.get(teamId);
    if (!team) throw bad(`No team called "${teamId}".`, 404);
    const j = team.trials?.[of];
    if (!j?.judgedAt) throw bad(`Task ${of} of this team has no tries judged yet.`, 409);
    const id = `${of}-try${Math.floor(Number(n))}`;
    const t = team.tasks.find(x => x.id === id);
    if (!t) throw bad(`Task ${of} has no try ${n}; it has ${j.tries}.`, 404);
    const score = (j.scores || []).find(s => s.id === id);
    if (!score?.finished) throw bad(`Try ${n} did not finish, so there is nothing of it to keep.`, 409);
    const was = j.winner;
    Object.assign(j, { winner: id, picked: { by, at: new Date().toISOString(), was: was || null } });
    for (const s of j.scores) s.kept = s.id === id;
    j.report = require('./tries-score').report(j);
    const started = team.tasks.filter(x => (x.after || []).includes(of) && (x.missionId || x.sessionId));
    try { if (t.missionId) require('../agents/missions').archive(t.missionId, { on: false }); } catch { /* not put away */ }
    store.save(team);
    said = `Try ${n} of ${of} is kept now${was ? ` (it was try ${SUFFIX.exec(was)?.[1]})` : ''}.`
      + (started.length ? ` ${started.map(x => x.id).join(', ')} already started from the try kept before; start them again to use this one.` : '');
    require('./announce').line(team, `${of}: ${by} kept try ${n} — ${j.report}`);
  } catch (e) { err = e; } });   // serial() swallows what throws: the refusal is the caller's to hear
  if (err) throw err;
  await engine.advance(teamId);
  return said;
}

/** Each judged group's report line, for the leader's report and the tool's status. */
function reports(team) {
  return Object.entries(team.trials || {}).filter(([, j]) => j.judgedAt).map(([of, j]) => `${of}: ${j.report}`);
}

module.exports = { expand, wanted, judged, judgeable, folder, groups, groupView, taskFor, brief, judgeReady, pick, reports, onTie, maxTries, HARD_MAX, ENDED };

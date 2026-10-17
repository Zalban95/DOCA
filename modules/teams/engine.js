'use strict';

/**
 * The board, carried forward by the hub (docs/design/teams.md): whenever a mission or a work chat of a team changes,
 * `advance(id)` reads every task's state (board.js), checks the contract of a task whose specialist finished, retries a
 * failed task when the team keeps going and has rounds left, dispatches every task whose dependencies are done — with
 * what those delivered (agents/after.js `handed`) — and then writes the board, the document and the announcements.
 * One advance at a time per team, so two missions finishing together never dispatch a task twice.
 */
const store = require('./store');
const board = require('./board');

const look = {
  mission: id => require('../agents/missions').get(id),
  session: id => require('../harness/memory').getSession(id),
  budget: agentId => (require('./outside').isOutside(agentId) ? null : require('../agents/registry').get(agentId)?.maxSteps || 30),   // an outside CLI has no step budget: its plan says how far
};
const views = team => board.tasks(team, look);
/** Work chats doing a team's task: the live feed's conversation changes are looked at only for these. */
const workChats = new Set();
const titleOf = team => id => { const t = team.tasks.find(x => x.id === id); return t ? `${t.id} "${t.title}"` : id; };
const keyOf = t => t.missionId || t.sessionId || (t.error ? 'dispatch' : null);
const maxRounds = team => (Number.isInteger(team.loop?.maxRounds) ? team.loop.maxRounds
  : require('../settings-schema').value('teams.maxRounds'));

/** Where a task's contract is read: its own worktree, the team's project (place.js), the leader's, else the workspace. */
function cwdOf(team, t) {
  const at = require('./place').cwdOf(team, t);
  if (at) return at;
  try { const p = require('../projects/store').forSession(team.by); if (p?.root) return p.root; } catch { /* no projects */ }
  return require('../harness/toolbox/common').workspace();
}

/** What a task's specialist is told about its team, besides its errand. */
function brief(team, t) {
  const others = team.tasks.filter(x => x.id !== t.id).map(x => `${x.id} "${x.title}" (${x.agent})`).join('; ');
  return [`## Your team\nYou are task ${t.id} of team "${team.title}" (${team.id}).${team.goal ? ` The team's goal: ${team.goal}` : ''}`,
    t.contract?.done ? `Your task is done when ${t.contract.done}${t.contract.check ? ' — the hub checks it when you finish' : ''}.` : '',
    require('./tries').brief(t),
    others && !require('./outside').isOutside(t.agent) ? `Your teammates: ${others}. If you find something they need (a path, a decision, a pitfall), post it with team_note — short, and only what helps them.` : others ? `Your teammates: ${others}.` : '',
  ].filter(Boolean).join('\n');
}

/** Send one task to its specialist (or a work chat), with what the tasks before it delivered, where it works (place.js). */
async function dispatch(team, t) {
  const missions = require('../agents/missions');
  const deps = (t.after || []).map(id => require('./tries').taskFor(team, id)).filter(Boolean);   // a task with tries: the one kept
  const delivered = deps.filter(d => d.missionId).map(d => missions.get(d.missionId)).filter(Boolean);
  const chats = deps.filter(d => d.sessionId).map(d => require('../harness/memory').getSession(d.sessionId)).filter(Boolean)
    .map(s => `### From the work chat "${s.title}"\n${String(s.brief || s.summary || '').slice(0, 4000)}`);
  const context = [brief(team, t), team.context ? `## Context from your leader\n${team.context}` : '', t.retryNote || '',
    delivered.length || chats.length ? `## What the tasks before yours delivered\n${[require('../agents/after').handed(delivered), ...chats].filter(Boolean).join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');
  try {
    if (require('./outside').isOutside(t.agent)) {   // an outside harness in its own computer, on a branch of its own (harness-teams/)
      if (!require('../harness-teams').room()) return;   // teams.outside.maxWorkers already at work: queued, dispatched when one ends
      const m = await require('../harness-teams').dispatch(team, t, { context });
      t.missionId = m.id;
      t.startedAt = new Date().toISOString();
      return;
    }
    const { fields, place } = await require('./place').forTask(team, t);
    if (t.trial && !place?.worktree) { t.error = `a try works in a worktree of its own, and none could be made${place?.why ? `: ${place.why}` : ''}`; return; }
    if (place) t.place = place;
    const where = place ? `\n\n## Where you work\n${place.worktree ? `In the project's git worktree ${place.worktree.path}, on the branch ${place.worktree.branch} — your own, so teammates working at the same time do not touch your files. Commit your work there; merging it back is the person's call.`
      + (place.from?.length ? ` It starts with the work of the tasks before yours: ${place.from.join(', ')}${place.from.length > 1 ? ', merged' : ''}.` : '')
      + (place.conflicts?.length ? ` These branches could not be merged in for you, because they change the same lines: ${place.conflicts.map(c => `${c.branch} (${c.files.join(', ') || 'files not named'})`).join('; ')}. Merge each first (\`git merge <branch>\`), keep what both meant, commit, then do your task.` : '')
      : `In the project's folder ${place.root}, shared with your teammates.${place.why ? ` (${place.why})` : ''}`}` : '';
    if (t.agent === 'work') {
      const org = require('../harness/organization');
      const s = org.create({ title: `${team.title}: ${t.title}`.slice(0, 100), ...org.under(team.by) });   // one level below the team's leader (org-depth.js)
      require('../harness/memory').updateSession(s.id, { team: { id: team.id, task: t.id }, ...(fields || {}) });
      org.start(s.id, `${t.task}\n\n${context}${where}`, team.by);
      t.sessionId = s.id;
      workChats.add(s.id);
    } else {
      const m = missions.dispatch({ agentId: t.agent, task: t.task, context: `${context}${where}`, by: team.by, place: fields });
      missions.patch(m.id, { team: { id: team.id, task: t.id, title: team.title } });
      t.missionId = m.id;
    }
    t.startedAt = new Date().toISOString();
    require('../activity').note({ from: 'teams', what: `started task ${t.id} "${t.title}" of team "${team.title}" (${t.missionId || t.sessionId})`,
      why: (t.after || []).length ? `the tasks it came after are done: ${t.after.join(', ')}` : 'the team was made', sessionId: team.by });
  } catch (e) { t.error = String(e.message || e).slice(0, 300); }
}

/** A failed task: tried again while the team keeps going and has rounds left; otherwise left failed. */
function failed(team, t, v) {
  const key = keyOf(t);
  if (t.failedFor === key) return;
  t.failedFor = key;
  if (t.trial) { t.gaveUp = true; return; }   // a try is not tried again on its own: its siblings are the retry (tries.js)
  // Its own contract unproven, not failed: sent back once to run its test, whether or not the team keeps going.
  if (t.verdict?.untested && !t.testAsked) return again(team, t, v, `## Run your test\nYour task is done when \`${t.test}\` passes, and the hub reads `
    + `your own run of it: ${t.verdict.test.why}. Run \`${t.test}\` as your last step, in the folder you work in — in the shell, or with the project tool's run — fix what fails, then finish.`, true);
  if (!team.loop?.on || (team.loop.rounds || 0) >= maxRounds(team)) { t.gaveUp = true; return; }
  team.loop.rounds = (team.loop.rounds || 0) + 1;
  again(team, t, v, `## Try ${(t.tries || []).length + 2}\nThe previous try at this task did not finish: ${v.why || 'it failed'}.`);
}

/** Back to its specialist, in the same place, with why and what the last try reported. */
function again(team, t, v, note, test = false) {
  const m = t.missionId ? require('../agents/missions').get(t.missionId) : null;
  (t.tries = t.tries || []).push({ missionId: t.missionId || null, sessionId: t.sessionId || null, why: v.why || null, at: new Date().toISOString() });
  t.retryNote = `${note}${m?.result ? `\nWhat it reported:\n${String(m.result).slice(0, 2000)}` : ''}\nDo not repeat what failed; finish the task.`;
  if (test) t.testAsked = true;
  for (const f of ['missionId', 'sessionId', 'verdict', 'error', 'gaveUp', 'failedFor']) delete t[f];
  require('./announce').line(team, test ? `${t.id} "${t.title}": sent back to run its test — ${t.test}`
    : `${t.id} "${t.title}": trying again (round ${team.loop.rounds} of ${maxRounds(team)}) — ${v.why || 'it failed'}`);
}

/** End one task's work now (a try past its wait): its mission at its next step, an outside CLI in its computer. */
async function stopTask(t) {
  if (require('./outside').isOutside(t.agent) && t.missionId) return require('../harness-teams').stopMission(t.missionId);
  const sid = t.missionId ? require('../agents/missions').get(t.missionId)?.sessionId : t.sessionId;
  if (sid) require('../harness/agent').cancel(sid);
}

/** One pass: check, retry, dispatch, decide the team's state, then say what changed. */
async function step(id) {
  const team = store.get(id);
  if (!team || team.archivedAt) return null;
  const before = new Map((team.lastViews || []).map(v => [v.id, v.state]));
  if (!team.stoppedAt) {
    for (const v of views(team)) {
      const t = team.tasks.find(x => x.id === v.id);
      if (v.state === 'checking' && !t.verdict) {
        // Work left uncommitted in its own worktree is committed on its branch first: the tasks after it start from
        // the branch, and a cheaper model often forgets the commit its errand asked for.
        if (t.place?.worktree?.path && !require('./outside').isOutside(t.agent)) {
          const n = await require('../projects/worktrees').commitLeft(t.place.worktree.path, `${t.id}: what the task "${t.title}" left uncommitted, committed by its team at its end`).catch(() => 0);
          if (n) require('./announce').line(team, `${t.id} "${t.title}": ${n} file${n === 1 ? '' : 's'} it left uncommitted committed on ${t.place.worktree.branch}`);
        }
        const sessionId = t.missionId ? require('../agents/missions').get(t.missionId)?.sessionId : t.sessionId;   // its test, as it ran it
        const at = t.trial ? require('./tries').folder(t) : { cwd: cwdOf(team, t) };   // a try: in its own worktree, never the project's folder
        const score = require('./tries-score');
        t.verdict = { ...(at.cwd ? await score.verifyAll(t, { cwd: at.cwd, sessionId }) : score.notJudged(t, at.why)), at: new Date().toISOString() };
        // A task that names a test is done when it passed — never run, or run before a later change, is not proof
        // (2026-10-17: four tasks were "done" with `npm test` never run). An outside harness keeps no exit codes to read.
        if (t.verdict.ok && t.verdict.test?.state === 'unknown' && !t.trial && !require('./outside').isOutside(t.agent))
          t.verdict = { ...t.verdict, ok: false, why: `${t.verdict.test.why} — the task is done when it passes`, untested: true };
      }
    }
    for (const v of views(team)) if (v.state === 'failed') failed(team, team.tasks.find(x => x.id === v.id), v);
    await require('./tries').judgeReady(team, views(team), { stopTask });   // tries all ended, or their wait is over: the best kept
    for (const v of views(team)) if (v.state === 'queued') await dispatch(team, team.tasks.find(x => x.id === v.id));
  }
  const now = views(team);
  const { state, progress } = board.summary(team, now);
  const ended = state !== 'running' && team.state === 'running';
  Object.assign(team, { state, progress, lastViews: now.map(v => ({ id: v.id, state: v.state })) });
  if (state === 'running') team.endedAt = null; else if (ended) team.endedAt = new Date().toISOString();
  // A note posted while this pass awaited (a contract's check, a worktree being made) is kept, not written over.
  const fresh = store.get(id);
  if ((fresh?.notes || []).length !== (team.notes || []).length) team.notes = fresh.notes;
  store.save(team);
  const changed = now.filter(v => before.get(v.id) !== v.state);
  require('./announce').changed(team, now, { changed, ended, title: titleOf(team) });
  return team;
}

const _chains = new Map();
/** Run `fn` for one team after whatever runs for it now: a pass, a stop, a switch — never two at once. */
function serial(id, fn) {
  const prev = _chains.get(id) || Promise.resolve();
  const next = prev.then(fn).catch(e => { console.warn(`[teams] ${id}: ${e.message}`); return null; });
  _chains.set(id, next);
  next.finally(() => { if (_chains.get(id) === next) _chains.delete(id); });
  return next;
}
/** Advance a team; calls for one team run one after another. */
const advance = id => serial(id, () => step(id));

module.exports = { advance, serial, views, dispatch, brief, look, maxRounds, workChats };

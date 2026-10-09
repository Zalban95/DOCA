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
  budget: agentId => require('../agents/registry').get(agentId)?.maxSteps || 30,
};
const views = team => board.tasks(team, look);
/** Work chats doing a team's task: the live feed's conversation changes are looked at only for these. */
const workChats = new Set();
const titleOf = team => id => { const t = team.tasks.find(x => x.id === id); return t ? `${t.id} "${t.title}"` : id; };
const keyOf = t => t.missionId || t.sessionId || (t.error ? 'dispatch' : null);
const maxRounds = team => (Number.isInteger(team.loop?.maxRounds) ? team.loop.maxRounds
  : require('../settings-schema').value('teams.maxRounds'));

/** Where a contract's paths are read from: the leader's project (or its worktree), else the agent's workspace. */
function cwdOf(team) {
  try { const p = require('../projects/store').forSession(team.by); if (p?.root) return p.root; } catch { /* no projects */ }
  return require('../harness/toolbox/common').workspace();
}

/** What a task's specialist is told about its team, besides its errand. */
function brief(team, t) {
  const others = team.tasks.filter(x => x.id !== t.id).map(x => `${x.id} "${x.title}" (${x.agent})`).join('; ');
  return [`## Your team\nYou are task ${t.id} of team "${team.title}" (${team.id}).${team.goal ? ` The team's goal: ${team.goal}` : ''}`,
    t.contract?.done ? `Your task is done when ${t.contract.done}${t.contract.check ? ' — the hub checks it when you finish' : ''}.` : '',
    others ? `Your teammates: ${others}. If you find something they need (a path, a decision, a pitfall), post it with team_note — short, and only what helps them.` : '',
  ].filter(Boolean).join('\n');
}

/** Send one task to its specialist (or a work chat), with what the tasks before it delivered. */
function dispatch(team, t) {
  const missions = require('../agents/missions');
  const deps = (t.after || []).map(id => team.tasks.find(x => x.id === id)).filter(Boolean);
  const delivered = deps.filter(d => d.missionId).map(d => missions.get(d.missionId)).filter(Boolean);
  const chats = deps.filter(d => d.sessionId).map(d => require('../harness/memory').getSession(d.sessionId)).filter(Boolean)
    .map(s => `### From the work chat "${s.title}"\n${String(s.brief || s.summary || '').slice(0, 4000)}`);
  const context = [brief(team, t), team.context ? `## Context from your leader\n${team.context}` : '', t.retryNote || '',
    delivered.length || chats.length ? `## What the tasks before yours delivered\n${[require('../agents/after').handed(delivered), ...chats].filter(Boolean).join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');
  try {
    if (t.agent === 'work') {
      const org = require('../harness/organization');
      const s = org.create({ title: `${team.title}: ${t.title}`.slice(0, 100) });
      require('../harness/memory').updateSession(s.id, { team: { id: team.id, task: t.id } });
      org.start(s.id, `${t.task}\n\n${context}`, team.by);
      t.sessionId = s.id;
      workChats.add(s.id);
    } else {
      const m = missions.dispatch({ agentId: t.agent, task: t.task, context, by: team.by });
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
  if (!team.loop?.on || (team.loop.rounds || 0) >= maxRounds(team)) { t.gaveUp = true; return; }
  team.loop.rounds = (team.loop.rounds || 0) + 1;
  const m = t.missionId ? require('../agents/missions').get(t.missionId) : null;
  (t.tries = t.tries || []).push({ missionId: t.missionId || null, sessionId: t.sessionId || null, why: v.why || null, at: new Date().toISOString() });
  t.retryNote = `## Try ${t.tries.length + 1}\nThe previous try at this task did not finish: ${v.why || 'it failed'}.`
    + `${m?.result ? `\nWhat it reported:\n${String(m.result).slice(0, 2000)}` : ''}\nDo not repeat what failed; finish the task.`;
  for (const f of ['missionId', 'sessionId', 'verdict', 'error', 'gaveUp']) delete t[f];
  require('./announce').line(team, `${t.id} "${t.title}": trying again (round ${team.loop.rounds} of ${maxRounds(team)}) — ${v.why || 'it failed'}`);
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
        t.verdict = { ...(await require('../harness/plan-contracts').verify(t.contract, { cwd: cwdOf(team) })), at: new Date().toISOString() };
      }
    }
    for (const v of views(team)) if (v.state === 'failed') failed(team, team.tasks.find(x => x.id === v.id), v);
    for (const v of views(team)) if (v.state === 'queued') dispatch(team, team.tasks.find(x => x.id === v.id));
  }
  const now = views(team);
  const { state, progress } = board.summary(team, now);
  const ended = state !== 'running' && team.state === 'running';
  Object.assign(team, { state, progress, lastViews: now.map(v => ({ id: v.id, state: v.state })) });
  if (state === 'running') team.endedAt = null; else if (ended) team.endedAt = new Date().toISOString();
  store.save(team);
  const changed = now.filter(v => before.get(v.id) !== v.state);
  require('./announce').changed(team, now, { changed, ended, title: titleOf(team) });
  return team;
}

const _chains = new Map();
/** Advance a team; calls for one team run one after another. */
function advance(id) {
  const prev = _chains.get(id) || Promise.resolve();
  const next = prev.then(() => step(id)).catch(e => { console.warn(`[teams] ${id}: ${e.message}`); return null; });
  _chains.set(id, next);
  next.finally(() => { if (_chains.get(id) === next) _chains.delete(id); });
  return next;
}

module.exports = { advance, views, dispatch, brief, look, maxRounds, workChats };

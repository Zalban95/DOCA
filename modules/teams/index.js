'use strict';

/**
 * Teams (asked 2026-10-09; docs/design/teams.md): a plan whose steps are tasks given to specialists (or a work chat),
 * with `after` dependencies between them and a contract each ("done when …"). The Orchestrator or a work chat makes one
 * with one call (`team create`); the hub then dispatches each task as the tasks it comes after are done (engine.js),
 * checks each contract when its specialist finishes, and keeps a living document (doc.js). Progress is mechanical
 * (board.js). Specialists in a team may post short findings for each other (`team_note`) — read by their teammates as
 * a teammate's words, never as instructions. A team may keep going: a failed task is tried again, up to a number of
 * rounds, until every contract holds, the person stops it, or the rounds run out.
 *
 * Built on what exists: missions (agents/missions.js), their `after` hand-over (agents/after.js), plan contracts
 * (harness/plan-contracts.js), the live feed, `agent.mission`'s audience. A team never dispatches below a specialist:
 * `team` is a leader's tool (registry NEVER), and a specialist cannot create one (missions.dispatch refuses it too).
 */
const store = require('./store');
const engine = require('./engine');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const MAX_TASKS = 12, NOTE_MAX = 400, NOTES_KEEP = 60, NOTES_PER_TRY = 8;

/** Check what the leader asked for, and shape it into tasks. Throws a sentence that says what to fix. */
function shape({ title, goal, tasks, context } = {}, { workChats = false, project = false } = {}) {   // workChats: its leader may make work chats (harness/org-depth.js)
  if (!String(title || '').trim()) throw bad('A team needs a title.');
  if (!Array.isArray(tasks) || !tasks.length) throw bad('A team needs at least one task.');
  const both = tasks.find(t => Number(t?.count) > 1 && Number(t?.tries) > 1);
  if (both) throw bad(`Task ${both.id || ''}: count makes several workers share a plan; tries makes several attempts at one task and keeps the best. Use one.`.replace('  ', ' '));
  tasks = require('./outside').expand(tasks);   // count: several alike (an outside harness's "5 on Opus")
  if (tasks.length > MAX_TASKS) throw bad(`A team has at most ${MAX_TASKS} tasks; split the work into two teams, or give one task more.`);
  tasks = require('./tries').expand(tasks, { project });   // tries: several attempts at one task, the best kept (tries.js)
  if (tasks.length > MAX_TASKS * 2) throw bad(`A team runs at most ${MAX_TASKS * 2} tasks and tries together; ask for fewer tries.`);
  const registry = require('../agents/registry');
  const out = tasks.map((t, i) => {
    const id = String(t?.id || `t${i + 1}`).trim().slice(0, 20);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) throw bad(`Task ids are letters, digits, _ and - ("${id}").`);
    const agent = String(t?.agent || '').trim();
    let extra = {};
    if (agent === 'work') { if (!workChats) throw bad(`Task ${id}: only the Orchestrator and a project's chats give a task to a work chat; give it to a specialist.`); }
    else if (require('./outside').isOutside(agent)) extra = require('./outside').check(id, t);   // an outside harness (outside.js)
    else {
      const def = registry.get(agent);
      if (!def || def.broken) throw bad(`Task ${id}: no specialist called "${agent}". Available: ${registry.list().filter(a => !a.broken).map(a => a.id).join(', ') || 'none'}${workChats ? ', or "work" for a work chat' : ''}.`);
    }
    const text = String(t?.task || '').trim();
    if (!text) throw bad(`Task ${id} needs its errand in "task", written for somebody who was not in this conversation.`);
    const pc = require('../harness/plan-contracts');
    const { contract } = pc.split({ title: String(t.title || text.slice(0, 60)), done: t.done, check: t.check });
    if (t.checks != null && (!Array.isArray(t.checks) || t.checks.length > 8)) throw bad(`Task ${id}: checks is a list of up to 8 checks.`);
    const checks = (t.checks || []).map(c => pc.split({ title: 'check', check: c }).contract.check);   // more checks, every one held (tries-score.js)
    const test = t.test != null ? String(t.test).trim().slice(0, 300) : '';
    return { id, title: String(t.title || text).replace(/\s+/g, ' ').trim().slice(0, 80), agent, task: text.slice(0, 8000),
      after: [...new Set((Array.isArray(t.after) ? t.after : []).map(String))], contract, ...(extra.model ? { model: extra.model } : {}),
      ...(checks.length ? { checks } : {}), ...(test ? { test } : {}), ...(t.trial ? { trial: t.trial } : {}),
      ...(typeof t.worktree === 'boolean' ? { worktree: t.worktree } : {}) };   // its own worktree, or the shared folder (place.js)
  });
  const taskIds = new Set(out.map(t => t.id));
  if (taskIds.size !== out.length) throw bad('Two tasks have the same id.');
  // A task with tries is named by its own id: `after: ["t1"]` waits for the try that is kept (tries.js).
  const groupOf = new Map();
  for (const t of out) if (t.trial) groupOf.set(t.trial.of, [...(groupOf.get(t.trial.of) || []), t.id]);
  const ids = new Set([...taskIds, ...groupOf.keys()]);
  // `after` names a task by its id; a title, or a word only one title holds, means that task too (the 2026-10-14 demo: a
  // model wrote after: ["text"] four times for the task titled "Improve the page's text", and ran out of steps).
  const low = v => String(v).trim().toLowerCase();
  const idOf = a => {
    if (ids.has(a)) return a;
    const exact = out.filter(x => !x.trial && low(x.title) === low(a));
    if (exact.length === 1) return exact[0].id;
    const within = out.filter(x => !x.trial && low(a) && low(x.title).includes(low(a)));
    return within.length === 1 ? within[0].id : null;
  };
  const named = out.map(x => `${x.id} "${x.title}"`).join(', ');
  for (const t of out) t.after = [...new Set(t.after.map(a => idOf(a) || a))];
  for (const t of out) for (const a of t.after) {
    if (!ids.has(a)) throw bad(`Task ${t.id} comes after "${a}", which is not a task of this team. Name one by its id: ${named}.`);
    if (a === t.id || a === t.trial?.of) throw bad(`Task ${t.id} cannot come after itself.`);
  }
  // No cycles: every task must be reachable by finishing the ones before it.
  const done = new Set();
  const met = a => (groupOf.has(a) ? groupOf.get(a).every(x => done.has(x)) : done.has(a));
  for (let changed = true; changed;) { changed = false; for (const t of out) if (!done.has(t.id) && t.after.every(met)) { done.add(t.id); changed = true; } }
  if (done.size !== out.length) throw bad(`These tasks wait on each other in a circle: ${out.filter(t => !done.has(t.id)).map(t => t.id).join(', ')}.`);
  return { title: String(title).trim().slice(0, 120), goal: String(goal || '').trim().slice(0, 1000), context: String(context || '').slice(0, 20000), tasks: out };
}

/** Make a team led by conversation `by`, and start every task with nothing before it. */
async function create(args, { by, keepGoing = false, maxRounds = null, asked = false, person = null } = {}) {   // asked: the person named an outside harness (outside.js)
  const org = require('../harness/organization');
  const no = org.mayCreate(by, 'team');   // the depth rule (harness/org-depth.js): level 3 makes no team
  if (no) throw bad(no, 403);
  // The project it works on (place.js): named, else the one its leading conversation works in.
  const project = require('./place').resolve(args.project, by);
  const shaped = shape(args, { workChats: !org.mayCreate(by, 'work'), project: !!project });
  if (shaped.tasks.some(t => t.trial)) {   // tries each work in a worktree (or a computer) of their own, so a git project
    if (!project) throw bad('Tries each work in a git worktree of their own: name the project they work on (project: <name>).');
    const root = require('./place').rootOf({ projectId: project.id, by }) || project.root;
    if (!require('fs').existsSync(require('path').join(root, '.git'))) throw bad(`Tries each work in a git worktree of their own, and the project ${project.name} is not a git repository.`);
  }
  const started = require('./outside').gate(shaped.tasks, { asked, person, project, by });   // 'asked', 'free' (its switch) or null
  if (shaped.tasks.some(t => t.agent !== 'work' && !require('./outside').isOutside(t.agent)) && !require('../agents/registry').enabled())
    throw require('../agents/off')('Specialist agents are switched off (agents.enabled). Ask the person to turn them on.');
  const rounds = maxRounds == null ? null : Math.max(0, Math.min(20, Math.floor(Number(maxRounds)) || 0));
  const team = { id: store.newId(), ...shaped, by, projectId: project?.id || null, state: 'running', createdAt: new Date().toISOString(), endedAt: null,
    loop: { on: !!keepGoing, rounds: 0, ...(rounds == null ? {} : { maxRounds: rounds }) }, notes: [], ...(started ? { outsideBy: started } : {}) };
  store.save(team);
  listen();
  require('./announce').line(team, `made${project ? ` in the project ${project.name}` : ''} with ${team.tasks.length} task${team.tasks.length === 1 ? '' : 's'}: ${team.tasks.map(t => `${t.id} ${t.agent}${t.after.length ? ` after ${t.after.join(', ')}` : ''}`).join('; ')}`);
  if (started === 'free') require('../activity').note({ from: 'teams', sessionId: by, what: `the Orchestrator started ${[...new Set(team.tasks.filter(t => require('./outside').isOutside(t.agent)).map(t => t.agent))].join(', ')} on its own for team "${team.title}"`,
    why: 'its switch is "On its own" (Settings → Harnesses → CLI harnesses → On a team)' });
  return engine.advance(team.id);
}

/** The board as every reader draws it. */
function view(team) {
  if (!team) return null;
  const views = engine.views(team);
  const { notes = [], lastViews, ...rest } = team;
  const project = team.projectId ? require('../projects/store').get(team.projectId) : null;
  return { ...rest, progress: team.progress || require('./board').summary(team, views).progress, maxRounds: engine.maxRounds(team),
    tasks: views, notes: notes.slice(-30), members: require('./members').members(team, views),
    project: project ? { id: project.id, name: project.name, root: project.root } : null };
}

/** Stop every task: running missions and work chats at their next step, the rest never start. */
async function stop(id, { why = 'stopped by a person' } = {}) {
  const team = store.get(id);
  if (!team) throw bad(`No team called "${id}".`, 404);
  if (team.state !== 'running') return view(team);
  const agent = require('../harness/agent');
  // Under the team's own turn: a pass that is making a worktree or checking a contract finishes first, then this.
  await engine.serial(id, () => {
    const team = store.get(id);
    for (const t of team.tasks) {
      const v = engine.views(team).find(x => x.id === t.id);
      if (['done', 'failed', 'stopped'].includes(v.state)) continue;
      const sid = t.missionId ? require('../agents/missions').get(t.missionId)?.sessionId : t.sessionId;
      if (require('./outside').isOutside(t.agent) && t.missionId) require('../harness-teams').stopMission(t.missionId).catch(() => {});   // its CLI in its computer
      else if (sid) try { agent.cancel(sid); } catch { /* already ended */ }
      if (t.sessionId) { const s = require('../harness/memory').getSession(t.sessionId); if (s?.job) require('../harness/memory').updateSession(t.sessionId, { job: { ...s.job, state: 'stopped', stoppedWhy: why } }); }
      Object.assign(t, { stoppedAt: new Date().toISOString(), stoppedWhy: why });
    }
    Object.assign(team, { stoppedAt: new Date().toISOString(), stoppedWhy: why, loop: { ...team.loop, on: false } });
    store.save(team);
  });
  require('./announce').line(team, `stopped — ${why}`);
  return view(await engine.advance(id));
}

/** The team's own "keep going" switch: on, a failed task is tried again until every contract holds or rounds run out. */
async function keepGoing(id, on) {
  const team = store.get(id);
  if (!team) throw bad(`No team called "${id}".`, 404);
  if (team.stoppedAt && on) throw bad('This team was stopped. Make a new one to carry on.', 409);
  let again = [];
  await engine.serial(id, () => {
    const team = store.get(id);
    team.loop = { ...(team.loop || {}), on: !!on };
    // Turned on after a task already gave up: it is tried again now.
    if (on) for (const t of team.tasks) if (t.gaveUp && !t.trial) { delete t.gaveUp; delete t.failedFor; }
    again = on ? require('./tries').again(team) : [];   // tries none of which held: started once more, on this ask only
    store.save(team);
  });
  require('./announce').line(team, `keep going ${on ? `on — failed tasks are tried again, up to ${engine.maxRounds(team)} rounds${again.length ? `; the tries of ${again.join(', ')} start again` : ''}` : 'off'}`);
  return view(await engine.advance(id));
}

function archive(id, on = true) {
  const team = store.get(id);
  if (!team) throw bad(`No team called "${id}".`, 404);
  if (on && team.state === 'running') throw bad('This team is still working. Stop it first, or wait for it to finish.', 409);
  team.archivedAt = on ? new Date().toISOString() : null;
  if (!on) team.putAwayBy = 'person';   // brought back: the tidy-up leaves it alone after that (tidy.js)
  store.save(team);
  require('./announce').devices(team, engine.views(team), { quiet: true });
  require('../live').changed('teams', team.id, on ? 'archived' : 'recalled', { sessionId: team.by });
  return view(team);
}

/** The team a mission works for: { team, task } or null. */
function forMission(missionId) {
  const m = missionId ? require('../agents/missions').get(missionId) : null;
  const team = m?.team?.id ? store.get(m.team.id) : null;
  const task = team?.tasks.find(t => t.id === m.team.task && t.missionId === missionId);
  return task ? { team, task, mission: m } : null;
}

/** A specialist's finding, for its teammates (the `team_note` tool). Kept short; read as its words, never as orders. */
function note(missionId, text) {
  const found = forMission(missionId);
  if (!found) throw bad('This mission is not on a team, so it has no teammates to tell.', 409);
  const { team, task, mission } = found;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw bad('A note needs its text.');
  if (team.state !== 'running') throw bad(`The team is ${team.state}; nobody is left to read it.`, 409);
  const mine = (team.notes || []).filter(n => n.missionId === missionId).length;
  if (mine >= NOTES_PER_TRY) throw bad(`You have posted ${NOTES_PER_TRY} notes on this task; put the rest in your report.`, 429);
  const row = { at: new Date().toISOString(), task: task.id, missionId, from: mission.label || mission.agentId, text: clean.slice(0, NOTE_MAX), cut: clean.length > NOTE_MAX || undefined };
  team.notes = [...(team.notes || []), row].slice(-NOTES_KEEP);
  store.save(team);
  require('./announce').line(team, `${task.id} ${row.from} noted: ${row.text.slice(0, 160)}`);
  require('./announce').changed(team, engine.views(team), { force: true });
  return row;
}

/** Every team whose leader this person may open (session-access, the transcript's own rule). */
function visible(person, { all = false, project = null } = {}) {
  const access = require('../harness/session-access');
  // A team made before teams named their project counts for the project its leader works in.
  const projectOf = r => r.projectId || (() => { try { return require('../projects/store').forSession(r.by)?.id || null; } catch { return null; } })();
  return store.list({ all }).filter(r => !project || projectOf(r) === project).filter(r => { try { return access.mayUse(person, r.by); } catch { return false; } });
}

/** The teams one conversation leads — running ones, and any that ended in the last hour. */
function ledBy(sessionId) {
  const hour = Date.now() - 3600e3;
  return store.list({ by: sessionId }).filter(r => r.state === 'running' || Date.parse(r.endedAt || 0) > hour).map(r => store.get(r.id)).filter(Boolean);
}

/** Missions and work chats change on the live feed; each change advances the team it belongs to. */
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  const live = require('../live');
  live.feed.on('change', c => {
    try {
      if (c.topic === 'missions') {
        const m = require('../agents/missions').get(c.id);
        if (m?.team?.id) engine.advance(m.team.id);
      } else if (c.topic === 'conversation' && engine.workChats.has(c.id) && (c.what === 'row' || c.what === 'ended' || c.what === 'started')) {
        const s = require('../harness/memory').getSession(c.id);
        if (s?.team?.id && s.kind === 'work') engine.advance(s.team.id);
      }
    } catch { /* a team's bookkeeping never breaks what it listens to */ }
  });
  // After a restart: carry on every team that was running (its missions carry on by themselves, agents/carry-on.js).
  for (const r of store.list().filter(x => x.state === 'running')) {
    for (const t of store.get(r.id)?.tasks || []) if (t.sessionId) engine.workChats.add(t.sessionId);
    engine.advance(r.id);
  }
}

module.exports = { create, view, stop, keepGoing, archive, note, forMission, visible, ledBy, listen, get: store.get, list: store.list,
  shape, advance: engine.advance, MAX_TASKS, NOTE_MAX };

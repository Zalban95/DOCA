'use strict';

/**
 * Where a team's tasks work (asked 2026-10-09: "can teams work on the project?"). A team is bound to a project — the
 * one its leading conversation works in, or one named with `team create {project}` — and every task's mission (or work
 * chat) works there: reading tasks share the project's folder; a task that writes, while another writing task of the
 * team could run at the same time, gets a git worktree of its own on the branch `team/<slug>/<task>`
 * (projects/worktrees.js), so parallel specialists never edit each other's files. Mechanical: whether a task writes is
 * read from its specialist's kits and tools; whether two may run at once from the board's `after` chains. A task may
 * also say `worktree: true | false` itself. Merging a branch back is the person's call, as for any worktree.
 */
const fs = require('fs');

const WRITING_KITS = new Set(['files', 'code', 'shell']);
const WRITING_TOOLS = new Set(['write_file', 'replace_in_files', 'shell', 'shell_job', 'git']);

/** The project a team names: by id or name (not one put away); null for none. Throws a sentence for a wrong name. */
function resolve(project, leaderId) {
  const projects = require('../projects/store');
  if (project != null && String(project).trim()) {
    const want = String(project).trim();
    const p = projects.get(want) || projects.list().find(x => !x.archivedAt && x.name.toLowerCase() === want.toLowerCase());
    if (!p || p.archivedAt) throw Object.assign(new Error(`No project called "${want}". Projects: ${projects.list().filter(x => !x.archivedAt).map(x => x.name).join(', ') || 'none'}.`), { status: 404 });
    return p;
  }
  try { const p = projects.forSession(leaderId); return p ? projects.get(p.id) : null; } catch { return null; }
}

/** Whether a task's agent changes files: a work chat always; a specialist by its kits and tools. */
function writes(agentId) {
  if (agentId === 'work') return true;
  const def = require('../agents/registry').get(agentId);
  if (!def) return false;
  return (def.kits || []).some(k => k === '*' || WRITING_KITS.has(k)) || (def.tools || []).some(t => WRITING_TOOLS.has(t));
}

/** Every task this one comes after, directly or through others. */
function before(team, id, seen = new Set()) {
  for (const a of team.tasks.find(t => t.id === id)?.after || []) if (!seen.has(a)) { seen.add(a); before(team, a, seen); }
  return seen;
}

/** Whether a task gets its own worktree: asked for, or a writer that another writer could run beside. */
function wantsWorktree(team, t) {
  if (t.worktree === true || t.worktree === false) return t.worktree;
  if (!writes(t.agent)) return false;
  const mine = before(team, t.id);
  return team.tasks.some(o => o.id !== t.id && writes(o.agent) && !mine.has(o.id) && !before(team, o.id).has(t.id));
}

/** The project's folder for the team: the leader's worktree when it works in one of this project, else the root. */
function rootOf(team) {
  const projects = require('../projects/store');
  const p = team.projectId ? projects.get(team.projectId) : null;
  if (!p) return null;
  const lead = (() => { try { return projects.forSession(team.by); } catch { return null; } })();
  return lead?.id === p.id ? lead.root : p.root;
}

/**
 * Where one task works, decided as it is dispatched: `{fields, place}` — `fields` for its conversation (projectId,
 * worktree), `place` kept on the task for the board (root, branch). A retry keeps the worktree it had.
 */
async function forTask(team, t) {
  const p = team.projectId ? require('../projects/store').get(team.projectId) : null;
  if (!p) return { fields: null, place: null };
  const root = rootOf(team) || p.root;
  // A leader working in this project passes it down the chain (its worktree too); otherwise the task is bound to it.
  const inherits = (() => { try { return require('../projects/store').forSession(team.by)?.id === p.id; } catch { return false; } })();
  const fields = inherits ? {} : { projectId: p.id };
  if (t.place?.worktree && fs.existsSync(t.place.worktree.path)) return { fields: { projectId: p.id, worktree: t.place.worktree }, place: t.place };
  if (wantsWorktree(team, t)) {
    try {
      // After a task that worked in a worktree, start from its branch: what it made is there, not in the root yet.
      const dep = (t.after || []).map(id => team.tasks.find(x => x.id === id)?.place?.worktree).find(Boolean);
      const wt = await require('../projects/worktrees').add(root, { branch: `team/${require('./doc').slug(team.title)}/${t.id}`, base: dep?.branch || null });
      return { fields: { projectId: p.id, worktree: wt }, place: { root: wt.path, worktree: wt } };
    } catch (e) {
      return { fields: fields.projectId ? fields : null, place: { root, shared: true, why: `no worktree of its own: ${String(e.message || e).slice(0, 160)}` } };
    }
  }
  return { fields: fields.projectId ? fields : null, place: { root, shared: true } };
}

/** The folder a task's contract is read in: its own worktree, the project's folder, else null (the caller's default). */
function cwdOf(team, t) {
  if (t?.place?.root && fs.existsSync(t.place.root)) return t.place.root;
  return rootOf(team);
}

module.exports = { resolve, writes, wantsWorktree, forTask, cwdOf, rootOf };

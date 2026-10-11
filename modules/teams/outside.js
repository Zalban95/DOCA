'use strict';

/**
 * Tasks for an outside harness on a team (harness-teams/; asked 2026-10-12): `agent: "harness:<catalog id>"`, with an
 * optional `model` (that CLI's own model id) and `count` (several alike: "5 Claude Code on Opus" is one task with count
 * 5, made into five tasks t-1 … t-5 that share the plan). A team is DOCA's own specialists and work chats by default; a
 * harness is used only when the person named it in their request — `team create {asked: true}` on that person's own
 * turn (turn/tool-calls.js byPerson) — and only by someone holding host, since the worker runs another vendor's agent
 * with its approvals off (inside its own computer) on the hub's keys. A mission, an automatic turn or a specialist never
 * adds one: the gate below refuses, whatever the prompt said.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const PREFIX = 'harness:';
const MAX_COUNT = 8;

const isOutside = agent => String(agent || '').startsWith(PREFIX);

/** `count` made into that many tasks; a task coming after the counted one comes after every copy of it. */
function expand(tasks = []) {
  const copies = new Map();
  const out = [];
  tasks.forEach((t, i) => {
    const n = Math.floor(Number(t?.count) || 1);
    if (n < 1 || n > MAX_COUNT) throw bad(`Task ${t?.id || `t${i + 1}`}: count is 1 to ${MAX_COUNT}.`);
    if (n === 1) { out.push(t); return; }
    const id = String(t.id || `t${i + 1}`);
    const ids = Array.from({ length: n }, (_, k) => `${id}-${k + 1}`);
    copies.set(id, ids);
    ids.forEach((cid, k) => out.push({ ...t, id: cid, count: undefined, title: `${t.title || String(t.task || '').slice(0, 50)} (${k + 1}/${n})` }));
  });
  return out.map(t => (Array.isArray(t.after) ? { ...t, after: t.after.flatMap(a => copies.get(String(a)) || [a]) } : t));
}

/** Check one `harness:` task's agent and model; the model id stays on the task. Throws a sentence. */
function check(id, t) {
  const harnesses = require('../harness-teams/harnesses');
  const row = harnesses.find(String(t.agent).slice(PREFIX.length));   // offered and allowed, or a sentence naming what is
  try { harnesses.argv(row, { task: 'x', model: t.model || null }); } catch (e) { throw bad(`Task ${id}: ${e.message}`); }
  return { model: t.model ? String(t.model) : null };
}

/** The person's ask, their right, and a project with git: every `harness:` task needs all three. */
function gate(tasks, { asked = false, person = null, project = null } = {}) {
  const outside = tasks.filter(t => isOutside(t.agent));
  if (!outside.length) return;
  const names = [...new Set(outside.map(t => t.agent))].join(', ');
  if (!asked) throw bad(`${names}: a team uses an outside harness only when the person asked for it in their request (name it, and call team create with asked: true on their turn). Otherwise give the task to a specialist or a work chat.`, 403);
  if (person?.id && !require('../auth/rights').can(person.role, 'host')) throw bad(`${names}: summoning another vendor's agent onto the hub's computers and keys is an admin's; ${person.name || 'this person'} does not hold host.`, 403);
  if (!project) throw bad(`${names}: an outside harness works on a project and comes back as a git branch — name the project (project: <name>).`);
}

module.exports = { isOutside, expand, check, gate, PREFIX, MAX_COUNT };

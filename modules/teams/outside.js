'use strict';

/**
 * Tasks for an outside harness on a team (harness-teams/; asked 2026-10-12): `agent: "harness:<catalog id>"`, with an
 * optional `model` (that CLI's own model id) and `count` (several alike: "5 Claude Code on Opus" is one task with count
 * 5, made into five tasks t-1 … t-5 that share the plan). A team is DOCA's own specialists and work chats by default; a
 * harness is used only when the person named it in their request (or said yes to the Orchestrator's offer of it) —
 * `team create {asked: true}` on that person's own turn (turn/tool-calls.js byPerson) — or, with no ask, when the
 * owner set its switch to "On its own" (teams.outside.use, harness-teams/harnesses.js mode); and only by someone holding host, since the worker runs another vendor's agent
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

/** The person who owns conversation `by` (up its chain), as they are now — null when nobody does or they are gone. */
function ownerPerson(by) {
  const id = by ? require('../harness/session-access').ownerOf(by) : null;
  if (!id) return null;
  return require('../harness/turn/client').personById({ id, orgId: require('../auth/store').defaultOrg()?.id });
}

/**
 * The person's ask (or the harness's own switch at "On its own"), their right, and a project with git: every `harness:`
 * task needs all three. Returns how it was started — 'asked', 'free' (no ask: every one of them is free) or null.
 */
function gate(tasks, { asked = false, person = null, project = null, by = null } = {}) {
  const outside = tasks.filter(t => isOutside(t.agent));
  if (!outside.length) return null;
  const names = [...new Set(outside.map(t => t.agent))].join(', ');
  const harnesses = require('../harness-teams/harnesses');
  const rowOf = t => harnesses.all().find(r => r.id === String(t.agent).slice(PREFIX.length));
  const unfree = outside.filter(t => { const r = rowOf(t); return !r || harnesses.mode(r) !== 'free'; });
  if (!asked && unfree.length) throw bad(`${[...new Set(unfree.map(t => t.agent))].join(', ')}: a team uses an outside harness only when the person asked for it in their request (name it, or say yes to your offer of it, and call team create with asked: true on their turn) — or when its switch is "On its own". Otherwise give the task to a specialist or a work chat.`, 403);
  const who = person?.id ? person : ownerPerson(by);   // an automatic turn (a wake, a woken work chat) answers for its conversation's owner
  if (!who) throw bad(`${names}: summoning another vendor's agent onto the hub's computers and keys is an admin's, and nobody owns this conversation to answer for it.`, 403);
  if (!require('../auth/rights').can(who.role, 'host')) throw bad(`${names}: summoning another vendor's agent onto the hub's computers and keys is an admin's; ${who.name || 'this person'} does not hold host.`, 403);
  if (!project) throw bad(`${names}: an outside harness works on a project and comes back as a git branch — name the project (project: <name>).`);
  return asked ? 'asked' : 'free';
}

module.exports = { isOutside, expand, check, gate, ownerPerson, PREFIX, MAX_COUNT };

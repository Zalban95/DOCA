'use strict';

/**
 * Permission levels (docs/design/permissions.md §2): what a person may do, and
 * so what the agent may do for them. The four phase-1 roles are the built-in
 * levels, unchanged in what they grant; an admin adds levels of their own.
 *
 * A level is:
 *   rights    the route rights (rights.js): read, chat, propose, host, devices,
 *             users, org — and `delegate`, which lets its holder make exceptions
 *             for others of their level or below (grants)
 *   settings  the settings prefixes its holders may change or apply ('*' = all)
 *   tools     { allow, deny } tool patterns for the agent acting for them:
 *             'shell', 'shell:git', 'mcp__*', '*' — deny wins
 *   approval  'mode' (follow the panel's Auto/Manual) or 'ask' (always ask)
 *   resources what its people's agents may use beyond tools — models, providers, keys, accounts, computers (allot.js)
 *   delegates with `delegate`: which permissions its holders may give (patterns, e.g. use:model:*); none listed = any
 *             they hold — a team leader allots only what this names (permits.mayGrant)
 *   approveDevices  which new devices its holders may approve: none | own | anyone (approve-devices.js)
 *   people    whom its holders may message in the hive chat: org | team | added (people/policy.js; none = by its rights)
 *
 * Built-ins live in code and cannot be edited or removed — every install has
 * them and the gate's meaning of "admin" must not drift. Custom levels are rows
 * in the `levels` table (SQLite) and can be changed by anyone holding `users`,
 * but never to grant more than the person changing them holds.
 */
const RIGHTS = ['read', 'chat', 'propose', 'host', 'devices', 'users', 'org', 'delegate'];

const BUILTIN = {
  viewer: { name: 'Viewer', rights: ['read'], settings: [], tools: { allow: [], deny: ['*'] }, approval: 'ask', approveDevices: 'none' },
  member: { name: 'Member', rights: ['read', 'chat'], settings: [], tools: { allow: ['*'], deny: [] }, approval: 'ask', reach: 'own-devices', approveDevices: 'own' },
  admin:  { name: 'Admin', rights: ['read', 'chat', 'propose', 'host', 'devices', 'users', 'delegate'], settings: ['*'], tools: { allow: ['*'], deny: [] }, approval: 'mode', approveDevices: 'anyone' },
  owner:  { name: 'Main admin', rights: ['read', 'chat', 'propose', 'host', 'devices', 'users', 'org', 'delegate'], settings: ['*'], tools: { allow: ['*'], deny: [] }, approval: 'mode', approveDevices: 'anyone' },
};

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const raw = () => require('../db').syncHandle();   // null with PostgreSQL: built-ins only until its async path
const view = (id, l, builtin) => ({ id, builtin, ...l });

function list() {
  const out = Object.entries(BUILTIN).map(([id, l]) => view(id, l, true));
  const r = raw();
  if (r) for (const row of r.prepare("SELECT id, data FROM levels WHERE tenant_id = 'local' ORDER BY created_at").all())
    out.push(view(row.id, JSON.parse(row.data), false));
  return out;
}

function get(id) {
  if (BUILTIN[id]) return view(id, BUILTIN[id], true);
  const row = raw()?.prepare("SELECT data FROM levels WHERE tenant_id = 'local' AND id = ?").get(String(id || ''));
  return row ? view(id, JSON.parse(row.data), false) : null;
}

/** The rights of a level; an unknown level holds none (fails closed). */
function rightsOf(id) { return get(id)?.rights || []; }

/** True when level `a` grants nothing that level `b` does not: what one person may hand another. */
function within(a, b) {
  const A = get(a), B = get(b);
  if (!A || !B) return false;
  return A.rights.every(r => B.rights.includes(r));
}

/** A level as stored: only known rights, tidy lists, a known approval policy. */
function normalize(input, actorLevel) {
  const name = String(input.name || '').trim().slice(0, 60);
  if (!name) throw bad('A level needs a name.');
  const rights = [...new Set((input.rights || []).map(String))].filter(r => RIGHTS.includes(r));
  const mine = rightsOf(actorLevel);
  const beyond = rights.filter(r => !mine.includes(r));
  if (beyond.length) throw bad(`You cannot make a level with rights you do not hold: ${beyond.join(', ')}.`, 403);
  const list = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map(s => String(s).trim()).filter(Boolean))].slice(0, 100);
  return {
    name, rights,
    settings: list(input.settings),
    tools: { allow: list(input.tools?.allow), deny: list(input.tools?.deny) },
    approval: input.approval === 'mode' ? 'mode' : 'ask',
    ...(reachOf(input.reach, actorLevel) ? { reach: reachOf(input.reach, actorLevel) } : {}),
    ...(require('./approve-devices').normalize(input.approveDevices, actorLevel) ? { approveDevices: input.approveDevices } : {}),
    ...(require('./allot').normalize(input.resources) ? { resources: require('./allot').normalize(input.resources) } : {}),
    ...(list(input.delegates).length ? { delegates: list(input.delegates) } : {}),
    ...(require('../people/policy').levelField(input.people, actorLevel) ? { people: input.people } : {}),   // who its people may message (hive chat)
    ...(input.description ? { description: String(input.description).slice(0, 300) } : {}),
  };
}

/** A level's reach (auth/reach.js) — never further than the reach of the person making it. */
function reachOf(value, actorLevel) {
  if (value === undefined || value === null || value === '') return null;
  const { RUNGS, rungOf } = require('./reach');
  if (!RUNGS.includes(value)) throw bad(`Reach is one of ${RUNGS.join(', ')}.`);
  const actor = typeof actorLevel === 'string' ? get(actorLevel) : actorLevel;
  if (RUNGS.indexOf(value) > RUNGS.indexOf(rungOf(actor))) throw bad(`You cannot make a level that reaches further than you do (${rungOf(actor)}).`, 403);
  return value;
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function create(input, { actorLevel }) {
  const r = raw();
  if (!r) throw bad('Custom levels need the SQLite database; with PostgreSQL only the built-in levels exist for now.', 501);
  const level = normalize(input, actorLevel);
  let id = slug(input.id || level.name) || 'level';
  if (get(id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;
  r.prepare("INSERT INTO levels (tenant_id, id, name, created_at, data) VALUES ('local', ?, ?, ?, ?)").run(id, level.name, new Date().toISOString(), JSON.stringify(level));
  return get(id);
}

function update(id, input, { actorLevel }) {
  const cur = get(id);
  if (!cur) throw bad(`No level ${id}.`, 404);
  if (cur.builtin) throw bad(`${cur.name} is built in and cannot be changed; make a level of your own from it.`);
  if (!within(id, actorLevel)) throw bad(`${cur.name} holds rights you do not, so you cannot change it.`, 403);
  const level = normalize({ ...cur, ...input }, actorLevel);
  raw().prepare("UPDATE levels SET name = ?, data = ? WHERE tenant_id = 'local' AND id = ?").run(level.name, JSON.stringify(level), id);
  return get(id);
}

function remove(id, { actorLevel, inUse }) {
  const cur = get(id);
  if (!cur) throw bad(`No level ${id}.`, 404);
  if (cur.builtin) throw bad(`${cur.name} is built in.`);
  if (!within(id, actorLevel)) throw bad(`${cur.name} holds rights you do not.`, 403);
  if (inUse) throw bad(`${cur.name} is still assigned to ${inUse} ${inUse === 1 ? 'person' : 'people'}; move them first.`, 409);
  raw().prepare("DELETE FROM levels WHERE tenant_id = 'local' AND id = ?").run(id);
  return { removed: id };
}

module.exports = { RIGHTS, BUILTIN, list, get, rightsOf, within, create, update, remove };

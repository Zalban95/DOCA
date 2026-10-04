'use strict';

/**
 * The one decision: may this agent, acting for this person, do this — and
 * must it ask first? (docs/design/permissions.md §3.)
 *
 *   1. The rules — charter, protected files, NEVER tools — are checked by their
 *      own modules before this is asked, and nothing here can override them.
 *   2. The ceiling: the person's level. An agent acts with the level of the
 *      person it acts for (decided with Al 2026-10-04: "agents inherit the
 *      permissions from the user's level"); a specialist is that, narrowed by
 *      its definition (which tools it is offered at all).
 *   3. Exceptions: a grant for the person, the specialist type, its mission or
 *      this session widens the ceiling — given by someone entitled to (mayGrant).
 *   4. Approval: a level that asks (approval 'ask', every level without host by
 *      default) has its calls asked whatever the panel's mode, unless the person
 *      answered "always" for that kind of call (an approve: grant).
 *
 * No person — a conversation from before accounts, a test — is not narrowed:
 * the panel's own switches (Auto/Manual, the allowlist) still apply as before.
 */
const levels = require('./levels');
const grants = require('./grants');

/** A tool pattern against a call: 'shell' matches shell and shell:<verb>; '*' anything; 'mcp__*' a prefix. */
function matches(pattern, name, key) {
  const one = target => {
    if (pattern === '*' || pattern === target) return true;
    if (pattern.endsWith('*')) return target.startsWith(pattern.slice(0, -1));
    return false;
  };
  return one(name) || one(key) || (!pattern.includes(':') && key.startsWith(`${pattern}:`));
}

/** The keys a call is judged by: shell:git, shell:rm … or the tool's name. */
function keysOf(name, args) {
  const keys = require('../harness/approval').keysFor(name, args);
  return keys && keys.length ? keys : [name];
}

/** Does a level allow every key of this call? */
function levelAllows(level, name, keys) {
  const { allow = [], deny = [] } = level.tools || {};
  return keys.every(k => allow.some(p => matches(p, name, k)) && !deny.some(p => matches(p, name, k)));
}

function subjectsOf({ person, profile, missionId, sessionId }) {
  return [person?.id && { kind: 'user', id: person.id }, profile?.id && profile.level !== 'orchestrator' && { kind: 'specialist', id: profile.id },
    missionId && { kind: 'mission', id: missionId }, sessionId && { kind: 'session', id: sessionId }].filter(Boolean);
}

/**
 * @returns {{ allowed: boolean, ask: boolean, why?: string, level?: string }}
 */
function tool({ person, profile, missionId, sessionId, name, args }) {
  if (!person?.role) return { allowed: true, ask: false };
  const L = levels.get(person.role);
  if (!L) return { allowed: false, ask: false, why: `the level "${person.role}" no longer exists — an admin can give ${person.name || 'this person'} another in Settings → Users` };
  const keys = keysOf(name, args);
  const subjects = subjectsOf({ person, profile, missionId, sessionId });
  const granted = keys.every(k => grants.holds(subjects, `tool:${k}`));
  if (!levelAllows(L, name, keys) && !granted)
    return { allowed: false, ask: false, level: L.name, why: `${person.name || 'this person'}'s level, ${L.name}, does not allow ${keys.join(', ')}` };
  const ask = L.approval === 'ask' && !keys.every(k => grants.holds(subjects, `approve:${k}`));
  return { allowed: true, ask, level: L.name };
}

/** Does a person's level (with their grants) hold a permission? Used to bound what they may give. */
function holds(person, permission) {
  const L = levels.get(person?.role);
  if (!L) return false;
  const [kind, ...rest] = permission.split(':');
  const v = rest.join(':');
  const own = grants.holds([{ kind: 'user', id: person.id }], permission);
  if (kind === 'tool' || kind === 'approve') {
    const [name, verb] = v.split(':');
    const key = verb ? `${name}:${verb}` : name;
    const inLevel = levelAllows(L, name, [key]) || (L.rights.includes('host') && (L.tools.allow || []).includes('*'));
    return kind === 'approve' ? (inLevel && (L.approval === 'mode' || own)) || own : inLevel || own;
  }
  if (kind === 'setting') return L.settings.includes('*') || L.settings.some(p => v === p || v.startsWith(`${p}.`)) || own;
  if (kind === 'path') return L.rights.includes('host') || own;
  return false;
}

/**
 * May `giver` give `permission` to `subject`? A person needs delegate, and a
 * person subject must be of their level or below; an agent gives only to the
 * specialist or mission it dispatched (checked by its tool), for the mission.
 * Either way, only what the giver holds.
 * @returns {string|null} why not, or null
 */
function mayGrant({ giver, subject, permission, store = require('./store') }) {
  if (!giver?.role) return 'only a signed-in person, or an agent acting for one, gives a permission';
  if (!giver.agent && !levels.rightsOf(giver.role).includes('delegate'))
    return `${levels.get(giver.role)?.name || giver.role} does not hold delegate, which giving a permission needs`;
  if (subject.kind === 'user') {
    if (giver.agent) return 'an agent gives permissions to the specialists it dispatches, not to people';
    const m = store.membership(store.defaultOrg()?.id, subject.id);
    if (!m) return 'no such person here';
    if (!levels.within(m.role, giver.role)) return 'that person\'s level is above yours';
  }
  if (!holds(giver, permission)) return `you do not hold ${permission} yourself, so you cannot give it`;
  return null;
}

/** Tools a specialist is offered beyond its definition, by grants to it or its mission. */
function grantedTools({ profile, missionId }) {
  return grants.forSubjects(subjectsOf({ profile, missionId })).map(g => g.permission).filter(p => p.startsWith('tool:'))
    .map(p => p.slice(5).split(':')[0]);
}

/** One block for the agent's limits: whom it acts for, what that level allows, and its exceptions. */
function describe({ person, profile, missionId, sessionId }) {
  if (!person?.role) return '';
  const L = levels.get(person.role);
  if (!L) return '';
  const own = grants.forSubjects(subjectsOf({ person, profile, missionId, sessionId }));
  return `acting for: ${person.name || person.email || 'a person'}, level ${L.name} — tools ${L.tools.allow.join(', ') || 'none'}`
    + `${L.tools.deny.length ? ` except ${L.tools.deny.join(', ')}` : ''}; settings ${L.settings.join(', ') || 'none'}; `
    + `${L.approval === 'ask' ? 'every tool call is asked first' : 'calls follow the panel\'s approval mode'}`
    + `${own.length ? `; exceptions granted: ${own.map(g => g.permission).join(', ')}` : ''}. What the level does not allow is refused with`
    + ' who could grant it — say so to the person rather than working around it.';
}

module.exports = { tool, holds, mayGrant, grantedTools, describe, matches, levelAllows };

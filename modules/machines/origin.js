'use strict';

/**
 * Who started a machine, read back from what was written down (acts.js, and the hub's own lines in activity.js) — so a
 * machine row can say "started by <the person's name> from <the screen's or device's name>, 2 h ago" (both read from their records), "started by an agent in the
 * conversation …", "started by DOCA (lent to a mission)", or, for one running that no line started — a VM started
 * with virt-manager, a container started with docker run in a terminal — "started outside DOCA" (asked 2026-10-08:
 * "I started the VMs manually, log the actions so there is no confusion"). A stopped machine says who stopped it.
 *
 * A machine is found by its keys: `kind:id`, and for a container also the service it is (`doca-<id>` → `service:<id>`)
 * and the stack it belongs to (its compose project), since a person starts those and docker makes the containers.
 * The log is read at most every CACHE_MS and back DAYS days (it is kept `logs.activityDays`): a machine started before
 * that, or before DOCA wrote these lines, also reads "started outside DOCA".
 */
const CACHE_MS = 5000;
const DAYS = 30;
const STARTS = new Set(['start', 'restart', 'create', 'run', 'resume', 'unpause', 'adopt', 'update', 'reboot', 'restore']);
const STOPS = new Set(['stop', 'kill', 'remove', 'rm', 'delete', 'archive', 'pause']);
let _index = null;

/** The newest successful start or stop per machine key. */
function index() {
  if (_index && Date.now() - _index.at < CACHE_MS) return _index.map;
  const map = new Map();
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  for (const l of require('../activity').list({ since, limit: 20000 })) {   // newest first
    if (!l.machine || l.ok === false || !(STARTS.has(l.act) || STOPS.has(l.act))) continue;
    const key = `${l.machine.kind}:${l.machine.id}`;
    if (!map.has(key)) map.set(key, l);
  }
  _index = { at: Date.now(), map };
  return map;
}

function keysOf(kind, id, { name, project } = {}) {
  if (kind !== 'container') return [`${kind}:${id}`];
  const n = name || id, svc = /^doca-(.+)$/.exec(n)?.[1];
  return [`container:${n}`, svc && `service:${svc}`, project && `stack:${project}`].filter(Boolean);
}

function phrase(l) {
  const verb = STARTS.has(l.act) ? (l.act === 'create' ? 'made' : l.act === 'adopt' ? 'adopted' : 'started') : l.act === 'remove' || l.act === 'delete' || l.act === 'rm' ? 'removed' : 'stopped';
  const who = l.from === 'person' ? `${verb} by ${l.person?.name || 'a person'}${l.via ? ` from ${l.via}` : ''}`
    : l.from === 'agent' ? `${verb} by an agent${l.person ? ` for ${l.person.name}` : ''}${l.via ? ` in ${l.via}` : ''}`
    : `${verb} by DOCA${l.why ? ` (${l.why})` : ''}`;
  return { text: who, at: l.at, by: l.from, person: l.person || null, sessionId: l.sessionId || null };
}

/**
 * The line for one machine: `{ text, at, by, outside }` or null. `up`: it is running now. `fallback`: what the machine
 * itself says when no line does (a computer: the conversation that made it).
 */
function of(kind, id, { up, name = null, project = null, fallback = null } = {}) {
  const map = index();
  const lines = keysOf(kind, id, { name, project }).map(k => map.get(k)).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1));
  const last = lines[0];
  if (up) {
    if (last && STARTS.has(last.act)) return phrase(last);
    if (fallback) return { text: fallback, at: null, by: 'hub', outside: false };
    return { text: 'started outside DOCA', at: null, by: null, outside: true };
  }
  return last && STOPS.has(last.act) ? phrase(last) : null;
}

/** A computer's own account of where it came from, when no line says: the conversation or the specialist it is for. */
function computerFallback(c) {
  if (c.agentType) return `started for ${c.agentType}'s missions`;
  if (c.by) { try { return `made by an agent in the conversation "${require('../harness/memory').getSession(c.by)?.title || c.by}"`; } catch { /* gone */ } }
  return null;
}

module.exports = { of, keysOf, computerFallback, index, STARTS, STOPS, DAYS, _reset: () => { _index = null; } };

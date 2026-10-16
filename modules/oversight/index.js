'use strict';

/**
 * Other people's work, for whoever oversees it (the owner's decision of 2026-10-16, branch team-oversight).
 *
 * Since 3.101.0 a person's devices hear only their own work (session-access.hears). The owner kept that, and asked for
 * a separate place in the panel — an icon in the header, apart from the person's own notices and questions — where an
 * admin sees the work of the people they may see (the owner's included): missions and work chats started, finished,
 * failed, waiting for someone, stopped. Grouped by person (groupsOf), newest first, with an unread count, each opening
 * its conversation.
 *
 * Mechanical (the visibility rule): nothing is stored but each viewer's switch and how far they read. The list is read
 * from what already exists — the specialists' missions (agents/missions.js) and the work chats as devices see them
 * (harness/workview.js payloadOf) — and worded by fixed templates. No model, no agent posts, and no device push: a
 * person's devices stay their own.
 *
 * Who: a person holding host (the conversations are the machine's, session-access.mayUse), and only work that is
 * someone else's — a conversation marked as another person's. Work that is nobody's (before accounts) is left out.
 * Opt-in per person: on by default for the owner, off for everyone else.
 */
const store = require('../store');

const DOC = 'oversight';
const LIMIT = 50;
const access = () => require('../harness/session-access');

const allowed = person => !!person?.id && access().isHost(person);

function settingsOf(person) {
  const r = (store.readJson(DOC, {}) || {})[person?.id] || {};
  return { on: typeof r.on === 'boolean' ? r.on : person?.role === 'owner', seenAt: r.seenAt || null };
}

function write(person, patch) {
  const d = store.readJson(DOC, {}) || {};
  d[person.id] = { ...(d[person.id] || {}), ...patch };
  store.writeJson(DOC, d);
  return settingsOf(person);
}

const setOn = (person, on) => write(person, { on: !!on, ...(on && !settingsOf(person).seenAt ? { seenAt: new Date().toISOString() } : {}) });
const markSeen = (person, at = new Date().toISOString()) => write(person, { seenAt: at });

const WORDS = {
  started: 'started', finished: 'finished', failed: 'failed', waiting: 'is waiting for someone', stopped: 'was stopped', paused: 'is paused by a restart',
};

function nameOf(id) {
  const u = require('../auth/store').userById(id);
  return u?.name || u?.email || 'someone';
}

const line = s => String(s || '').split('\n')[0].trim().slice(0, 120);

/** A mission's row → an item, or null. */
function fromMission(m) {
  const event = m.state === 'running' ? (m.asking ? 'waiting' : 'started') : m.state === 'done' ? 'finished'
    : m.state === 'failed' ? 'failed' : m.state === 'cancelled' ? 'stopped' : m.state === 'paused' ? 'paused' : null;
  if (!event) return null;
  return { id: `m:${m.id}`, kind: 'mission', event, sessionId: m.sessionId, title: `${m.label || m.agentId || 'Specialist'}: ${line(m.task)}`,
    at: (event === 'waiting' && m.asking?.since) || m.endedAt || m.resumedAt || m.startedAt,
    detail: event === 'waiting' ? line(m.asking?.what) : event === 'failed' ? line(m.error) : event === 'finished' ? line(m.result) : '' };
}

/** A work chat → an item, or null. */
function fromWork(s) {
  const p = require('../harness/workview').payloadOf(s);
  const job = s.job?.state, halted = job === 'stopped' || job === 'dropped';
  const event = s.plan?.state === 'proposed' ? 'waiting' : p.state === 'running' ? 'started' : p.state === 'done' ? 'finished'
    : p.state === 'failed' ? 'failed' : p.state === 'cancelled' || halted ? 'stopped' : p.state === 'paused' ? 'paused' : null;
  if (!event) return null;
  return { id: `w:${s.id}`, kind: 'work', event, sessionId: s.id, title: `Work chat: ${line(p.label)}`,
    at: p.endedAt || p.startedAt || s.updatedAt,
    // A stopped job's own words say "Waiting for you" to its person (workview.js); here they are read by someone else.
    detail: event === 'waiting' ? 'A plan waits for its person to decide.'
      : halted ? `${line(s.job.stoppedWhy) || (job === 'dropped' ? 'Dropped' : 'Stopped')} — waits for its person to restart or drop it.` : line(p.error || p.result) };
}

/** Other people's work this person may see, newest first, with who and in fixed words. */
function list(person, { limit = LIMIT } = {}) {
  if (!allowed(person)) return [];
  const sa = access();
  const missions = require('../agents/registry').enabled() ? require('../agents/missions').list({ limit: 200 }) : [];
  const items = [...missions.map(fromMission), ...require('../harness/workview').workChats().map(fromWork)].filter(Boolean);
  const out = [];
  for (const it of items) {
    if (!it.sessionId || !it.at) continue;
    const owner = sa.ownerOf(it.sessionId);
    if (!owner || owner === person.id || !sa.mayUse(person, it.sessionId)) continue;
    const who = nameOf(owner);
    out.push({ ...it, personId: owner, who, text: `${who}'s ${it.kind === 'mission' ? 'mission' : 'work chat'} ${WORDS[it.event]}` });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

/** What the header icon reads: the switch, the list (when on), and how many are newer than what was read. */
function view(person) {
  const s = settingsOf(person);
  if (!s.on) return { on: false, unread: 0, items: [], groups: [], seenAt: s.seenAt };
  const items = list(person).map(i => ({ ...i, unread: !s.seenAt || String(i.at) > s.seenAt }));
  return { on: true, unread: items.filter(i => i.unread).length, items, groups: groupsOf(items), seenAt: s.seenAt };
}

/**
 * The list by person (the owner's answer of 2026-10-16): a group per person with its heading and unread count, newest
 * first within it; the groups ordered by their newest unread item, then — none unread — by their newest item.
 */
function groupsOf(items) {
  const by = new Map();
  for (const i of items) {
    if (!by.has(i.personId)) by.set(i.personId, { personId: i.personId, who: i.who, unread: 0, items: [] });
    const g = by.get(i.personId);
    g.items.push(i);
    if (i.unread) g.unread++;
  }
  const newest = (g, unread) => g.items.filter(i => !unread || i.unread).reduce((m, i) => (String(i.at) > m ? String(i.at) : m), '');
  return [...by.values()].sort((a, b) => (Number(!!b.unread) - Number(!!a.unread))
    || newest(b, true).localeCompare(newest(a, true)) || newest(b).localeCompare(newest(a)));
}

module.exports = { allowed, settingsOf, setOn, markSeen, list, view, groupsOf, fromMission, fromWork };

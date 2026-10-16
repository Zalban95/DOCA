'use strict';

/**
 * Other people's work, for whoever oversees it (the owner's decision of 2026-10-16, branch team-oversight).
 *
 * Since 3.101.0 a person's devices hear only their own work (session-access.hears). The owner kept that, and asked for
 * a separate place in the panel — an icon in the header, apart from the person's own notices and questions — where an
 * admin sees the work of the people they may see: missions and work chats started, finished, failed, waiting for
 * someone, stopped. Newest first, with an unread count, each opening its conversation.
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
    detail: event === 'waiting' ? 'A plan waits for its person to decide.' : line(p.error || p.result) };
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
  if (!s.on) return { on: false, unread: 0, items: [], seenAt: s.seenAt };
  const items = list(person);
  const unread = items.filter(i => !s.seenAt || String(i.at) > s.seenAt).length;
  return { on: true, unread, items: items.map(i => ({ ...i, unread: !s.seenAt || String(i.at) > s.seenAt })), seenAt: s.seenAt };
}

module.exports = { allowed, settingsOf, setOn, markSeen, list, view, fromMission, fromWork };

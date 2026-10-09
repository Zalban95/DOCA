'use strict';

/**
 * A person brings their own agent into a hive-chat conversation (asked 2026-10-09): `@orchestrator` (or `@agent`, or a
 * specialist's id) in a message asks the WRITER's agent — under their level, their approvals and their budget, exactly
 * as a turn of theirs — and its answer is posted in the space labelled "<name>'s agent".
 *
 * How it stays the person's: each (person, space) has a conversation of its own (`people_members.agent_session`), kind
 * `chat`, claimed by the person and placed under their own Orchestrator. A mention sends that conversation one message:
 * the space's recent lines (what the person brought in, nothing more) and the request. Every turn that ends there —
 * this one, or a later one the person's agent takes by itself (a specialist reporting back) — has its final answer
 * posted in the space. The agent has no tool that reads the hive chat: a conversation nobody brought it into is one it
 * never sees, and recall_conversations finds only these bridge conversations, which hold what was brought.
 */
const store = require('./store');

const RECENT = 15;
const SHORT = 6000;

/** What a message asks of an agent: {agent, request}, or null. */
function asked(text) {
  const t = String(text || '');
  const m = /(^|\s)@(orchestrator|agent)\b/i.exec(t);
  if (m) return { agent: 'orchestrator', request: t.replace(m[0], m[1]).trim() };
  try {
    const reg = require('../agents/registry');
    if (!reg.enabled()) return null;
    for (const [, , id] of t.matchAll(/(^|\s)@([a-z0-9][a-z0-9_-]{1,40})\b/gi)) {
      const def = reg.get(id.toLowerCase());
      if (def) return { agent: def.id, request: t.replace(new RegExp(`(^|\\s)@${id}\\b`, 'i'), '$1').trim() };
    }
  } catch { /* no specialists here */ }
  return null;
}

/** The person's conversation for this space, made the first time. */
async function conversation(p, s, title) {
  const memory = require('../harness/memory');
  const me = await store.memberOf(s.id, p.id);
  const cur = me?.agentSession && memory.getSession(me.agentSession);
  if (cur && !cur.archivedAt) return cur.id;
  const parent = require('../harness/own-main').of(p);
  const made = memory.createSession(`${title} — hive chat`, { activate: false, kind: 'chat', parentId: parent });
  memory.updateSession(made.id, { peopleSpace: s.id, titleLocked: true, peoplePosted: 0 });
  require('../harness/session-access').claim(p, made.id);
  await store.setMember(s.id, p.id, { agentSession: made.id });
  return made.id;
}

const line = (m, who) => `${m.agent ? `${who.get(m.authorId)?.name || 'Someone'}'s agent` : who.get(m.authorId)?.name || 'Someone'}: ${m.deletedAt ? '(deleted)' : String(m.text || '(a file)').slice(0, 800)}`;

async function bring(p, s, msg, want, client) {
  const spaces = require('./spaces');
  const who = spaces.names(p), members = await store.members(s.id);
  const title = spaces.titleOf(s, p, who, members);
  const sessionId = await conversation(p, s, title);
  require('../harness/memory').updateSession(sessionId, { peopleAgent: want.agent });
  const recent = (await store.messages(s.id, { limit: RECENT })).filter(m => m.id !== msg.id);
  const message = [
    `[Hive chat — "${title}" (${s.kind === 'dm' ? 'a direct conversation' : `${members.length} people`}). ${p.name || 'Your person'} brought you in. What follows is all you see of`
      + ' this conversation, and your answer is posted there for everyone in it to read, as from their agent — write it for them.]',
    recent.length ? `Recent messages, oldest first:\n${recent.map(m => line(m, who)).join('\n')}` : '',
    `${p.name || 'Your person'} asks you: ${want.request || '(nothing more — look at the recent messages)'}`,
    want.agent !== 'orchestrator' ? `They addressed the specialist "${want.agent}": give it the task with agent_dispatch and report what it finds.` : '',
  ].filter(Boolean).join('\n\n').slice(0, SHORT);
  const base = client || require('../harness/turn/client').dashboardClient({ auth: null });
  const c = { ...base, name: `Hive chat — ${title}`, user: base.user || p };
  try {
    const r = require('../harness/agent').send({ message, sessionId, client: c, emit: () => {} });
    if (r && typeof r.then === 'function') await r;
  } catch (e) {
    // A turn that ran and failed is posted by listen(), like any other; this is one that never started (a budget, no model).
    if (require('../harness/memory').getSession(sessionId)?.lastError !== String(e.message).slice(0, 600)) await answer(sessionId, { failed: e.message });
  }
}

/** Post what the person's agent answered there since the last post: its last answer, or why it could not. */
async function answer(sessionId, { failed = null } = {}) {
  const memory = require('../harness/memory');
  const sess = memory.getSession(sessionId);
  if (!sess?.peopleSpace || !sess.person?.id) return null;
  const rows = memory.messages(sessionId);
  const fresh = rows.slice(Number(sess.peoplePosted) || 0);
  memory.updateSession(sessionId, { peoplePosted: rows.length });
  const said = [...fresh].reverse().find(r => r.role === 'assistant' && String(r.content || '').trim());
  const why = failed || (!said && sess.state === 'failed' ? sess.lastError : null);
  if (!said && !why) return null;
  const s = await store.getSpace(sess.peopleSpace);
  if (!s || !(await store.memberOf(s.id, sess.person.id))) return null;   // they left: their agent no longer speaks there
  const text = said ? String(said.content).trim() : `I could not answer: ${String(why).slice(0, 300)}`;
  const m = await store.addMessage({ spaceId: s.id, authorId: sess.person.id, agent: sess.peopleAgent || 'orchestrator', text: text.slice(0, 8000) });
  const person = require('../harness/turn/client').personById(sess.person);
  if (!person) return m;
  const spaces = require('./spaces'), who = spaces.names(person), members = await store.members(s.id);
  const out = require('./messages').view(m, who, { reactions: {}, replies: 0 });
  require('./deliver').message(s, out, members, 'new');
  return out;
}

let listening = false;
/** Every turn that ends in a bridge conversation posts its answer (live feed: conversation … ended). */
function listen() {
  if (listening) return;
  listening = true;
  require('../live').feed.on('change', c => {
    if (c.topic !== 'conversation' || c.what !== 'ended' || !c.id) return;
    const sess = require('../harness/memory').getSession(c.id);
    if (sess?.peopleSpace) answer(c.id).catch(() => { /* the chat never breaks a turn */ });
  });
}

module.exports = { asked, bring, answer, listen };

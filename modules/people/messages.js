'use strict';

/**
 * Messages in a hive-chat space, as a person writes and reads them: post (with replies, mentions and attachments),
 * edit and delete their own (a delete is a tombstone), react, pin, mark read, say they are typing, search. A member
 * only — spaces.access answers 404 otherwise — and writing needs the `chat` right (the gate refuses a viewer first).
 * `@orchestrator`, `@agent` or a specialist's id brings the writer's own agent in (agent-bridge.js).
 */
const store = require('./store');
const spaces = require('./spaces');
const deliver = require('./deliver');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const MAX = 8000;
/** Writing needs `chat` — the gate says so for the panel, and this for a device acting as its person. */
const writer = p => { if (!require('./policy').rights(p).includes('chat')) throw bad('Your level reads the hive chat but does not write in it.', 403); };
const EMOJI = /^[^\s<>"'`]{1,16}$/u;

/** The words `@name` in a text that name a member (by first name, whole name without spaces, or email's local part). */
function mentionsIn(text, members, who) {
  const words = new Set([...String(text).matchAll(/@([\p{L}\p{N}._-]{2,40})/gu)].map(m => m[1].toLowerCase()));
  if (!words.size) return [];
  return members.map(m => who.get(m.userId)).filter(Boolean).filter(x => {
    const n = String(x.name || '').toLowerCase();
    return [n.split(/\s+/)[0], n.replace(/\s+/g, ''), String(x.email || '').split('@')[0].toLowerCase()].some(k => k && words.has(k));
  }).map(x => x.id);
}

/** Files from the attachments store, by name: only ones that exist there. */
function files(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const resolved = require('../attachments').resolve(list.slice(0, 10).map(String));
  return resolved.map(a => ({ name: a.name, bytes: a.bytes, mime: a.mime, kind: require('../attachments').playableKind(a.mime) || null }));
}

/** A message for a page or a device: its author's name, its reactions and how many replies it has. */
function view(m, who, extra = {}) {
  const a = who.get(m.authorId);
  return { ...m, author: { id: m.authorId, name: a?.name || 'Someone no longer here' },
    agentLabel: m.agent ? `${a?.name || 'Someone'}'s ${m.agent === 'orchestrator' ? 'agent' : m.agent}` : null, ...extra };
}

async function decorate(rows, who) {
  const ids = rows.map(m => m.id);
  const [reacts, counts] = await Promise.all([store.reactions(ids), store.replyCounts(ids)]);
  return rows.map(m => view(m, who, { reactions: reacts[m.id] || {}, replies: counts[m.id] || 0 }));
}

async function list(p, spaceId, { before = null, after = null, limit = 50, thread = null } = {}) {
  const { s } = await spaces.access(p, spaceId, { member: false });
  const who = spaces.names(p);
  if (thread) {
    const root = await store.getMessage(thread);
    if (!root || root.spaceId !== s.id) throw bad('No such message.', 404);
    return { messages: await decorate([root, ...await store.replies(root.id)], who) };
  }
  return { messages: await decorate(await store.messages(s.id, { before, after, limit }), who), lastSeq: s.lastSeq };
}

async function post(p, spaceId, { text = '', replyTo = null, attachments = [] } = {}, { client = null } = {}) {
  writer(p);
  const { s } = await spaces.access(p, spaceId);
  if (s.archivedAt) throw bad('This conversation was put away; bring it back to write in it.', 409);
  const body = String(text || '').replace(/\s+$/, '');
  const att = files(attachments);
  if (!body.trim() && !att.length) throw bad('Write something, or attach a file.');
  if (body.length > MAX) throw bad(`A message holds at most ${MAX} characters.`, 413);
  if (replyTo) { const r = await store.getMessage(replyTo); if (!r || r.spaceId !== s.id) throw bad('That message is not in this conversation.', 404); }
  const members = await store.members(s.id), who = spaces.names(p);
  const m = await store.addMessage({ spaceId: s.id, authorId: p.id, text: body, replyTo, mentions: mentionsIn(body, members, who), attachments: att });
  await store.setMember(s.id, p.id, { readSeq: m.seq, readAt: m.at });   // what you write you have read
  const out = view(m, who, { reactions: {}, replies: 0 });
  deliver.message(s, out, members, 'new');
  const asked = require('./agent-bridge').asked(body);
  if (asked) require('./agent-bridge').bring(p, s, out, asked, client).catch(() => { /* the bridge says its own failure in the space */ });
  return out;
}

/** A message the person may change: their own, never their agent's answer. */
async function own(p, id) {
  const m = await store.getMessage(id);
  if (!m) throw bad('No such message.', 404);
  const { s } = await spaces.access(p, m.spaceId);
  return { m, s };
}

async function edit(p, id, text) {
  writer(p);
  const { m, s } = await own(p, id);
  if (m.authorId !== p.id || m.agent) throw bad('You edit only what you wrote.', 403);
  if (m.deletedAt) throw bad('A deleted message stays deleted.', 409);
  const body = String(text || '').trim();
  if (!body) throw bad('An edit needs words; delete the message instead.');
  if (body.length > MAX) throw bad(`A message holds at most ${MAX} characters.`, 413);
  const next = await store.editMessage(id, body);
  const who = spaces.names(p), members = await store.members(s.id);
  const out = (await decorate([next], who))[0];
  deliver.message(s, out, members, 'edited');
  return out;
}

/** Delete: your own message, or your agent's answer; an admin also in a channel (moderation). */
async function remove(p, id) {
  writer(p);
  const { m, s } = await own(p, id);
  const mod = s.kind === 'channel' && require('./policy').rights(p).includes('users');
  if (m.authorId !== p.id && !mod) throw bad('You delete only what you (or your agent) wrote.', 403);
  const next = await store.deleteMessage(id);
  const out = view(next, spaces.names(p), { reactions: {}, replies: 0 });
  deliver.message(s, out, await store.members(s.id), 'deleted');
  return out;
}

async function react(p, id, emoji, on = true) {
  writer(p);
  const { m, s } = await own(p, id);
  const e = String(emoji || '').trim();
  if (!EMOJI.test(e)) throw bad('A reaction is one emoji (or a short word).');
  if (m.deletedAt) throw bad('A deleted message takes no reactions.', 409);
  await store.react(m.id, p.id, e, !!on);
  const out = (await decorate([m], spaces.names(p)))[0];
  deliver.message(s, out, await store.members(s.id), 'reacted');
  return out;
}

async function pin(p, id, on = true) {
  writer(p);
  const { m, s } = await own(p, id);
  await store.pin(s.id, m.id, p.id, !!on);
  deliver.space(s, await store.members(s.id), 'pins');
  return { pins: await store.pins(s.id) };
}

async function read(p, spaceId, seq) {
  const { s, me } = await spaces.access(p, spaceId);
  const n = Math.min(Number(seq) || s.lastSeq, s.lastSeq);
  if (n > (me.readSeq || 0)) {
    await store.setMember(s.id, p.id, { readSeq: n, readAt: store.now() });
    deliver.read(s, await store.members(s.id), { id: p.id, name: p.name }, n);
  }
  return { spaceId: s.id, readSeq: Math.max(n, me.readSeq || 0), lastSeq: s.lastSeq };
}

async function typing(p, spaceId) {
  writer(p);
  const { s } = await spaces.access(p, spaceId);
  deliver.typing(s, await store.members(s.id), { id: p.id, name: p.name });
  return { ok: true };
}

/** Messages holding these words in the person's own spaces, newest first. */
async function search(p, q) {
  const mine = (await store.spacesOf(p.id)).map(s => s.id);
  const who = spaces.names(p);
  return { results: (await store.search(mine, q)).map(m => view(m, who)) };
}

module.exports = { list, post, edit, remove, react, pin, read, typing, search, mentionsIn, view, decorate };

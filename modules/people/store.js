'use strict';

/**
 * Hive chat's tables (db/migrations.js step 14), and nothing else: every read and write of spaces, members, messages,
 * reactions and pins is a query here, in the SQL SQLite and PostgreSQL both speak. No rule about who may do what lives
 * in this file — policy.js and spaces.js decide, this only does.
 */
const crypto = require('crypto');
const db = () => require('../db');

const T = "tenant_id = 'local'";
const now = () => new Date().toISOString();
const newId = p => `${p}_${crypto.randomBytes(8).toString('hex')}`;
const json = v => (v == null ? null : JSON.stringify(v));
const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

const space = r => r && ({ id: r.id, kind: r.kind, name: r.name || '', topic: r.topic || '', orgId: r.org_id || null, audience: r.audience || null,
  createdBy: r.created_by || null, createdAt: r.created_at, lastAt: r.last_at || null, lastSeq: Number(r.last_seq) || 0, archivedAt: r.archived_at || null });
const member = r => r && ({ spaceId: r.space_id, userId: r.user_id, role: r.role, joinedAt: r.joined_at, readSeq: Number(r.read_seq) || 0,
  readAt: r.read_at || null, muted: !!Number(r.muted), agentSession: r.agent_session || null });
const message = r => r && ({ id: r.id, spaceId: r.space_id, seq: Number(r.seq), authorId: r.author_id || null, agent: r.agent || null,
  text: r.deleted_at ? '' : r.body, replyTo: r.reply_to || null, mentions: parse(r.mentions, []), attachments: r.deleted_at ? [] : parse(r.attachments, []),
  at: r.created_at, editedAt: r.edited_at || null, deletedAt: r.deleted_at || null });

/* ── Spaces ─────────────────────────────────────────────── */

async function createSpace({ kind, name = '', topic = '', orgId = null, audience = null, dmKey = null, by }, members = []) {
  const s = { id: newId('spc'), at: now() };
  await db().tx(async q => {
    await q.run('INSERT INTO people_spaces (id, kind, name, topic, org_id, audience, dm_key, created_by, created_at, last_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [s.id, kind, String(name).slice(0, 80), String(topic).slice(0, 300), orgId, audience, dmKey, by, s.at, s.at]);
    for (const m of members) await q.run('INSERT INTO people_members (space_id, user_id, role, joined_at) VALUES (?,?,?,?)', [s.id, m.userId, m.role || 'member', s.at]);
  });
  return getSpace(s.id);
}

async function getSpace(id) { return space(await db().get(`SELECT * FROM people_spaces WHERE ${T} AND id = ?`, [String(id)])); }
async function spaceByDm(key) { return space(await db().get(`SELECT * FROM people_spaces WHERE ${T} AND dm_key = ?`, [key])); }

async function updateSpace(id, patch) {
  const cols = { name: 'name', topic: 'topic', archivedAt: 'archived_at', audience: 'audience' };
  const set = Object.keys(patch).filter(k => cols[k]);
  if (set.length) await db().run(`UPDATE people_spaces SET ${set.map(k => `${cols[k]} = ?`).join(', ')} WHERE ${T} AND id = ?`, [...set.map(k => patch[k]), id]);
  return getSpace(id);
}

/** The spaces a person is a member of, newest message first, each with their own row. */
async function spacesOf(userId) {
  const rows = await db().all(`SELECT s.*, m.role AS m_role, m.read_seq AS m_read, m.muted AS m_muted, m.agent_session AS m_agent
    FROM people_spaces s JOIN people_members m ON m.tenant_id = s.tenant_id AND m.space_id = s.id
    WHERE s.${T} AND m.user_id = ? ORDER BY s.last_at DESC`, [String(userId)]);
  return rows.map(r => ({ ...space(r), me: { role: r.m_role, readSeq: Number(r.m_read) || 0, muted: !!Number(r.m_muted), agentSession: r.m_agent || null } }));
}

/** Channels of these audiences (an organisation's, a team's), member or not: what a person may browse and join. */
async function channels(audiences) {
  if (!audiences.length) return [];
  return (await db().all(`SELECT * FROM people_spaces WHERE ${T} AND kind = 'channel' AND archived_at IS NULL AND audience IN (${audiences.map(() => '?').join(',')}) ORDER BY name`, audiences)).map(space);
}

/* ── Members ────────────────────────────────────────────── */

async function members(spaceId) { return (await db().all(`SELECT * FROM people_members WHERE ${T} AND space_id = ? ORDER BY joined_at`, [spaceId])).map(member); }
async function memberOf(spaceId, userId) { return member(await db().get(`SELECT * FROM people_members WHERE ${T} AND space_id = ? AND user_id = ?`, [spaceId, String(userId)])); }

async function addMember(spaceId, userId, role = 'member') {
  if (await memberOf(spaceId, userId)) return memberOf(spaceId, userId);
  const s = await getSpace(spaceId);
  await db().run('INSERT INTO people_members (space_id, user_id, role, joined_at, read_seq) VALUES (?,?,?,?,?)', [spaceId, userId, role, now(), s?.lastSeq || 0]);
  return memberOf(spaceId, userId);
}
async function removeMember(spaceId, userId) { await db().run(`DELETE FROM people_members WHERE ${T} AND space_id = ? AND user_id = ?`, [spaceId, userId]); }

async function setMember(spaceId, userId, patch) {
  const cols = { readSeq: 'read_seq', readAt: 'read_at', muted: 'muted', agentSession: 'agent_session', role: 'role' };
  const set = Object.keys(patch).filter(k => cols[k]);
  const v = k => (k === 'muted' ? (patch[k] ? 1 : 0) : patch[k]);
  if (set.length) await db().run(`UPDATE people_members SET ${set.map(k => `${cols[k]} = ?`).join(', ')} WHERE ${T} AND space_id = ? AND user_id = ?`, [...set.map(v), spaceId, userId]);
  return memberOf(spaceId, userId);
}

/* ── Messages ───────────────────────────────────────────── */

/** A message, numbered after the space's last under its write lock, so two at once never share a number. */
async function addMessage({ spaceId, authorId, agent = null, text, replyTo = null, mentions = [], attachments = [] }) {
  const m = { id: newId('msg'), at: now() };
  await db().tx(async q => {
    const r = await q.get(`SELECT last_seq FROM people_spaces WHERE ${T} AND id = ?`, [spaceId]);
    m.seq = (Number(r?.last_seq) || 0) + 1;
    await q.run('INSERT INTO people_messages (id, space_id, seq, author_id, agent, body, reply_to, mentions, attachments, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [m.id, spaceId, m.seq, authorId, agent, String(text), replyTo, json(mentions), json(attachments), m.at]);
    await q.run(`UPDATE people_spaces SET last_seq = ?, last_at = ? WHERE ${T} AND id = ?`, [m.seq, m.at, spaceId]);
  });
  return getMessage(m.id);
}

async function getMessage(id) { return message(await db().get(`SELECT * FROM people_messages WHERE ${T} AND id = ?`, [String(id)])); }

/** Up to `limit` messages before `before` (a seq), oldest first; or after `after`. */
async function messages(spaceId, { before = null, after = null, limit = 50 } = {}) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  if (after != null) return (await db().all(`SELECT * FROM people_messages WHERE ${T} AND space_id = ? AND seq > ? ORDER BY seq LIMIT ?`, [spaceId, Number(after), n])).map(message);
  const rows = before != null
    ? await db().all(`SELECT * FROM people_messages WHERE ${T} AND space_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`, [spaceId, Number(before), n])
    : await db().all(`SELECT * FROM people_messages WHERE ${T} AND space_id = ? ORDER BY seq DESC LIMIT ?`, [spaceId, n]);
  return rows.reverse().map(message);
}

/** The replies to one message (a thread), oldest first. */
async function replies(messageId) { return (await db().all(`SELECT * FROM people_messages WHERE ${T} AND reply_to = ? ORDER BY seq`, [messageId])).map(message); }

async function editMessage(id, text) { await db().run(`UPDATE people_messages SET body = ?, edited_at = ? WHERE ${T} AND id = ? AND deleted_at IS NULL`, [String(text), now(), id]); return getMessage(id); }

/** A tombstone: the row stays (its place in the space, its replies), its words and files go. */
async function deleteMessage(id) {
  await db().run(`UPDATE people_messages SET body = '', attachments = NULL, mentions = NULL, deleted_at = ? WHERE ${T} AND id = ?`, [now(), id]);
  await db().run(`DELETE FROM people_reactions WHERE ${T} AND message_id = ?`, [id]);
  return getMessage(id);
}

/** Messages of these spaces whose words hold `q` (case-insensitive), newest first. */
async function search(spaceIds, q, limit = 30) {
  if (!spaceIds.length || !String(q || '').trim()) return [];
  const like = `%${String(q).trim().toLowerCase().replace(/[\\%_]/g, c => `\\${c}`)}%`;
  return (await db().all(`SELECT * FROM people_messages WHERE ${T} AND deleted_at IS NULL AND space_id IN (${spaceIds.map(() => '?').join(',')})
    AND LOWER(body) LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`, [...spaceIds, like, Math.min(100, Number(limit) || 30)])).map(message);
}

/* ── Reactions and pins ─────────────────────────────────── */

async function react(messageId, userId, emoji, on) {
  if (on) await db().run(`DELETE FROM people_reactions WHERE ${T} AND message_id = ? AND user_id = ? AND emoji = ?`, [messageId, userId, emoji]).then(() =>
    db().run('INSERT INTO people_reactions (message_id, user_id, emoji, at) VALUES (?,?,?,?)', [messageId, userId, emoji, now()]));
  else await db().run(`DELETE FROM people_reactions WHERE ${T} AND message_id = ? AND user_id = ? AND emoji = ?`, [messageId, userId, emoji]);
}

/** Reactions of these messages: {messageId: {emoji: [userId…]}}. */
async function reactions(ids) {
  if (!ids.length) return {};
  const out = {};
  for (const r of await db().all(`SELECT message_id, user_id, emoji FROM people_reactions WHERE ${T} AND message_id IN (${ids.map(() => '?').join(',')}) ORDER BY at`, ids))
    ((out[r.message_id] ||= {})[r.emoji] ||= []).push(r.user_id);
  return out;
}

/** How many replies each of these messages has. */
async function replyCounts(ids) {
  if (!ids.length) return {};
  const rows = await db().all(`SELECT reply_to, COUNT(*) AS n FROM people_messages WHERE ${T} AND reply_to IN (${ids.map(() => '?').join(',')}) GROUP BY reply_to`, ids);
  return Object.fromEntries(rows.map(r => [r.reply_to, Number(r.n)]));
}

async function pin(spaceId, messageId, by, on) {
  await db().run(`DELETE FROM people_pins WHERE ${T} AND space_id = ? AND message_id = ?`, [spaceId, messageId]);
  if (on) await db().run('INSERT INTO people_pins (space_id, message_id, by_user, at) VALUES (?,?,?,?)', [spaceId, messageId, by, now()]);
}
async function pins(spaceId) { return (await db().all(`SELECT message_id, by_user, at FROM people_pins WHERE ${T} AND space_id = ? ORDER BY at DESC`, [spaceId])).map(r => ({ messageId: r.message_id, by: r.by_user, at: r.at })); }

/* ── Keeping ─────────────────────────────────────────────── */

/** Messages older than `before` (ISO) go, with their reactions and pins. @returns how many */
async function prune(before) {
  const old = await db().all(`SELECT id FROM people_messages WHERE ${T} AND created_at < ?`, [before]);
  if (!old.length) return 0;
  await db().tx(async q => {
    for (const { id } of old) {
      await q.run(`DELETE FROM people_reactions WHERE ${T} AND message_id = ?`, [id]);
      await q.run(`DELETE FROM people_pins WHERE ${T} AND message_id = ?`, [id]);
      await q.run(`DELETE FROM people_messages WHERE ${T} AND id = ?`, [id]);
    }
  });
  return old.length;
}

/** Everything, for the owner's compliance export (export.js). */
async function everything() {
  const all = sql => db().all(sql);
  return { spaces: (await all(`SELECT * FROM people_spaces WHERE ${T} ORDER BY created_at`)).map(space),
    members: (await all(`SELECT * FROM people_members WHERE ${T}`)).map(member),
    messages: (await all(`SELECT * FROM people_messages WHERE ${T} ORDER BY space_id, seq`)).map(message) };
}

module.exports = { createSpace, getSpace, spaceByDm, updateSpace, spacesOf, channels, members, memberOf, addMember, removeMember, setMember,
  addMessage, getMessage, messages, replies, editMessage, deleteMessage, search, react, reactions, replyCounts, pin, pins, prune, everything, now };

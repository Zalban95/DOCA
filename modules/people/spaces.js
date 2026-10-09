'use strict';

/**
 * Spaces of the hive chat, as a person may use them: direct messages, groups and channels (policy.js decides who may
 * start which). Every function takes the person acting (`p`: {id, name, role, orgId}) and answers 404 for a space they
 * may not see, as if it were absent — an admin included: a conversation is its members'.
 *
 *   list(p)                    their spaces with unread counts and the last message, the channels they may join, and
 *                              their own agent conversations (their Orchestrator first, then their work chats)
 *   dm(p, otherId)             the direct conversation between two people (made once, found after)
 *   create(p, {kind, …})       a group (with the people named) or a channel (an organisation's or a team's)
 *   view(p, id)                one space with its members and pins; a channel of theirs to browse before joining
 *   join / leave / add / patch / mine (mute)
 */
const store = require('./store');
const policy = require('./policy');
const deliver = require('./deliver');
const org = () => require('../org');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const absent = () => bad('No such conversation.', 404);
const users = p => policy.rights(p).includes('users');
/** A message's first words for a list: markdown's marks taken out, lines joined. */
const plain = t => String(t).replace(/```[\s\S]*?```/g, '[code]').replace(/[*_`~#>]+/g, '').replace(/^\s*[-+] /gm, '').replace(/\s+/g, ' ').trim();

/** Everyone in the person's organisation by id: names for titles and authors. */
function names(p) { return new Map(org().people(policy.orgOf(p)).map(x => [x.id, x])); }

function titleOf(s, p, who, members) {
  if (s.kind !== 'dm') return s.name || members.filter(m => m.userId !== p.id).map(m => who.get(m.userId)?.name || 'someone').join(', ') || 'Group';
  const other = members.find(m => m.userId !== p.id);
  return who.get(other?.userId)?.name || 'Someone no longer here';
}

/** A space as its member sees it. */
async function shape(s, p, who = names(p), me = null) {
  const members = await store.members(s.id);
  me = me || members.find(m => m.userId === p.id) || null;
  const last = (await store.messages(s.id, { limit: 1 }))[0] || null;
  return { id: s.id, kind: s.kind, name: s.name, title: titleOf(s, p, who, members), topic: s.topic, audience: s.audience, createdBy: s.createdBy,
    archivedAt: s.archivedAt, lastAt: s.lastAt, lastSeq: s.lastSeq, member: !!me, muted: !!me?.muted, readSeq: me?.readSeq || 0,
    unread: me ? Math.max(0, s.lastSeq - (me.readSeq || 0)) : 0, agentSession: me?.agentSession || null,
    members: members.map(m => ({ id: m.userId, name: who.get(m.userId)?.name || 'Someone no longer here', role: m.role, readSeq: m.readSeq })),
    other: s.kind === 'dm' ? members.find(m => m.userId !== p.id)?.userId || null : null,
    last: last && { id: last.id, seq: last.seq, by: last.agent ? `${who.get(last.authorId)?.name || 'Someone'}'s agent` : who.get(last.authorId)?.name || '',
      text: last.deletedAt ? '(deleted)' : plain(last.text || (last.attachments.length ? '(a file)' : '')).slice(0, 140), at: last.at } };
}

/** The person's own agent conversations, for the top of the list (they open in the harness's own views). */
function agents(p) {
  const access = require('../harness/session-access'), memory = require('../harness/memory');
  const own = require('../harness/own-main').of(p, { create: false });
  const mine = memory.listSessions().sessions.filter(s => !s.archivedAt && s.id !== own && ['work', 'chat'].includes(s.kind) && !s.peopleSpace
    && access.ownerOf(s.id) === p.id).slice(0, 12);
  const row = (s, main) => s && ({ id: s.id, title: main ? 'Your Orchestrator' : s.title, kind: main ? 'orchestrator' : s.kind, state: s.state || 'idle', at: s.updatedAt });
  return [row(own ? memory.getSession(own) : { id: null, updatedAt: null }, true), ...mine.map(s => row(s, false))].filter(Boolean);
}

async function list(p) {
  const who = names(p);
  const spaces = await Promise.all((await store.spacesOf(p.id)).filter(s => !s.archivedAt).map(s => shape(s, p, who, { userId: p.id, ...s.me })));
  const joined = new Set(spaces.map(s => s.id));
  const joinable = (await store.channels(policy.audiencesOf(p))).filter(c => !joined.has(c.id))
    .map(c => ({ id: c.id, kind: 'channel', name: c.name, title: c.name, topic: c.topic, audience: c.audience, member: false }));
  return { me: { id: p.id, name: p.name || who.get(p.id)?.name || '' }, spaces, joinable, agents: agents(p),
    may: { reach: policy.reachOf(p.role), write: policy.rights(p).includes('chat'), channel: policy.mayMakeChannel(p, 'org') === null ? 'org' : policy.mayMakeChannel(p, `team:${p.id}`) === null ? 'team' : null } };
}

/** The space, if `p` may see it: a member, or a channel of their audience (to browse before joining). */
async function access(p, id, { member = true } = {}) {
  const s = await store.getSpace(id);
  if (!s) throw absent();
  const me = await store.memberOf(s.id, p.id);
  if (me) return { s, me };
  if (!member && s.kind === 'channel' && policy.audiencesOf(p).includes(s.audience) && !s.archivedAt) return { s, me: null };
  throw absent();
}

async function view(p, id) {
  const { s, me } = await access(p, id, { member: false });
  return { ...(await shape(s, p, names(p), me)), pins: me ? await store.pins(s.id) : [] };
}

async function dm(p, otherId) {
  if (otherId === p.id) throw bad('A direct message is between two people; write a note to yourself in your Orchestrator.');
  const key = [p.id, String(otherId)].sort().join(':');
  const found = await store.spaceByDm(key);
  if (found) { await store.addMember(found.id, p.id); return view(p, found.id); }
  const why = policy.mayStart(p, otherId);
  if (why) throw bad(why, 403);
  const s = await store.createSpace({ kind: 'dm', orgId: policy.orgOf(p), dmKey: key, by: p.id }, [{ userId: p.id, role: 'member' }, { userId: otherId, role: 'member' }]);
  deliver.space(s, await store.members(s.id), 'space');
  return view(p, s.id);
}

async function create(p, { kind, name, topic = '', members = [], audience = 'org' } = {}) {
  const title = String(name || '').trim();
  if (kind === 'group') {
    const ids = [...new Set((Array.isArray(members) ? members : []).map(String))].filter(id => id !== p.id);
    if (!ids.length) throw bad('A group needs at least one other person.');
    for (const id of ids) { const why = policy.mayStart(p, id); if (why) throw bad(why, 403); }
    const s = await store.createSpace({ kind, name: title, topic, orgId: policy.orgOf(p), by: p.id }, [{ userId: p.id, role: 'owner' }, ...ids.map(userId => ({ userId }))]);
    deliver.space(s, await store.members(s.id), 'space');
    return view(p, s.id);
  }
  if (kind === 'channel') {
    if (!title) throw bad('A channel needs a name.');
    const aud = audience === 'team' ? `team:${p.id}` : String(audience || 'org');
    const why = policy.mayMakeChannel(p, aud);
    if (why) throw bad(why, 403);
    const s = await store.createSpace({ kind, name: title, topic, orgId: policy.orgOf(p), audience: aud, by: p.id }, [{ userId: p.id, role: 'owner' }]);
    deliver.space(s, [], 'space', policy.audienceMembers(p, aud));
    return view(p, s.id);
  }
  throw bad('A new conversation is a group or a channel; a direct message is POST /api/people/dm.');
}

async function join(p, id) {
  const { s, me } = await access(p, id, { member: false });
  if (!me) await store.addMember(s.id, p.id);
  deliver.space(s, await store.members(s.id));
  return view(p, s.id);
}

async function leave(p, id) {
  const { s } = await access(p, id);
  if (s.kind === 'dm') throw bad('A direct message cannot be left; mute it instead.');
  await store.removeMember(s.id, p.id);
  deliver.space(s, await store.members(s.id), 'space', [p.id]);
  return { left: s.id };
}

/** Add people: any member of a group (each one someone they may message); a channel's owner or an admin. */
async function add(p, id, ids = []) {
  const { s, me } = await access(p, id);
  if (s.kind === 'dm') throw bad('A direct message is between two people: start a group to add someone.');
  if (s.kind === 'channel' && me.role !== 'owner' && !users(p)) throw bad('A channel\'s owner or an admin adds people; anyone it is for may join it.', 403);
  const allowed = s.kind === 'channel' ? new Set(policy.audienceMembers(p, s.audience)) : null;
  for (const uid of [...new Set(ids.map(String))]) {
    if (allowed && !allowed.has(uid)) throw bad('That person is not someone this channel is for.', 403);
    if (!allowed) { const why = policy.mayStart(p, uid); if (why) throw bad(why, 403); }
    await store.addMember(s.id, uid);
  }
  deliver.space(s, await store.members(s.id));
  return view(p, s.id);
}

/** Rename, set the topic, put away: a group's or channel's owner, or an admin for a channel. */
async function patch(p, id, b = {}) {
  const { s, me } = await access(p, id);
  if (s.kind === 'dm') throw bad('A direct message has no name of its own.');
  if (me.role !== 'owner' && !(s.kind === 'channel' && users(p)) && !(s.kind === 'group' && b.archived === undefined))
    throw bad('Only its owner (or an admin, for a channel) changes this.', 403);
  const next = {};
  if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 80);
  if (b.topic !== undefined) next.topic = String(b.topic).trim().slice(0, 300);
  if (b.archived !== undefined) next.archivedAt = b.archived ? store.now() : null;
  await store.updateSpace(s.id, next);
  deliver.space(s, await store.members(s.id));
  return view(p, s.id);
}

/** The person's own settings for a space: muted. */
async function mine(p, id, { muted } = {}) {
  const { s } = await access(p, id);
  if (muted !== undefined) await store.setMember(s.id, p.id, { muted: !!muted });
  return view(p, s.id);
}

module.exports = { list, view, access, dm, create, join, leave, add, patch, mine, names, titleOf };

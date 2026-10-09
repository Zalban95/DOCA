'use strict';

/**
 * Where a hive-chat change goes: the members' open pages (the live feed's `chat` topic, to them alone — live/routes.js)
 * and their devices that follow the harness (`people.message` durable, `people.typing` and `people.read` ephemeral).
 * A direct message or a mention also notifies: an `alert` on the person's own devices that show one (reach-shows.js),
 * unless the space is muted for them or the device is in its quiet hours. A channel's ordinary message notifies nobody.
 */
const bus = () => require('../api-v1/bus');
const devices = () => require('../api-v1/devices');
const { hasScope } = require('../api-v1/scopes');

const live = (spaceId, what, to, extra = {}) => require('../live').changed('chat', spaceId, what, { to, ...extra });

/** The person's own devices that follow their conversations (a device paired before accounts has no person: none). */
const followers = userId => devices().list().filter(d => !d.revokedAt && d.userId === userId && d.kind !== 'browser' && hasScope(d.scopes, 'harness:chat'));

function quietNow(d) {
  try { return require('../api-v1/prompts').inQuietHours(require('../api-v1/profiles').get(d.id)); } catch { return false; }
}

/** Whether a message should notify `userId`: a direct message, or one naming them — never their own, never muted. */
function notifies(space, m, member) {
  if (!member || member.muted || m.authorId === member.userId && !m.agent) return false;
  if (m.agent && m.authorId === member.userId) return false;   // their own agent answering them
  return space.kind === 'dm' || (m.mentions || []).includes(member.userId);
}

const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** A new, edited or deleted message, or its reactions changed: to every member. */
function message(space, m, members, what = 'new') {
  const to = members.map(x => x.userId);
  live(space.id, what, to, { message: m });
  const who = new Map(require('../org').people(space.orgId).map(x => [x.id, x]));
  const authorName = m.author?.name || '';
  for (const member of members) {
    const notify = what === 'new' && notifies(space, m, member);
    const title = require('./spaces').titleOf(space, { id: member.userId }, who, members);   // a DM is named by the other person
    const head = { id: space.id, kind: space.kind, name: title };
    for (const d of followers(member.userId)) {
      try { bus().publish(d.id, 'people.message', { spaceId: space.id, space: head, what, message: m, notify: notify && !quietNow(d) }); } catch { /* a device never breaks the chat */ }
    }
    if (notify) alert(member.userId, space, m, authorName, title);
  }
}

/** One notice on the person's devices that show one: who wrote, where, and the first words. */
function alert(userId, space, m, authorName, title) {
  const shows = require('../harness/reach-shows').shows;
  const who = m.agent ? `${authorName}'s agent` : authorName || 'Someone';
  const where = space.kind === 'dm' ? who : `${who} in ${title || space.name || 'a group'}`;
  for (const d of devices().list()) {
    if (d.revokedAt || d.userId !== userId || !hasScope(d.scopes, 'interact') || !shows(d) || quietNow(d)) continue;
    if (require('../api-v1/profiles').get(d.id).prompts?.receive === false) continue;
    try {
      bus().publish(d.id, 'alert', { id: `alt_${m.id}`, title: short(where, 120), body: [{ type: 'text', text: short(m.text || '(a file)', 600) }],
        priority: 'normal', haptic: true, from: 'people', ext: { people: { spaceId: space.id, messageId: m.id } } }, { ttlSec: 6 * 3600 });
    } catch { /* a device never breaks the chat */ }
  }
}

/** Someone is typing (ephemeral, never stored). */
function typing(space, members, by) {
  const to = members.map(x => x.userId).filter(id => id !== by.id);
  live(space.id, 'typing', to, { by });
  for (const id of to) for (const d of followers(id)) try { bus().publish(d.id, 'people.typing', { spaceId: space.id, by }); } catch { /* gone */ }
}

/** Someone read up to `seq` (a receipt: to the others, ephemeral). */
function read(space, members, by, seq) {
  const to = members.map(x => x.userId);
  live(space.id, 'read', to, { by, seq });
  for (const id of to) for (const d of followers(id)) try { bus().publish(d.id, 'people.read', { spaceId: space.id, by, seq }); } catch { /* gone */ }
}

/** The space itself changed (name, members, pins): its members' pages read it again. */
function space(spaceRow, members, what = 'space', extraTo = []) {
  live(spaceRow.id, what, [...new Set([...members.map(x => x.userId), ...extraTo])]);
}

module.exports = { message, typing, read, space, notifies, followers };

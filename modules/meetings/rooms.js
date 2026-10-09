'use strict';

/**
 * Who is in a meeting now, and the messages between their pages (signalling) — in memory, like the turns: a restart
 * empties the rooms, and every page joins again by itself when its live stream comes back.
 *
 * A peer is one open page: its live stream's `screen` (live/routes.js), so a person on a phone and on a desk is two
 * peers. Media flows browser to browser (WebRTC, a mesh: each peer sends to every other), and the hub only relays what
 * the pages say to each other — offers, answers, ICE candidates — on the live feed's `meeting` topic, each change
 * addressed to one screen (`to`) or to the room. The topology is a field (`mesh`), so a selective forwarding unit can
 * take over a larger room later without the pages' messages changing shape: an SFU is one more peer every page talks
 * to. MAX is what a mesh carries well — each peer uploads its video once per other peer.
 *
 * Events for others: `events` emits joined / left / shared / said / ended (the hive chat hears them; meetings/hooks).
 */
const { EventEmitter } = require('events');

const MAX = 6;
const CHAT_KEEP = 200;
const rooms = new Map();          // meeting id → { id, title, peers: Map(screen → peer), chat: [], startedAt }
const events = new EventEmitter();
events.setMaxListeners(0);

const live = () => require('../live');
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const max = () => { try { return Math.max(2, Math.min(16, Number(require('../settings-schema').value('meetings.maxPeople')) || MAX)); } catch { return MAX; } };

const peerView = p => ({ peer: p.screen, personId: p.personId, name: p.name, sharing: p.sharing ? { ...p.sharing } : null, media: p.media, joinedAt: p.joinedAt });
const view = r => r && { id: r.id, title: r.title, topology: 'mesh', max: max(), startedAt: r.startedAt, peers: [...r.peers.values()].map(peerView) };

function tell(roomId, what, extra = {}) { live().changed('meeting', roomId, what, extra); }

/** A page joins: the room as it is now, for it to call every peer already there (the newcomer calls; see meet-mesh.js). */
function join(meeting, person, screen, media = {}) {
  if (!screen) throw bad('This page has no live stream yet; it joins when it has one.', 409);
  let r = rooms.get(meeting.id);
  if (!r) { r = { id: meeting.id, title: meeting.title, peers: new Map(), chat: [], startedAt: new Date().toISOString() }; rooms.set(meeting.id, r); }
  if (!r.peers.has(screen) && r.peers.size >= max())
    throw bad(`This meeting is full: ${max()} pages is what a meeting carries for now, each sending to every other (meetings.maxPeople).`, 409);
  const fresh = !r.peers.has(screen);
  r.peers.set(screen, { screen, personId: person.id, name: person.name || 'Someone', orgId: person.orgId, role: person.role,
    sharing: null, media: { audio: !!media.audio, video: !!media.video }, joinedAt: new Date().toISOString() });
  if (fresh) {
    tell(meeting.id, 'joined', { peer: screen, personId: person.id, name: person.name });
    events.emit('joined', { meeting, person, peers: r.peers.size });
  }
  return { room: view(r), chat: r.chat.slice(-50), me: screen };
}

function peerOf(roomId, screen) {
  const p = rooms.get(roomId)?.peers.get(screen);
  if (!p) throw bad('This page is not in the meeting.', 409);
  return p;
}

function leave(roomId, screen, why = 'left') {
  const r = rooms.get(roomId);
  const p = r?.peers.get(screen);
  if (!p) return false;
  r.peers.delete(screen);
  require('./control').endFor({ roomId, screen }, why === 'closed' ? 'the page closed' : 'they left');
  tell(roomId, 'left', { peer: screen, personId: p.personId, name: p.name });
  events.emit('left', { roomId, personId: p.personId, peers: r.peers.size });
  if (p.sharing) require('./audit').share(roomId, p, false, 'they left');
  if (!r.peers.size) { rooms.delete(roomId); events.emit('ended', { roomId, title: r.title }); }
  return true;
}

/** A page went away (its live stream closed): out of every room it was in. */
function screenClosed(screen) { for (const id of [...rooms.keys()]) leave(id, screen, 'closed'); }

/** One page's message to another (an offer, an answer, a candidate): relayed as it is, to that page only. */
function signal(roomId, screen, to, data) {
  peerOf(roomId, screen);
  if (!rooms.get(roomId).peers.has(String(to || ''))) throw bad('That page has left the meeting.', 410);
  const size = JSON.stringify(data || null).length;
  if (size > 64 * 1024) throw bad('A signalling message is at most 64 KB.', 413);
  tell(roomId, 'signal', { to: String(to), from: screen, data });
}

/** Microphone and camera on or off: what the others draw (their own tracks decide what flows). */
function media(roomId, screen, m = {}) {
  const p = peerOf(roomId, screen);
  p.media = { audio: !!m.audio, video: !!m.video };
  tell(roomId, 'media', { peer: screen, media: p.media });
}

/** Screen sharing, started and stopped by the sharer's own page: which stream it is, and its size (for control). */
function share(roomId, screen, on, info = {}) {
  const p = peerOf(roomId, screen);
  const was = !!p.sharing;
  if (on) {
    const w = Math.round(Number(info.width) || 0), h = Math.round(Number(info.height) || 0);
    p.sharing = { streamId: String(info.streamId || '').slice(0, 100), width: w > 0 && w < 20000 ? w : null, height: h > 0 && h < 20000 ? h : null,
      surface: ['monitor', 'window', 'browser'].includes(info.surface) ? info.surface : null, since: p.sharing?.since || new Date().toISOString() };
  } else {
    p.sharing = null;
    require('./control').endFor({ roomId, sharer: screen }, 'the share stopped');
  }
  tell(roomId, 'shared', { peer: screen, name: p.name, sharing: p.sharing });
  if (was !== !!on) { require('./audit').share(roomId, p, !!on); events.emit('shared', { roomId, personId: p.personId, on: !!on }); }
  return p.sharing;
}

/** A line in the room's chat (kept while the room is open; the hive chat may carry it on — hooks.js). */
function say(roomId, screen, text) {
  const p = peerOf(roomId, screen);
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) throw bad('Nothing to say.');
  const line = { at: new Date().toISOString(), personId: p.personId, name: p.name, text: t };
  const r = rooms.get(roomId);
  r.chat.push(line); if (r.chat.length > CHAT_KEEP) r.chat.splice(0, r.chat.length - CHAT_KEEP);
  tell(roomId, 'said', { line });
  events.emit('said', { roomId, line });
  return line;
}

/** Whether a page with this live stream hears a change on the `meeting` topic (live/routes.js). */
function hears(screen, person, change) {
  if (change.to) return change.to === screen;
  if (change.personIds) return !!person?.id && change.personIds.includes(person.id);   // a ring, a meeting's own news
  return !!rooms.get(change.id)?.peers.has(screen);
}

const get = id => rooms.get(id) || null;
const snapshot = id => view(rooms.get(id));
const all = () => [...rooms.values()].map(view);

/** End a room (cancelled, or its organizer ended it for everyone): every page is told, every share and control ends. */
function close(roomId, why = 'the meeting ended') {
  const r = rooms.get(roomId);
  if (!r) return;
  require('./control').endFor({ roomId }, why);
  tell(roomId, 'closed', { why });
  rooms.delete(roomId);
  events.emit('ended', { roomId, title: r.title });
}

let started = false;
function start() {
  if (started) return;
  started = true;
  live().feed.on('screen-closed', screenClosed);
}

module.exports = { join, leave, signal, media, share, say, hears, get, snapshot, all, close, start, peerOf, events, MAX, max };

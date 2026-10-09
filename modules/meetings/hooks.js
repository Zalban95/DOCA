'use strict';

/**
 * What other parts of the hive hear from meetings, and how they start one — one place, so the hive chat (branch
 * hive-chat) and later the agent need no knowledge of rooms or WebRTC:
 *
 *   events   an EventEmitter: created {meeting, by} · joined {meeting, person, peers} · left {roomId, personId, peers}
 *            · shared {roomId, personId, on} · said {roomId, line} · ended {roomId, title}
 *            The hive chat posts "<name> started a call" in the space a meeting names (`meeting.space`) and may carry
 *            the room's chat lines (`said`) into that space.
 *   call(person, {people, space, title})   a call now, as `meetingStart()` in a page does: the room, its link, rung
 *
 * The agent in a room (later): a room's peers are pages; the agent would be one more peer that the hub itself hosts —
 * an audio track in, speech out through the hive's voice (realtime/pipeline.js speaks this wire already) — joining
 * with `rooms.join(meeting, {id: 'agent', name}, '<its own screen id>')` and answering the signalling messages
 * addressed to it. Nothing in the pages changes: they call every peer the room lists.
 */
const events = require('./rooms').events;

const emit = (name, payload) => { try { events.emit(name, payload); } catch { /* a listener never breaks a meeting */ } };

/** A call now with these people (ids), for the hive chat's call button on the hub's side. */
async function call(person, { people = [], space = null, title = '' } = {}, req = null) {
  return require('./index').create(person, { now: true, people, space, title }, req);
}

module.exports = { events, emit, call };

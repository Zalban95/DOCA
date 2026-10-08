'use strict';

/**
 * Every page live on every screen (TODO H10.5, CONSTITUTION P18; asked 2026-10-06): a page open on another device —
 * a conversation, the Projects tab, the missions bar, a folder in Files — redraws as the work it shows changes, so work
 * started by voice on a phone is watched on whichever screen is near.
 *
 * One feed of changes, `{n, topic, id, what, at, …}`, made from what already happens:
 *   conversation   a turn started or ended, a row was written (a tool's result, a message read from the inbox), a
 *                  tool was called, that the model is thinking (every 2 s at most), and the answer's text as it
 *                  streams (`delta`) — from agent.events and
 *                  lifecycle.changed()
 *   missions       a specialist's mission started, stepped or ended — from missions.announce()
 *   files          something changed in a folder a screen is looking at — live/watch.js, only the folders asked for
 *   ask            a mission asks its person to use a machine (harness/mission-asks.js) — only that person's pages
 * A change says what changed, never more than the page would read through its own route; the stream (routes.js)
 * gives each viewer only what they may open.
 */
const { EventEmitter } = require('events');

const feed = new EventEmitter();
feed.setMaxListeners(0);   // one per open screen
let seq = 0;

/** Something a screen may be showing changed. */
function changed(topic, id = null, what = 'changed', extra = {}) {
  try { feed.emit('change', { n: ++seq, topic, id, what, at: Date.now(), ...extra }); } catch { /* a screen never breaks the work */ }
}

/** A turn's events, as conversation changes: rows and tool names, and the text while it streams. */
const ROW = new Set(['tool_result', 'user_added', 'image', 'compacted', 'handoff', 'proposal']);
const THINKING_EVERY_MS = 2000;
const _thought = new Map();   // sessionId → when `thinking` was last said: that it thinks, not what, and not per token
function onTurnEvent(evt) {
  if (!evt?.sessionId) return;
  if (evt.type === 'thinking') {
    if (Date.now() - (_thought.get(evt.sessionId) || 0) < THINKING_EVERY_MS) return;
    _thought.set(evt.sessionId, Date.now());
    return changed('conversation', evt.sessionId, 'thinking');
  }
  _thought.delete(evt.sessionId);
  if (evt.type === 'text' && evt.text) return changed('conversation', evt.sessionId, 'text', { delta: String(evt.text) });
  if (evt.type === 'tool_call') return changed('conversation', evt.sessionId, 'tool', { tool: evt.name || null });
  if (ROW.has(evt.type)) changed('conversation', evt.sessionId, 'row');
}

let started = false;
function start() {
  if (started) return;
  started = true;
  require('../harness/agent').events.on('event', onTurnEvent);
}

module.exports = { feed, changed, start, onTurnEvent };

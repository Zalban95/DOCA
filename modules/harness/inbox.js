'use strict';

/**
 * A message to a conversation that is working is never refused (decided with
 * Al 2026-10-04: "I don't have to wait for a running process to be able to
 * communicate with the orchestrator").
 *
 * It waits here instead, and goes in one of two ways:
 *   - read mid-turn: before its next step, the running turn takes every waiting
 *     message into its transcript as a user row (turn/agent.js runTurn → takeInto),
 *     so the agent sees "the person added …" and can answer, change course or
 *     hand the job off — one conversation, one history, nobody blocked;
 *   - the next turn: what is still waiting when a turn ends starts the next one
 *     at once (agent.turn → next), as the person who wrote it.
 *
 * One rule for every entry point: the panel's chats, the floating chat, the
 * Projects chat, /api/v1 devices and a task handed down to a busy work chat.
 * Each item may carry `onRead` (taken into a running turn), `start` (how to run
 * it as a turn of its own, so a device's turn is published to the device) and
 * `onAnswer` (the reply of the turn that read it). In memory, like the turn it
 * waits for: a restart ends running turns, and their waiting messages with them.
 */
const crypto = require('crypto');

const _boxes = new Map();   // sessionId -> [item]
const MAX_WAITING = 20;

/** Put a message in a conversation's inbox. @returns {{ id, position }} */
function put(sessionId, { message, client = null, attachments = [], onRead = null, start = null, onAnswer = null }) {
  const box = _boxes.get(sessionId) || [];
  if (box.length >= MAX_WAITING)
    throw Object.assign(new Error(`${MAX_WAITING} messages are already waiting for this conversation; let it catch up.`), { status: 429 });
  const item = { id: `q_${crypto.randomBytes(5).toString('hex')}`, message: String(message), client, attachments, onRead, start, onAnswer, at: new Date().toISOString() };
  box.push(item);
  _boxes.set(sessionId, box);
  return { id: item.id, position: box.length };
}

function waiting(sessionId) { return (_boxes.get(sessionId) || []).map(i => ({ id: i.id, message: i.message, at: i.at, from: i.client?.name || null })); }

function take(sessionId) {
  const box = _boxes.get(sessionId) || [];
  _boxes.delete(sessionId);
  return box;
}

/** Withdraw one waiting message (its sender went away before it was read, or asked). */
function withdraw(sessionId, id) {
  const box = (_boxes.get(sessionId) || []).filter(i => i.id !== id);
  if (box.length) _boxes.set(sessionId, box); else _boxes.delete(sessionId);
}

/** The running turn's side: every waiting message into the transcript, as the people who wrote them. */
function takeInto(session, { append, say }) {
  const slash = require('./slash');
  // A command a device sent while the conversation worked (/loop stop, /skill…) is carried out, not read as words.
  const items = take(session.id).filter(i => {
    if (!slash.parse(i.message)) return true;
    slash.intercept({ message: i.message, sessionId: session.id, client: i.client })
      .then(r => { try { i.onRead?.(); i.onAnswer?.(r); } catch { /* its sender may be gone */ } });
    return false;
  });
  for (const i of items) {
    append(i);
    say({ type: 'user_added', id: i.id, text: i.message, from: i.client?.name || null });
    try { i.onRead?.(); } catch { /* a sender that went away does not stop the turn */ }
  }
  return items;
}

module.exports = { put, waiting, take, withdraw, takeInto, MAX_WAITING };

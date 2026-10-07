'use strict';

/**
 * The calls open now, by conversation, and what lands in a conversation while its person is on a call (asked
 * 2026-10-07: "inject the harness's response into the call"). A call hands its quick requests to its conversation as
 * turns; the bigger ones go on in a work chat, a specialist, or past `realtime.waitSec` — and their outcome used to
 * reach the person only as a notification, after they had stopped listening. While the call is open it is said in the
 * call instead:
 *
 *   - an automatic turn in the call's conversation (the Orchestrator telling what its work chats reported) — `landed`;
 *   - a work chat the call's own turn handed work to, when its job ends and nobody else will say it (its parent is
 *     not the call's conversation, so no woken Orchestrator speaks there) — `follow`, then `reported`;
 *   - a mission the call's conversation dispatched itself, when it finishes (a mission sent by the Orchestrator wakes
 *     nobody; one sent by a working work chat wakes that chat, whose own turn is then said) — the live feed.
 *
 * Never another person's: a call is registered under a conversation its person may use, and each is checked again
 * when something is said. After the call ends, the same outcome is a notification as before.
 */
const _open = new Map();     // sessionId → Set<call>: { person, deviceId, notice(text, title) }
const _follow = new Map();   // a work chat's id → the conversation of the call that started it
const _said = new Set();     // missions already said, so a later "seen" or "put away" of the same one is not

const FINAL_JOB = ['done', 'failed', 'blocked', 'question', 'stopped', 'dropped', 'stalled'];

/** The first sentence or two of a report, which is written for an agent and read here to a person. */
function gist(text, n = 2) {
  const s = require('./pipeline').sentences(text).slice(0, n).join(' ');
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
}

let _listening = false;
function listen() {
  if (_listening) return;
  _listening = true;
  require('../live').feed.on('change', c => {
    if (c.topic !== 'missions' || !['done', 'failed'].includes(c.what) || _said.has(c.id)) return;
    let m;
    try { m = require('../agents/missions').get(c.id); } catch { return; }
    if (!m?.by || !_open.has(m.by)) return;
    const lead = require('../harness/memory').getSession(m.by);
    if (lead?.job && !FINAL_JOB.includes(lead.job.state)) return;   // a working work chat is woken by it, and its turn is said
    _said.add(c.id);
    const what = `${m.label || m.agentId} ${m.state === 'done' ? 'finished' : 'did not finish'}`;
    speak(m.by, `${what}. ${gist(m.result || m.error || '')}`.trim(), m.label || m.agentId);
  });
}

/** Register a call; returns the function that ends its registration. */
function open(sessionId, call) {
  listen();
  if (!_open.has(sessionId)) _open.set(sessionId, new Set());
  _open.get(sessionId).add(call);
  return () => {
    const set = _open.get(sessionId);
    if (!set) return;
    set.delete(call);
    if (!set.size) {
      _open.delete(sessionId);
      for (const [chat, sid] of _follow) if (sid === sessionId) _follow.delete(chat);
    }
  };
}

/** Say `text` in every call open on this conversation whose person may use it; whether one heard it. */
function speak(sessionId, text, title = '') {
  const calls = [..._open.get(sessionId) || []];
  const access = require('../harness/session-access');
  let n = 0;
  for (const c of calls) {
    let may = false;
    try { may = access.mayUse(c.person, sessionId); } catch { /* a conversation gone: nobody's */ }
    if (!String(text || '').trim() || !may) continue;
    try { c.notice(String(text), title); n++; } catch { /* a call that is ending */ }
  }
  return n > 0;
}

/** Whether this device is on a call in this conversation (its push for the same words can stay quiet). */
const inCall = (deviceId, sessionId) => [..._open.get(sessionId) || []].some(c => c.deviceId && c.deviceId === deviceId);

/** A work chat the call's turn handed work to: its outcome is said in the call. */
function follow(sessionId, chatId) { if (_open.has(sessionId) && chatId) _follow.set(chatId, sessionId); }

/** An automatic turn ended in a conversation: said in its calls. */
function landed(sessionId, result) {
  if (!result?.text || !_open.has(sessionId)) return false;
  return speak(sessionId, result.text, 'the hive');
}

/** A work chat filed a final report (organization.report): said in the call that started it, unless another will. */
function reported(chatId, note) {
  const sid = _follow.get(chatId);
  if (!sid) return false;
  _follow.delete(chatId);
  const s = require('../harness/memory').getSession(chatId);
  if (s?.parentId === sid) return false;   // the call is on its parent, whose woken turn says it (supervisor.deliver)
  return speak(sid, `${s?.title || 'The work'}: ${note.type === 'done' ? '' : `${note.type}. `}${gist(note.text)}`, s?.title || '');
}

module.exports = { open, speak, inCall, follow, landed, reported, gist };

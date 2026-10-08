'use strict';

/**
 * Whether somebody is reading the panel right now (TODO.md, "A plan is shown,
 * not buried": the chat is always told; the devices when the chat is not
 * being read).
 *
 * The panel says so itself: while its page is visible it sends a heartbeat
 * every 30 s, and one more with `visible: false` when it is hidden. Nothing
 * here guesses from sockets or SSE connections — a tab left open behind other
 * windows holds a connection and is read by nobody.
 *
 * In memory on purpose: presence is a reading, not state, and after a restart
 * "not seen since the server started" is the honest answer.
 */
const FRESH_MS = 75e3;   // two missed heartbeats and a margin
const seen = new Map();  // userId → { at, visible, name }
let _lastVisibleAt = 0;  // the last moment any page was seen visible: a visible beat, or a page hidden that was visible

function beat(user, visible) {
  if (!user?.id) return;
  if (visible || seen.get(user.id)?.visible) _lastVisibleAt = Date.now();
  seen.set(user.id, { at: Date.now(), visible: !!visible, name: user.name || user.email || 'someone' });
}

/** { atPanel, who, ago } — ago in ms since the last visible heartbeat, null when never. For one person with `userId`. */
function state(now = Date.now(), userId = null) {
  let last = null;
  for (const [id, v] of seen) if ((!userId || id === userId) && v.visible && (!last || v.at > last.at)) last = v;
  if (!last) return { atPanel: false, who: null, ago: null };
  return { atPanel: now - last.at < FRESH_MS, who: last.name, ago: now - last.at };
}

const human = ms => (ms < 90e3 ? `${Math.round(ms / 1000)}s` : ms < 90 * 60e3 ? `${Math.round(ms / 60e3)} min` : `${Math.round(ms / 3600e3)} h`);

/** One line for the agent's per-step readings (turn/prompt.js liveBlock). */
function line(now = Date.now()) {
  const s = state(now);
  if (s.atPanel) return `owner: at the panel now (${s.who}) — the chat is in front of whoever is there.`;
  if (s.ago === null) return 'owner: the panel has not been open since the server started — a device (tell_device) is how to reach them.';
  return `owner: not at the panel (last seen ${human(s.ago)} ago) — what matters reaches them on a device (tell_device), not only in the chat.`;
}

/**
 * `{ quiet: true }` while somebody is reading the panel, else `{}` — spread into
 * the hub's *own* pushes (an automatic reply, a mission or work chat starting
 * and finishing). PROTOCOL §11.4: a client updates what it shows and raises no
 * notification; one that does not know the field notifies as before. Never on
 * a turn a device asked for: that device wants its answer. Per device: quiet only
 * when *that device's owner* is the one at the panel — a member reading the panel
 * says nothing about whether the owner has seen it (audit 2026-10-04).
 */
function quietFlag(userId, now = Date.now()) { return userId && state(now, userId).atPanel ? { quiet: true } : {}; }

/** When a page of the hub was last seen visible, by anyone (service-life/: the idle clock starts after it); 0 when never. */
const lastVisibleAt = () => _lastVisibleAt;

function _reset() { seen.clear(); _lastVisibleAt = 0; }

module.exports = { beat, state, line, quietFlag, lastVisibleAt, FRESH_MS, _reset };

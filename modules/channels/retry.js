'use strict';

/**
 * A channel that could not reach its service when it started tries again by itself (2026-10-15: after a power cut the
 * hub came up before its network, Telegram's first getMe failed, and the bot stayed off until someone pressed Start).
 * 30 s, then doubling, at most every 10 min; a successful start or a stop ends it; each retry is the channel's own
 * start(), so its switch, token and errors are read again every time. In memory: a restart begins again.
 */
const FIRST_MS = 30e3, MAX_MS = 10 * 60e3;
const _later = new Map();   // channel name → { timer, wait }

function later(name, start) {
  const was = _later.get(name);
  const wait = was ? Math.min(was.wait * 2, MAX_MS) : FIRST_MS;
  clearTimeout(was?.timer);
  const timer = setTimeout(() => { Promise.resolve().then(start).catch(() => {}); }, wait);
  timer.unref?.();
  _later.set(name, { timer, wait });
  return wait;
}

function clear(name) { clearTimeout(_later.get(name)?.timer); _later.delete(name); }

/** The time to the next try, for status(): null when none is planned. */
const next = name => _later.get(name)?.wait ?? null;

module.exports = { later, clear, next, FIRST_MS, MAX_MS };

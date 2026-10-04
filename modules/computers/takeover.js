'use strict';

/**
 * A person at a computer's keyboard (TODO H13.3; OpenDots' take-over and hand-back). While someone drives it
 * through the live view (vnc.js, `?drive=1`), the agent's own input on that computer — mouse, keys, and the
 * browser actions that click, type or navigate — waits: two hands on one mouse help nobody. Reading (screens,
 * snapshots, files, the shell) carries on. The first call after the person hands it back says so, because what
 * the agent last saw may no longer be on the screen.
 */
const INPUT = /^mcp__computer-([a-f0-9]+)__(desktop_click|desktop_type|desktop_key|browser_open|browser_click|browser_type|browser_back)$/;
const ANY = /^mcp__computer-([a-f0-9]+)__/;

/** A refusal while a person drives, or null. */
function before(name) {
  const m = INPUT.exec(name);
  if (!m || !require('./vnc').driving(m[1])) return null;
  return `Not run: a person is driving computer ${m[1]} right now (they took over from the live view). Your input waits until they hand it back — `
    + 'look with screenshot or browser_snapshot meanwhile, or do something else and try again later.';
}

/** The result, with one line on top the first time after a hand-back. */
function after(name, result) {
  const m = ANY.exec(name);
  const vnc = require('./vnc');
  const at = m && vnc.handedBack(m[1]);
  if (!at) return result;
  vnc.clearHandBack(m[1]);
  return `[A person drove this computer until ${at} and handed it back. The screen may have changed: take a screenshot or a browser_snapshot before acting on what you saw earlier.]\n${result}`;
}

module.exports = { before, after };

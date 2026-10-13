'use strict';

/**
 * A refusal because a switch is off, said so the panel can ask instead of only telling (asked 2026-10-13, from the Cast
 * sheet: "let there be a question with approval button and the link to the settings page"). The error carries `needs`:
 *
 *   what      the switch in a person's words ("Casting to devices on this network")
 *   why       one sentence on what switching it on does
 *   setting   its prefs path, when it is one (`cast.door`)
 *   route     the call that switches it on, and `body` — the same one the switch's own box calls; none when it is set up
 *             rather than switched (a model, a service's address): the panel then offers its settings alone
 *   password  whether that call asks for the password (auth/guarded.js); the panel's fetch asks when it does
 *   page, card, field   where it lives, for "Open its settings" (the header search's own jump, global-search.js)
 *   right     who may switch it (auth/rights.js); `body()` turns it into `mayChange` for the person asking
 *
 * public/js/lib/switch-ask.js draws the question: Switch on (then the action runs again), Open its settings, Not now.
 */
const off = (message, needs) => Object.assign(new Error(message), { status: 409, code: 'switch_off', needs: { right: 'host', password: false, ...needs } });

/** The JSON answer for an error: its words, and when it is a switch that is off, what the panel needs to ask. */
function body(e, req) {
  if (e?.code !== 'switch_off' || !e.needs) return { error: e.message, ...(e.code ? { code: e.code } : {}) };
  const { right, ...needs } = e.needs;
  const mayChange = !!req?.auth && require('./auth/rights').can(req.auth.role, right);
  return { error: e.message, code: 'switch_off', needs: { ...needs, mayChange } };
}

/** The same for something that must be set up (a model, an address): where, no switch. */
const unset = (message, needs) => off(message, { route: null, ...needs });

module.exports = { off, unset, body };

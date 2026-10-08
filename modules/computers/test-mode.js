'use strict';

/**
 * Test computers (the owner's decision of 2026-10-08, self-test #7 option b). Every Tester routed around its own
 * computer's browser guard — the desktop keyboard, xdotool, raw CDP — to test a sign-up or a sign-in as a person would.
 * So a computer made *for testing* lets the agent type the test account's password it chose itself and click sign-in
 * without the forced ask; paying stays a person's (clients/computer/tools.js signInOnly()), and a saved login is never
 * filled into one (logins.js).
 *
 * The mark is the record's `test`: set when an agent's `computer` tool makes one with `test: true`, or by a person in
 * the Computers tab — with the password (auth/guarded.js), since it loosens a guard. Never on a computer a specialist
 * keeps (`agentType`: its desktop holds sign-ins), never inherited, and never by the agent on a computer that exists:
 * the tool has no action for it. The computer hears it from the hub, with the hub's key, each time it connects.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** Why this computer cannot be a test computer, or null. */
function refuse(c) {
  if (c.agentType) return `${c.name} is kept for a specialist (its desktop keeps sign-ins and files): it is never a test computer. Make a new one for testing.`;
  if (!c.fillKey) return `${c.name} was made before test computers existed: make a new one.`;
  return null;
}

/** Tell the computer what it is. False when it cannot hear it (stopped, or built from an image older than this). */
async function apply(c) {
  if (!c.fillKey) return false;
  try { await require('../logins').computerCall(c, 'test_mode', { on: !!c.test, key: c.fillKey }); return true; } catch { return false; }
}

/** A person marks or unmarks a computer (the route asks for the password to mark one). */
async function mark(id, on) {
  const computers = require('./index');
  const c = computers.need(String(id || ''));
  const no = on ? refuse(c) : null;
  if (no) throw bad(no, 409);
  computers.patch(c.id, { test: !!on });
  const applied = await apply({ ...c, test: !!on });
  return { ...computers.view({ ...c, test: !!on }), applied };
}

module.exports = { refuse, apply, mark };

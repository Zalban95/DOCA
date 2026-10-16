'use strict';

/**
 * One rule for every kind of check (checks/; review of 2026-10-16): a requirement the contract asked for that could not
 * be verified — a program missing, a file that cannot show it — does not hold. It fails, naming what could not be
 * looked at and what to install. A look the check makes by default (a PDF laid out cleanly, a video's text) that could
 * not be made is said as "not verified" and does not fail the work: nobody asked for it.
 *
 *   problems   what is wrong                                       → fails
 *   unproven   asked, and could not be verified (with why)         → fails, as "could not verify …"
 *   unverified looked at by default, and could not be (with why)   → said, passes
 */
function verdict({ problems = [], unproven = [], unverified = [], facts = '' }) {
  const all = [...problems, ...unproven.map(u => `could not verify ${u}`)];
  const tail = `${facts}${unverified.length ? `; not verified: ${unverified.join('; ')}` : ''}`;
  return all.length ? { ok: false, why: `${all.join('; ')} (${tail})` } : { ok: true, why: tail };
}

module.exports = { verdict };

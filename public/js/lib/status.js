/* ═══════════════════════════════════════════════════════
   Status lines: the one place a status message is shown and timed out.
   ═══════════════════════════════════════════════════════ */

/** How long a status line that is not an error stays up. */
const STATUS_CLEAR_MS = 3000;

/** The pending clear for each element, so the next line can cancel it. */
const STATUS_TIMERS = new WeakMap();

/**
 * Set text + class on a status element, and decide how long the line lives.
 *
 * The rule is "success fades, errors stay". Three seconds is not a new number —
 * it is what the few panels that cleared their own line already used — but it
 * is now one number in one place instead of a `setTimeout` behind every third
 * call site, and the lines that never cleared at all now clear too. A ✗ is the
 * exception, and it is the point of the rule: it is the one message that has to
 * survive the user looking away, because a failure that has erased itself reads
 * as nothing having happened — in a panel whose whole job is saying when
 * something did not.
 *
 * `opts.clear` overrides the schedule for one call: a number of ms, or 0 for a
 * line that reports a standing state (why a toggle is greyed out, which service
 * is running) rather than an event. Those are replaced by the next report, not
 * by a clock.
 *
 * @param {HTMLElement} el
 * @param {string} msg
 * @param {string} [cls] - 'ok' | 'err' | 'info' | 'warn'
 * @param {{clear?: number}} [opts]
 */
function setStatus(el, msg, cls, opts = {}) {
  if (!el) return;

  // Otherwise the previous line's clear fires under this one: a ✓ schedules a
  // wipe, the next call draws a ✗, and three seconds later the stale timer
  // erases an error nobody has read yet.
  const pending = STATUS_TIMERS.get(el);
  if (pending) { clearTimeout(pending); STATUS_TIMERS.delete(el); }

  el.textContent = msg;
  el.className = `status-line ${cls || ''}`;
  if (!msg) return;   // an empty message is how callers wipe a line

  // An error is the exception; an explicit `clear` on the call beats both.
  const ms = opts.clear != null ? opts.clear : cls === 'err' ? 0 : STATUS_CLEAR_MS;
  if (ms > 0) STATUS_TIMERS.set(el, setTimeout(() => setStatus(el, ''), ms));
}

'use strict';

/**
 * The Admin overview's fixed words (Hub → Admin; CONSTITUTION's "visibility is mechanical"): every line is a template
 * filled with numbers, states and names read from records — no model writes here. A line is
 *   { id, label, value, state, go, sub? }
 *   state  ok | info | ask (something waits for a person) | err (something is wrong)
 *   go     where it is handled: a page id (`apikeys`, `live`, `harness`, `chronicle`) or `settings/<section>`
 */
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** "4 min", "3 h", "2 days" — how long, in the words a person reads at a glance. */
function span(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < MIN) return 'under a minute';
  if (n < HOUR) return `${Math.round(n / MIN)} min`;
  if (n < 2 * DAY) return `${Math.round(n / HOUR)} h`;
  return `${Math.round(n / DAY)} days`;
}

/** "3 h ago", or the template's word for never. */
const ago = (iso, now = Date.now()) => (iso && Number.isFinite(Date.parse(iso)) ? `${span(now - Date.parse(iso))} ago` : null);

function bytes(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return null;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const line = (id, label, value, state = 'ok', go = null, sub = null) => ({ id, label, value: String(value ?? '—'), state, go, ...(sub ? { sub } : {}) });

module.exports = { span, ago, bytes, plural, line, MIN, HOUR, DAY };

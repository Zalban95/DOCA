'use strict';

/**
 * Services nothing uses, stopped (asked 2026-10-08: they "keep running and holding GPU memory when nothing uses them").
 * Every SWEEP_MS, a service is stopped when all of these hold:
 *   - its idle minutes are set (services.idleStopMinutes, or its row's own) — off by default;
 *   - DOCA manages it (policy.managed: DOCA started it, or a person adopted it) — one started outside is left alone;
 *   - no page of the hub is open and visible and no call is on, now — "while the panel is live they can stay on, for a
 *     quick response" (the owner, 2026-10-08) — and the idle clock starts only when the last one closed;
 *   - no request is in flight to it, and nothing that machines/use.js reads uses it now (a conversation working on it,
 *     a page an agent's job serves from it); what is only set up to use it (a voice, a model) holds it too, unless it
 *     starts when needed — then it comes back on the first request (demand.js);
 *   - nothing has used it for those minutes, counted from the latest of: its last request, DOCA starting it, the hub
 *     first seeing it, the last page or call, and the settings' last change.
 * Each stop is a line in the activity log and the machines' log, so the row says "stopped by DOCA (nothing used it…)".
 */
const SWEEP_MS = 5 * 60000;
const CONFIGURED = new Set(['model', 'voice', 'stt', 'screens']);
let _timer = null;

const min = ms => Math.max(0, Math.round(ms / 60000));

/** Why this one stays on now regardless of time, or null. */
function holds(t, policy) {
  const usage = require('./usage');
  if (usage.flying(t.key)) return 'a request is in flight to it';
  let needs = [];
  try { needs = require('../machines/use-ports').needs(t.port, t.label); } catch { /* nothing read */ }
  const comesBack = policy.startsWhenNeeded(t.key);
  const hold = needs.find(n => !(comesBack && CONFIGURED.has(n.kind)));
  return hold ? hold.text : null;
}

/** Where a running one stands: { managed, minutes, idleMs, stopsInMs, kept: why or null, text } — what the row says. */
function standing(t, now = Date.now(), held = require('./policy').held(now)) {
  const policy = require('./policy'), u = require('./usage').row(t.key);
  const minutes = policy.idleMinutes(t.key);
  const managed = policy.managed(t.key);
  const lastUsed = u.lastUsedAt ? `last used ${ago(now - u.lastUsedAt)} ago` : 'not used since DOCA started counting';
  if (!managed) return { managed, minutes, kept: 'started outside DOCA', text: `${lastUsed} · started outside DOCA, so DOCA leaves it alone` };
  if (!minutes) return { managed, minutes, kept: 'no idle stop', text: `${lastUsed} · kept on` };
  if (held.now) return { managed, minutes, kept: held.why, text: `${lastUsed} · kept on while ${held.why}` };
  const busy = holds(t, policy);
  if (busy) return { managed, minutes, kept: busy, text: `${lastUsed} · kept on: ${busy}` };
  const from = Math.max(u.lastUsedAt || 0, u.startedAt || 0, u.firstSeenAt || 0, held.lastAt || 0, policy.since());
  const idleMs = Math.max(0, now - (from || now));
  const stopsInMs = Math.max(0, minutes * 60000 - idleMs);
  return { managed, minutes, idleMs, stopsInMs, kept: null, text: `${lastUsed} · idle for ${min(idleMs)} min, stops at ${minutes}` };
}

function ago(ms) {
  if (ms < 90e3) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 90 * 60e3) return `${Math.round(ms / 60e3)} min`;
  if (ms < 48 * 3600e3) return `${Math.round(ms / 3600e3)} h`;
  return `${Math.round(ms / 86400e3)} days`;
}

/** One pass: stops what has been idle long enough. Returns the keys stopped. */
async function sweep(now = Date.now()) {
  const targets = require('./targets'), usage = require('./usage');
  const running = await targets.running({ fresh: true });
  const all = targets.list();
  for (const t of all) (running.has(t.key) ? usage.seen : usage.gone)(t.key);
  const held = require('./policy').held(now);
  if (held.now) return [];
  const stopped = [];
  for (const t of all.filter(x => running.has(x.key))) {
    const s = standing(t, now, held);
    if (s.kept || s.stopsInMs > 0) continue;
    const r = await targets.stop(t);
    note(t, r, `nothing used it for ${min(s.idleMs)} min (stops after ${s.minutes} min idle)`);
    if (r.ok) stopped.push(t.key);
  }
  usage.save();
  return stopped;
}

/** The line in the activity log (the row's "stopped by DOCA (…)", Chronicle) and in the machines' log. */
function note(t, r, why, act = 'stop') {
  const verb = act === 'start' ? 'started' : 'stopped';
  require('../activity').note({ from: 'services', what: `${r.ok ? verb : `could not ${act}`} ${t.label}`, why: r.ok ? why : `${why}; ${r.why || 'it failed'}`,
    level: r.ok ? 'info' : 'warn', machine: { kind: t.kind, id: t.id, name: t.label }, act, ok: !!r.ok });
  try { require('../machines/busy-log').push(r.ok ? 'info' : 'warn', `${r.ok ? `${verb[0].toUpperCase()}${verb.slice(1)}` : `Could not ${act}`} ${t.label}: ${why}${r.ok ? '' : ` — ${r.why || 'it failed'}`}`, { kind: t.kind, id: t.id }); } catch { /* no log */ }
  try { require('../machines/origin')._reset(); } catch { /* fresh anyway */ }
}

function start() {
  if (_timer) return;
  _timer = setInterval(() => { sweep().catch(() => {}); }, SWEEP_MS);
  _timer.unref?.();
  sweep().catch(() => {});   // what runs now is seen now, so its idle clock starts here
}

module.exports = { sweep, standing, holds, note, start, ago, SWEEP_MS };

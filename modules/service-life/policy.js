'use strict';

/**
 * What the person chose for each service, and whose each one is to stop.
 *
 *   services.idleStopMinutes   the switch in Settings → System → Services (0: off, the default — an update changes nothing)
 *   services.stopWithDoca      stop the ticked ones when DOCA itself stops (off by default)
 *   services.each[key]         a row's own: idleStopMinutes (null: the switch's; 0: never this one), stopWithDoca (the
 *                              tick, on unless unticked), startWhenNeeded (on by default for what DOCA started before)
 *   services.since             when these were last changed: no idle clock runs from before it, so switching it on never
 *                              stops at once everything that has been quiet for a week
 *
 * Managed: DOCA started it (a line in the activity log — machines/origin.js — or the start was DOCA's own), or a person
 * adopted it ("Let DOCA manage it"). Anything started outside DOCA is never stopped or started by it.
 */
const schema = () => require('../settings-schema');
const prefs = () => require('../utils').loadPrefs();
const own = key => ((prefs().services || {}).each || {})[key] || {};

function idleMinutes(key) {
  const mine = own(key).idleStopMinutes;
  if (mine !== undefined && mine !== null && Number.isFinite(Number(mine))) return Math.max(0, Number(mine));
  return schema().value('services.idleStopMinutes');
}

const stopsWithDoca = key => schema().value('services.stopWithDoca') && own(key).stopWithDoca !== false;

function startsWhenNeeded(key) {
  const mine = own(key).startWhenNeeded;
  if (typeof mine === 'boolean') return mine && managed(key);
  return !!require('./usage').row(key).startedByDoca;
}

/** Whether this one is DOCA's to stop and start: started by DOCA, or adopted. A llama.cpp server is always DOCA's own. */
function managed(key) {
  const [kind, id] = String(key).split(/:(.*)/s);
  if (kind === 'llamacpp') return true;
  const u = require('./usage').row(key);
  if (u.startedByDoca || u.adopted) return true;
  if (u.adopted === false) return false;   // a person took the adoption back: the log's "adopted" no longer counts
  try { return require('../machines/origin').of(kind, id, { up: true }).outside === false; } catch { return false; }
}

const since = () => Number((prefs().services || {}).since) || 0;

/** Save the switch (`all`: {idleStopMinutes, stopWithDoca}) or one row's own choices (`key`, `mine`). */
function save({ all = null, key = null, mine = null } = {}) {
  const p = prefs();
  const s = p.services = { ...(p.services || {}) };
  if (all) {
    if (all.idleStopMinutes !== undefined) {
      const n = Number(all.idleStopMinutes);
      if (!Number.isFinite(n) || n < 0 || n > 10080) throw Object.assign(new Error('Minutes between 0 and 10080 (a week).'), { status: 400 });
      s.idleStopMinutes = n;
    }
    if (all.stopWithDoca !== undefined) s.stopWithDoca = !!all.stopWithDoca;
  }
  if (key) {
    const row = { ...((s.each || {})[key] || {}) };
    if (mine.idleStopMinutes !== undefined) {
      const v = mine.idleStopMinutes;
      if (v === null || v === '') delete row.idleStopMinutes;
      else if (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 10080) throw Object.assign(new Error('Minutes between 0 and 10080, or empty for the switch\'s.'), { status: 400 });
      else row.idleStopMinutes = Number(v);
    }
    for (const k of ['stopWithDoca', 'startWhenNeeded']) if (typeof mine[k] === 'boolean') row[k] = mine[k];
    s.each = { ...(s.each || {}), [key]: row };
  }
  s.since = Date.now();
  require('../utils').savePrefs(p);
  return view();
}

const view = () => ({ idleStopMinutes: schema().value('services.idleStopMinutes'), stopWithDoca: schema().value('services.stopWithDoca') });

// ── What holds every service on: a page of the hub open and visible, or a call ──
const CALL_MAX_MS = 3 * 3600e3;   // a call the page never said ended is not held open forever

/** { now: bool, why, lastAt } — `lastAt`: the last moment something held them (a page seen, a call ended). */
function held(now = Date.now()) {
  const presence = require('../presence');
  let lastAt = presence.lastVisibleAt?.() || 0;
  if (presence.state(now).atPanel) return { now: true, why: 'the panel is open', lastAt: now };
  try {
    for (const v of Object.values(require('../screens/showing').all(now))) if (v.visible) return { now: true, why: 'the panel is open', lastAt: now };
  } catch { /* no screens */ }
  try {
    for (const c of require('../realtime/call-log').recent()) {
      if (!c.endedAt && now - c.at < CALL_MAX_MS) return { now: true, why: 'a call is on', lastAt: now };
      if (c.endedAt) lastAt = Math.max(lastAt, c.endedAt);
    }
  } catch { /* no calls */ }
  return { now: false, why: null, lastAt };
}

module.exports = { idleMinutes, stopsWithDoca, startsWhenNeeded, managed, since, save, view, held, own };

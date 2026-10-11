'use strict';

/**
 * When this machine's files are backed up: daily at a time (03:00 by default), and — like a sync folder — whenever the
 * destination comes back: a day missed because the disk was unplugged or the machine was off runs as soon as the
 * destination can be reached again, checked every 10 minutes. A failed run is tried again an hour later, not every
 * tick. Nothing starts while DOCA waits to restart (harness/drain.js), and one run at a time (runner.js).
 *
 * due() is pure — the clock and the readings are arguments — so the catch-up is tested without waiting a day.
 */
const TICK_MS = 10 * 60e3;
const RETRY_MS = 60 * 60e3;
const ON_TIME_MS = 20 * 60e3;   // within this of its time, a run is "its time came"; later, it is a catch-up

/** The latest HH:MM (local) at or before t. */
function lastSlot(t, at) {
  const [h, m] = String(at || '03:00').split(':').map(Number);
  const d = new Date(t);
  d.setHours(h, m, 0, 0);
  if (d.getTime() > t) d.setDate(d.getDate() - 1);
  return d.getTime();
}

const ms = v => (v ? Date.parse(v) || 0 : 0);

/**
 * Whether a backup should start now: {run, why, wait?}. `s`: {now, at, catchUp, enabled, enabledAt, lastOkAt,
 * lastTriedAt, reachable, running, draining}.
 */
function due(s) {
  if (!s.enabled) return { run: false, why: 'off' };
  if (s.running) return { run: false, why: 'a backup is running' };
  const slot = lastSlot(s.now, s.at);
  if (ms(s.enabledAt) > slot) return { run: false, why: 'switched on after today\'s time: the first runs at the next one' };
  if (ms(s.lastOkAt) >= slot) return { run: false, why: 'done for today' };
  const late = s.now - slot > ON_TIME_MS;
  if (late && !s.catchUp) return { run: false, why: 'missed today\'s time; catching up is off' };
  if (s.reachable === false) return { run: false, wait: true, why: 'waiting for the destination to come back' };
  if (ms(s.lastTriedAt) >= slot && s.now - ms(s.lastTriedAt) < RETRY_MS) return { run: false, wait: true, why: 'the last try failed: tried again within the hour' };
  if (s.draining) return { run: false, wait: true, why: `${require('../branding').name('product')} is waiting to restart` };
  return { run: true, why: late ? 'catching up: the day\'s backup was missed and the destination can be reached' : 'its time came' };
}

/** When the next one is expected, for the card: the next slot, or "now/waiting" when today's is still owed. */
function nextAt(s) {
  if (!s.enabled) return null;
  const slot = lastSlot(s.now, s.at);
  const owed = ms(s.enabledAt) <= slot && ms(s.lastOkAt) < slot && (s.catchUp || s.now - slot <= ON_TIME_MS);
  if (owed) return new Date(s.now).toISOString();
  const next = new Date(slot); next.setDate(next.getDate() + 1);
  return next.toISOString();
}

/** The readings due() needs, from this machine. */
function readings(now = Date.now()) {
  const cfg = require('./config').get(), st = require('./state').get();
  const runner = require('./runner');
  let draining = false;
  try { draining = !!require('../harness/drain').pending(); } catch { /* no harness */ }
  return { now, at: cfg.at, catchUp: cfg.catchUp, enabled: cfg.enabled, enabledAt: st.enabledAt, lastOkAt: st.lastOkAt,
    lastTriedAt: st.lastTriedAt, reachable: require('./destination').check(cfg.repo).reachable, running: runner.running(), draining };
}

function tick() {
  let d;
  try { d = due(readings()); } catch { return; }
  if (!d.run) return;
  require('./runner').run({ why: d.why }).catch(() => { /* the runner wrote it down */ });
}

let _timer = null;
function start() {
  if (_timer) return;
  _timer = setInterval(tick, TICK_MS);
  _timer.unref?.();
  setTimeout(tick, 90e3).unref?.();
}
function stop() { clearInterval(_timer); _timer = null; }

module.exports = { due, nextAt, lastSlot, readings, tick, start, stop, TICK_MS, RETRY_MS };

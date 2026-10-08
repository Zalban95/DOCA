'use strict';

/**
 * When DOCA itself stops, the services it started that are ticked stop with it (services.stopWithDoca, off by default).
 * "The panel goes off" means DOCA stopping — a SIGTERM or SIGINT from its launcher, systemd or a terminal — never a
 * browser tab closing. A restart or a version switch is not a stop: those exit by themselves (releases.restartSelf),
 * without a signal, and a version just switched to that the launcher stops while it is still being watched (the file
 * `.releases/pending` is there) is the switch going back, not DOCA going off — so the services that ran before a
 * switch are still running after it, untouched. On Windows a launcher's stop ends the process outright, with no signal
 * to hear: nothing is stopped there.
 */
const fs = require('fs');
const path = require('path');
const LIMIT_MS = 25000;   // inside systemd's 90 s, and a person waiting at a terminal

const PENDING = () => path.join(require('../releases').DIR, 'pending');

/** Whether this signal is a version switch going back rather than DOCA stopping. */
function switching(pending = PENDING()) {
  try { return fs.existsSync(pending); } catch { return false; }
}

/** Stop what is ticked; resolves with the keys stopped. Never throws, never takes longer than LIMIT_MS. */
async function stopTicked({ reason = 'DOCA stopped' } = {}) {
  const targets = require('./targets'), policy = require('./policy'), idle = require('./idle');
  let running;
  try { running = await targets.running({ fresh: true }); } catch { return []; }
  const mine = targets.list().filter(t => running.has(t.key) && policy.managed(t.key) && policy.stopsWithDoca(t.key));
  const stopped = [];
  await Promise.race([
    Promise.all(mine.map(async t => { const r = await targets.stop(t); idle.note(t, r, `${reason}, and it is set to stop with DOCA`); if (r.ok) stopped.push(t.key); })),
    new Promise(r => setTimeout(r, LIMIT_MS).unref?.()),
  ]);
  return stopped;
}

/** DOCA is stopping on `signal`: what was used is saved, the ticked services stop (unless a switch is going back), then exit. */
async function onSignal(signal, { exit = code => process.exit(code), pending = PENDING() } = {}) {
  try { require('./usage').save(); } catch { /* best effort */ }
  let stopped = [];
  if (!switching(pending) && require('../settings-schema').value('services.stopWithDoca')) stopped = await stopTicked({ reason: `DOCA stopped (${signal})` }).catch(() => []);
  exit(0);
  return stopped;
}

/** server.js: the signals that mean DOCA is stopping. */
function listen() {
  let once = false;
  const go = signal => { if (!once) { once = true; onSignal(signal); } };
  process.on('SIGTERM', () => go('SIGTERM'));
  process.on('SIGINT', () => go('SIGINT'));
}

module.exports = { listen, onSignal, stopTicked, switching };

'use strict';

/**
 * Restarting without cutting work off.
 *
 * A restart or a version switch used to stop every running turn where it
 * stood: seen three times on 2026-09-25, the day of many switches. Work that is
 * cut off is resumed afterwards (supervisor.recover), but a turn stopped
 * halfway through a shell command or an edit is not the same as one that
 * finished. So the panel first says what is running, and can wait:
 *
 *   busy()            what is running now: turns, live voice calls, devices' commands
 *   whenIdle(fn)      run fn once nothing is running — or after maxWaitMs,
 *                     whichever is first; while it waits the panel starts no
 *                     automatic turns (supervisor.wake), or it might never be idle
 *   pending()/cancel  what is waiting, and calling it off
 *
 * Only one action waits at a time; asking again replaces it. Waiting is the
 * default (CONSTITUTION.md: nothing restarts while something runs): a restart
 * or a switch goes ahead at once only when the caller says `now`.
 */
const POLL_MS = 2000;
const MAX_WAIT_MS = 30 * 60e3;

let _pending = null;   // { label, since, deadline, fn, timer }

function busy() {
  const { running } = require('./turn/lifecycle');
  const memory = require('./memory');
  // A mission waiting on its person's answer to a machine question is not working, and its question outlives a
  // restart (mission-asks-held.js): a restart need not wait the half hour for it.
  const held = new Set(require('./mission-asks-held').list().map(q => q.sessionId));
  const turns = [...running.entries()].filter(([sessionId]) => !held.has(sessionId)).map(([sessionId, ctrl]) => {
    const s = memory.getSession(sessionId);
    return { sessionId, title: s?.title || sessionId, kind: s?.kind || 'work', auto: !!ctrl?.auto };
  });
  const calls = require('../realtime').live().map(c => ({ sessionId: c.sessionId || null, title: 'A voice call', kind: 'call', auto: false }));
  const jobs = require('../api-v1/jobs').running().map(j => ({ sessionId: null, title: `A device's command: ${j.commandId}`, kind: 'job', auto: false }));
  return [...turns, ...calls, ...jobs];
}

/** Whether a restart asked with this body waits: unless it says now (or the panel's older whenIdle: false). */
const waits = (body = {}) => body.now !== true && body.whenIdle !== false && busy().length > 0;

function pending() {
  if (!_pending) return null;
  const { label, since, deadline } = _pending;
  return { label, since: new Date(since).toISOString(), deadline: new Date(deadline).toISOString(), waitingOn: busy() };
}

/** Run `fn` when no turn is running, or at the deadline. Returns what is waiting. */
function whenIdle(fn, { label = 'restart', maxWaitMs = MAX_WAIT_MS, pollMs = POLL_MS } = {}) {
  cancel();
  const since = Date.now();
  _pending = { label, since, deadline: since + maxWaitMs, fn, timer: null };
  const tick = () => {
    if (!_pending) return;
    const late = Date.now() >= _pending.deadline;
    if (busy().length && !late) { _pending.timer = setTimeout(tick, pollMs); return; }
    const run = _pending.fn;
    if (late) console.warn(`[drain] waited ${Math.round(maxWaitMs / 60e3)} min for running turns; going ahead with the ${label}.`);
    _pending = null;
    run();
  };
  _pending.timer = setTimeout(tick, 0);
  return pending();
}

function cancel() {
  if (!_pending) return false;
  clearTimeout(_pending.timer);
  _pending = null;
  return true;
}

module.exports = { busy, waits, pending, whenIdle, cancel, MAX_WAIT_MS };

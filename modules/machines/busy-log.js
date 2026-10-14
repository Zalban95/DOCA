'use strict';

/**
 * The machines' log (Hub → Logs, source `machines`; Chronicle, source `machines`): what busy.js saw — a machine
 * appearing or going, busy and idle again, a process started outside DOCA's tools. A ring in memory of
 * `logs.machinesLines` (log-keep.js), like the calls' log (realtime/call-log.js); the busy and idle turns are also
 * lines of what the hub saw on disk (activity.js), so they outlive a restart. Lines are fixed templates filled with
 * readings — nothing here is written by an agent or a model. A host's, as the Logs tab is.
 */
const ring = [];
const listeners = new Set();
const ringMax = () => { try { return require('../log-keep').limit('logs.machinesLines'); } catch { return 500; } };

function push(level, text, machine = null) {
  const l = { ts: new Date().toISOString(), source: 'machines', label: 'Machines', level, text: String(text).slice(0, 400), ...(machine ? { machine } : {}) };
  ring.push(l);
  const max = ringMax();
  if (ring.length > max) ring.splice(0, ring.length - max);
  for (const fn of listeners) { try { fn(l); } catch { /* a reader gone */ } }
  return l;
}

/** What looks at the machines (busy.want), naming only what this hive has: Live and the status column are licensed. */
function watchers() {
  let lic = null;
  try { lic = require('../license'); } catch { /* no licence module: every one */ }
  const on = f => !lic || lic.featureOn(f);
  const said = [on('machines-live') && 'Live', on('workstream') && 'the Workstream', on('machines-status') && 'the status column'].filter(Boolean);
  return said.length > 1 ? `${said.slice(0, -1).join(', ')} or ${said[said.length - 1]}` : said[0] || 'a page that shows them';
}

/** For logs.js: the kept lines, then each new one. Returns the function that stops it. */
function open(tail, onLine) {
  for (const l of ring.slice(-tail)) onLine(l);
  if (!ring.length) onLine({ ts: new Date().toISOString(), source: 'machines', label: 'Machines', level: 'info',
    text: `Nothing seen yet. The machines are looked at while ${watchers()} is shown.` });
  listeners.add(onLine);
  return () => listeners.delete(onLine);
}

const lines = () => ring.slice();
const size = () => ({ lines: ring.length, bytes: ring.reduce((n, l) => n + l.text.length + 120, 0) });

module.exports = { push, open, lines, size, _ring: ring };

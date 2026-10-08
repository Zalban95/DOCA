'use strict';

/**
 * What runs in this computer, for the hub's eyes only (the hidden tool `processes`, tools.js; asked 2026-10-08: a
 * tester drove a DOCA install in a computer through `docker exec` and the hub showed it idle). Read straight from
 * /proc — no `ps`, nothing spawned: each process's id, parent, CPU ticks so far, when it started and its command line.
 * Never its environment, and nothing written. The hub works out from two readings what is new and what is busy
 * (modules/machines/busy.js), and which processes came from this control server (`self`) — DOCA's own tools — and
 * which from anywhere else: a `docker exec`, a person at its desktop.
 */
const fs = require('fs');

const MAX_PROCS = 600, MAX_ARGS = 400;

function one(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const close = stat.lastIndexOf(')');
  const comm = stat.slice(stat.indexOf('(') + 1, close);
  const f = stat.slice(close + 2).split(' ');   // f[0] is field 3 (state)
  let args = [];
  try { args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { /* gone */ }
  let len = 0;
  args = args.filter(a => (len += a.length) <= MAX_ARGS).map(a => a.slice(0, 200));
  return { pid: Number(pid), ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]), start: Number(f[19]), args: args.length ? args : [`[${comm}]`] };
}

function read() {
  const procs = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { procs.push(one(d)); } catch { /* ended while read */ }
    if (procs.length >= MAX_PROCS) break;
  }
  const uptime = Number(String(fs.readFileSync('/proc/uptime', 'utf8')).split(' ')[0]);
  return { self: process.pid, uptime, hz: 100, procs };   // USER_HZ is 100 on Linux
}

module.exports = { read };

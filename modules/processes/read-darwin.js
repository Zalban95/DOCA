'use strict';

/**
 * The process table on macOS: `ps` and `lsof`, by argv (no shell), each failing alone to nothing.
 *   ps -axww -o pid=,ppid=,uid=,rss=,time=,etime=,user=,args=    numbers, then the command line (it may hold spaces: last)
 *   ps -axww -o pid=,comm=                                       the executable's full path (it may hold spaces too)
 *   lsof -nP -d cwd -Fpn                                         each process's working folder — kept 15 s: it seldom moves
 *   lsof -nP -iTCP -sTCP:LISTEN -Fpn                             the listening ports, by pid
 * Never the environment (`ps -E` is not asked).
 */
const { execFile } = require('child_process');

const run = (bin, args) => new Promise(resolve => execFile(bin, args, { timeout: 10000, maxBuffer: 16 << 20, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } },
  (err, stdout) => resolve(err && !stdout ? '' : String(stdout))));

/** `[[dd-]hh:]mm:ss[.cc]` — ps's cputime and elapsed time — in milliseconds. */
function duration(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(s || '').trim());
  if (!m) return 0;
  return Math.round((((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000);
}

/** The two `ps` listings into rows; `now` is when they were read. */
function parsePs(main, comms, now = Date.now()) {
  const exe = new Map();
  for (const line of String(comms || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) exe.set(Number(m[1]), m[2].trim());
  }
  const out = [];
  for (const line of String(main || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]), text = m[8].trim(), path = exe.get(pid) || null;
    // The command line as words: the executable's path whole (it may hold spaces), the rest split on spaces.
    const args = path && text.startsWith(path) ? [path, ...text.slice(path.length).trim().split(/\s+/).filter(Boolean)] : text.split(/\s+/).filter(Boolean);
    out.push({ pid, ppid: Number(m[2]), uid: Number(m[3]), user: m[7], session: null, name: String(path || args[0] || '').split('/').pop(),
      exe: path && path.startsWith('/') ? path : null, args, cwd: null, cgroup: null, kernel: pid === 0,
      cpuMs: duration(m[5]), startedAt: now - duration(m[6]), rss: Number(m[4]) * 1024 });
  }
  return out;
}

/** `lsof -F` output: `p<pid>` then field lines; `n<name>` is the folder or the address. */
function parseLsof(text) {
  const out = new Map();
  let pid = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid != null) { const list = out.get(pid) || []; list.push(line.slice(1)); out.set(pid, list); }
  }
  return out;
}

/** The listening addresses (`*:3000`, `127.0.0.1:5173`, `[::1]:8080`) as ports. */
function portsOf(lsof) {
  const out = new Map();
  for (const [pid, names] of parseLsof(lsof)) {
    const ports = [...new Set(names.map(n => Number(/:(\d+)$/.exec(n)?.[1])).filter(Boolean))].sort((a, b) => a - b);
    if (ports.length) out.set(pid, ports);
  }
  return out;
}

let _cwd = { at: 0, map: new Map() };

async function read() {
  const now = Date.now();
  const [main, comms] = await Promise.all([run('ps', ['-axww', '-o', 'pid=,ppid=,uid=,rss=,time=,etime=,user=,args=']), run('ps', ['-axww', '-o', 'pid=,comm='])]);
  if (now - _cwd.at > 15000) {
    const map = new Map();
    for (const [pid, names] of parseLsof(await run('lsof', ['-nP', '-d', 'cwd', '-Fpn']))) map.set(pid, names[0]);
    _cwd = { at: now, map };
  }
  const procs = parsePs(main, comms, now);
  for (const p of procs) p.cwd = _cwd.map.get(p.pid) || null;
  return { os: 'darwin', at: now, procs };
}

async function listening() { return portsOf(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])); }

const accounts = () => ({ names: new Map(), uidMin: 501 });

module.exports = { read, listening, accounts, parsePs, parseLsof, portsOf, duration, _reset: () => { _cwd = { at: 0, map: new Map() }; } };

'use strict';

/**
 * The process table on Linux, from /proc alone — no command is run (asked 2026-10-09: the Workstream's Processes
 * drawer). For each process: its stat (parent, CPU ticks, start, resident pages), its command line, its owner (the
 * folder's uid), its cgroup (a container, the desktop session's services), its working folder and executable (readable
 * only for the processes this account owns — anything else is null). Never its environment.
 *
 * Listening ports come from /proc/net/tcp{,6} (sockets in state LISTEN, by inode) joined with the processes' open
 * sockets (/proc/<pid>/fd). Scanning every fd of a browser is the costly part, so the inode → pid map is kept and the
 * fds are scanned again only when a listening socket appears that the map does not know.
 */
const fs = require('fs');
const fsp = fs.promises;

const ROOT = '/proc';
const HZ = 100;   // USER_HZ: 100 on every Linux the kernel ships for, whatever CONFIG_HZ is

/** The page size, from what the kernel says this process holds against what Node measures (no getconf). */
const PAGE = (() => {
  try {
    const pages = Number(fs.readFileSync(`${ROOT}/self/statm`, 'utf8').split(' ')[1]);
    return 2 ** Math.round(Math.log2(process.memoryUsage().rss / pages)) || 4096;
  } catch { return 4096; }
})();

/** /proc/<pid>/stat: the name sits in parentheses and may hold spaces or parentheses itself. */
function parseStat(text) {
  const s = String(text), open = s.indexOf('('), close = s.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const f = s.slice(close + 2).split(' ');   // f[0] is field 3 (state)
  return { pid: Number(s.slice(0, open)), comm: s.slice(open + 1, close), state: f[0], ppid: Number(f[1]),
    utime: Number(f[11]), stime: Number(f[12]), starttime: Number(f[19]), rssPages: Number(f[21]) };
}

/** The cgroup a process is in: v2's one line, else v1's systemd or memory line. */
function parseCgroup(text) {
  const lines = String(text || '').split('\n').filter(Boolean);
  const v2 = lines.find(l => l.startsWith('0::'));
  if (v2) return v2.slice(3);
  const pick = lines.find(l => /docker|libpod|containerd/.test(l)) || lines.find(l => /name=systemd/.test(l)) || lines[0];
  return pick ? pick.split(':').slice(2).join(':') : null;
}

/** /proc/net/tcp and tcp6: inode → port for every socket listening (state 0A). */
function parseNetTcp(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || f[3] !== '0A') continue;
    const port = parseInt(f[1].split(':').pop(), 16), inode = f[9];
    if (port && inode && inode !== '0') out.set(inode, port);
  }
  return out;
}

const bootMs = () => {
  try { return Number(/^btime (\d+)/m.exec(fs.readFileSync(`${ROOT}/stat`, 'utf8'))[1]) * 1000; } catch { return Date.now() - require('os').uptime() * 1000; }
};

async function one(pid, boot) {
  const dir = `${ROOT}/${pid}`;
  try {
    const [stat, cmd, st, cg] = await Promise.all([fsp.readFile(`${dir}/stat`, 'utf8'), fsp.readFile(`${dir}/cmdline`),
      fsp.stat(dir), fsp.readFile(`${dir}/cgroup`, 'utf8').catch(() => '')]);
    const s = parseStat(stat);
    if (!s) return null;
    const args = cmd.toString('utf8').split('\0');
    while (args.length && args[args.length - 1] === '') args.pop();
    const [cwd, exe] = await Promise.all([fsp.readlink(`${dir}/cwd`).catch(() => null), fsp.readlink(`${dir}/exe`).catch(() => null)]);
    return { pid: s.pid, ppid: s.ppid, uid: st.uid, user: null, session: null, name: s.comm, exe: exe ? exe.replace(/ \(deleted\)$/, '') : null,
      args, cwd, cgroup: parseCgroup(cg), kernel: !args.length, cpuMs: ((s.utime + s.stime) * 1000) / HZ,
      startedAt: Math.round(boot + (s.starttime * 1000) / HZ), rss: s.rssPages * PAGE };
  } catch { return null; }   // gone between the listing and the read
}

/** Every process now. */
async function read() {
  const boot = bootMs();
  const pids = (await fsp.readdir(ROOT)).filter(n => /^\d+$/.test(n));
  return { os: 'linux', at: Date.now(), procs: (await Promise.all(pids.map(p => one(p, boot)))).filter(Boolean) };
}

const _sockets = new Map();   // inode → pid, kept between looks

/** pid → [ports] for the processes named (the ones shown): the others' fds are never scanned. */
async function listening(pids) {
  const ports = new Map();
  for (const f of ['tcp', 'tcp6']) {
    try { for (const [inode, port] of parseNetTcp(await fsp.readFile(`${ROOT}/net/${f}`, 'utf8'))) ports.set(inode, port); } catch { /* no IPv6 */ }
  }
  for (const inode of [..._sockets.keys()]) if (!ports.has(inode)) _sockets.delete(inode);
  if ([...ports.keys()].some(i => !_sockets.has(i))) {
    await Promise.all(pids.map(async pid => {
      let fds;
      try { fds = await fsp.readdir(`${ROOT}/${pid}/fd`); } catch { return; }
      await Promise.all(fds.map(async fd => {
        const l = await fsp.readlink(`${ROOT}/${pid}/fd/${fd}`).catch(() => '');
        const m = /^socket:\[(\d+)\]$/.exec(l);
        if (m && ports.has(m[1])) _sockets.set(m[1], pid);
      }));
    }));
  }
  const out = new Map();
  for (const [inode, pid] of _sockets) {
    const port = ports.get(inode);
    if (!port) continue;
    const list = out.get(pid) || [];
    if (!list.includes(port)) list.push(port);
    out.set(pid, list.sort((a, b) => a - b));
  }
  return out;
}

/** Account names by uid, from /etc/passwd (public by design), and the lowest uid a person gets. */
function accounts() {
  const names = new Map();
  let uidMin = 1000;
  try { for (const l of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) { const f = l.split(':'); if (f.length > 2) names.set(Number(f[2]), f[0]); } } catch { /* none */ }
  try { uidMin = Number(/^UID_MIN\s+(\d+)/m.exec(fs.readFileSync('/etc/login.defs', 'utf8'))[1]) || 1000; } catch { /* the default */ }
  return { names, uidMin };
}

module.exports = { read, listening, accounts, parseStat, parseCgroup, parseNetTcp, HZ, _reset: () => _sockets.clear() };

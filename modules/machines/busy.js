'use strict';

/**
 * Whether a machine is busy, whoever made it so (asked 2026-10-08: an agents' computer was driven through `docker exec`
 * and a tunnel, and DOCA showed it idle — "shouldn't we see in the harness or in the workstream if something is
 * working? And some log maybe?"). DOCA knew only what passed through its own tools; now it also reads the machines.
 *
 * While a page shows Live, the Workstream or the status column's machines — and only then — it looks every LOOK_MS
 * (busy-read.js): each running container's and computer's CPU and memory, each running libvirt VM's, and each computer's
 * own process list. A machine is busy when its CPU is over BUSY_CPU for two looks, or a process started outside DOCA's
 * tools appeared; idle again after two quiet looks. Its state names who: a DOCA mission or an agent's tools (an act in
 * the last WORKING_MS, machines/index.js), "a process started outside DOCA's tools" (no DOCA control server above it:
 * a `docker exec`, a person at its desktop), or the machine's own load.
 *
 * What it says goes to Live and the status column (`of`), the Harness's "working now" (`busyNow`, the ones no DOCA turn
 * drives), the Workstream (a line per change, workstream.machine) and the machines' log (busy-log.js; busy and idle
 * also as lines of what the hub saw, activity.js). All of it is mechanical — readings in fixed words; no model is
 * asked anything and no agent writes any of it. A host's, with the rest of /api/machines.
 */
const read = require('./busy-read');
const log = require('./busy-log');

const T = { lookMs: 10000, wantMs: 30000 };
const BUSY_CPU = 25;   // % of one core: an idle computer's desktop and browser read up to ~10%, so less would flap
const _m = new Map();   // `${kind}:${id}` → what was seen of it
let _asked = 0, _timer = null, _running = false, _lastLook = 0, _first = true, _looks = 0;

const holding = () => { try { return require('../workstream').holding(); } catch { return false; } };
const wanted = () => Date.now() - _asked < T.wantMs || holding();

/** A page shows Live, the Workstream or the machines' rows: keep looking for a while. */
function want() {
  _asked = Date.now();
  if (_timer || _running) return;
  _timer = setTimeout(tick, Math.max(0, _lastLook + T.lookMs - Date.now()));
  _timer.unref?.();
}

async function tick() {
  _timer = null;
  if (!wanted()) return over();
  await look();
  if (!wanted()) return over();
  _timer = setTimeout(tick, T.lookMs);
  _timer.unref?.();
}

/** Nobody looks any more: the next look is a fresh start (what runs then is not "new", what went meanwhile not "stopped"). */
function over() { _first = true; for (const st of _m.values()) Object.assign(st, { procs: null, uptime: null, cpuTime: null, at: null }); }

const round = n => (n == null ? null : n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
const short = args => { const a = read.maskCommand(args); a[0] = String(a[0] || '').split('/').pop(); return a.join(' ').slice(0, 70); };
const kib = n => (n == null ? null : n >= 1048576 ? `${(n / 1048576).toFixed(1)} GiB` : `${Math.round(n / 1024)} MiB`);

/** A computer's processes against the last look: the new ones started outside DOCA's tools, and the busiest. */
function processes(st, p) {
  const byPid = new Map(p.procs.map(x => [x.pid, x]));
  const selfStart = byPid.get(p.self)?.start ?? 0;
  const from = x => {
    for (let q = x, n = 0; q && n < 64; q = byPid.get(q.ppid), n++) {
      if (q.pid === p.self) return 'doca';                                 // the control server: DOCA's tools
      if (/chrom(e|ium)|crashpad/i.test(String(q.args[0] || ''))) return 'browser';
    }
    return x.start <= selfStart ? 'own' : 'outside';                      // there when the computer started, or not
  };
  const prev = st.procs, dt = st.uptime != null ? p.uptime - st.uptime : null;
  const rows = p.procs.filter(x => x.pid !== p.self).map(x => {
    const was = prev?.get(x.pid), same = was && was.start === x.start;
    const secs = same && dt > 0 ? dt : Math.max(0.5, p.uptime - x.start / p.hz);
    return { ...x, fresh: !!prev && !same, cpu: ((x.ticks - (same ? was.ticks : 0)) / p.hz) / secs * 100, from: from(x) };
  });
  st.procs = new Map(p.procs.map(x => [x.pid, { ticks: x.ticks, start: x.start }]));
  st.uptime = p.uptime;
  const fresh = new Set(rows.filter(r => r.fresh).map(r => r.pid));
  const started = rows.filter(r => r.fresh && !fresh.has(r.ppid) && r.from === 'outside');
  const top = rows.filter(r => r.from !== 'browser').sort((a, b) => b.cpu - a.cpu)[0];
  return { started, top: top && top.cpu >= 1 ? top : null };
}

/** Who makes a machine busy, in words, and as `by`: doca, outside or own. */
function whoOf(x, st, pr) {
  if (x.kind === 'computer') {
    if (pr?.started.length || pr?.top?.from === 'outside') return { by: 'outside', who: 'a process started outside DOCA\'s tools' };
    const act = require('./index').actOf(x.id);
    const mission = x.rec?.missionId ? require('../agents/missions').get(x.rec.missionId) : null;
    if (mission?.state === 'running') return { by: 'doca', who: `DOCA mission "${mission.label || mission.agentId}"` };
    if (act && Date.now() - act.at < require('./index').WORKING_MS) return { by: 'doca', who: 'an agent\'s tools' };
    if (pr?.top?.from === 'doca') return { by: 'doca', who: 'started by DOCA\'s tools' };
    return { by: 'own', who: 'the computer\'s own programs' };
  }
  return { by: 'own', who: x.kind === 'vm' ? 'the VM\'s own load' : 'the container\'s own load' };
}

function say(x, level, text, { note = null } = {}) {
  const machine = { kind: x.kind, id: x.id, name: x.name };
  log.push(level, text, machine);
  // The Workstream shows the machine as the line's `who`, so its text does not say the name again.
  const own = text.startsWith(x.name) ? text.slice(x.name.length).replace(/^:?\s*/, '') : text;
  try { require('../workstream').machine(x.name, own, { machine }); } catch { /* the Workstream is not loaded */ }
  if (note) require('../activity').note({ from: 'machines', what: note.what, why: note.why, machine });
}

function judge(x, now) {
  const key = `${x.kind}:${x.id}`;
  const st = _m.get(key) || { kind: x.kind, id: x.id, high: 0, low: 0, busy: false, since: null };
  st.name = x.name;
  if (!_m.has(key)) { _m.set(key, st); if (!_first) say(x, 'info', `${x.name} started (${x.kind})`); }
  let cpu = x.cpu ?? null;
  if (x.kind === 'vm' && x.cpuTime != null) {   // libvirt gives CPU time: a share between two looks
    cpu = st.cpuTime != null && st.at && now > st.at ? ((x.cpuTime - st.cpuTime) / ((now - st.at) * 1e6)) * 100 : null;
    st.cpuTime = x.cpuTime;
  }
  st.at = now;
  const pr = x.procs ? processes(st, x.procs) : null;
  if (pr && !_first) for (const p of pr.started) say(x, 'info', `${x.name}: ${short(p.args)} started (outside DOCA's tools)`);
  const high = (cpu != null && cpu >= BUSY_CPU) || !!pr?.started.length;
  if (high) { st.high++; st.low = 0; } else { st.low++; st.high = 0; }
  Object.assign(st, { cpu: round(cpu), mem: x.mem || null, top: pr?.top ? short(pr.top.args) : null }, whoOf(x, st, pr));
  st.text = [st.top, st.cpu != null ? `${st.cpu}% CPU` : null, st.top ? null : st.mem].filter(Boolean).join(' · ');   // "npm test · 74% CPU"
  if (!st.busy && (st.high >= 2 || pr?.started.length)) {
    Object.assign(st, { busy: true, since: now });
    say(x, 'info', `${x.name} busy: ${st.text || 'working'} (${st.who})`, { note: { what: `${x.name} busy: ${st.text || 'working'}`, why: st.who } });
  } else if (st.busy && st.low >= 2) {
    const mins = Math.max(1, Math.round((now - st.since) / 60000));
    Object.assign(st, { busy: false, since: null });
    say(x, 'info', `${x.name} idle again after ${mins} min`, { note: { what: `${x.name} idle again`, why: `busy for ${mins} min` } });
  }
}

/** One look at every running machine (at most every lookMs). */
async function look() {
  if (_running || Date.now() - _lastLook < T.lookMs / 2) return;
  _running = true;
  try {
    const now = Date.now(), seen = [];
    const stats = await read.containers();
    let computers = [];
    try { computers = require('../computers').all(); } catch { /* none */ }
    const byName = new Map(computers.map(c => [`doca-computer-${c.id}`, c]));
    for (const [name, s] of stats) {
      const c = byName.get(name);
      seen.push(c ? { kind: 'computer', id: c.id, name: c.name, cpu: s.cpu, mem: s.mem, rec: c } : { kind: 'container', id: name, name, cpu: s.cpu, mem: s.mem });
    }
    await Promise.all(seen.filter(x => x.kind === 'computer').map(async x => { x.procs = await read.processes(x.rec); }));
    let vms = [];
    try { vms = (await require('./vm-list').list()).vms.filter(v => v.state === 'running'); } catch { /* none */ }
    const ds = await read.vms(vms.filter(v => v.hypervisor === 'libvirt').map(v => v.name));
    for (const v of vms) { const d = ds.get(v.name); seen.push({ kind: 'vm', id: `${v.hypervisor}:${v.name}`, name: v.name, cpuTime: d?.cpuTime ?? null, mem: kib(d?.rssKiB) }); }
    const keys = new Set(seen.map(x => `${x.kind}:${x.id}`));
    for (const [key, st] of [..._m]) if (!keys.has(key)) { _m.delete(key); if (!_first) say(st, 'info', `${st.name} stopped (${st.kind})`); }
    for (const x of seen) judge(x, now);
    _first = false;
    _looks++;
  } finally { _lastLook = Date.now(); _running = false; }
}

const view = st => st && ({ kind: st.kind, id: st.id, name: st.name, busy: st.busy, cpu: st.cpu, mem: st.mem, text: st.text, who: st.who, by: st.by, since: st.since });
/** What was last seen of one machine (a container by its name, a VM as hypervisor:name), or null. */
const of = (kind, id) => view(_m.get(`${kind}:${id}`)) || null;
/** The busy machines no DOCA turn drives — the Harness's "working now". */
const busyNow = () => [..._m.values()].filter(st => st.busy && st.by !== 'doca').map(view);

module.exports = { want, look, of, busyNow, wanted, BUSY_CPU, T, looks: () => _looks,
  _reset: () => { _m.clear(); clearTimeout(_timer); _timer = null; _asked = 0; _lastLook = 0; _first = true; _looks = 0; } };

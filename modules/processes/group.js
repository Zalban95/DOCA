'use strict';

/**
 * The Processes drawer's grouping (asked 2026-10-09): what a person started, by where it comes from. Pure — a process
 * table and what DOCA knows in, groups of folded rows out — so each OS's captured table is tested the same way.
 *
 * Where a process comes from, the first that holds:
 *   doca       DOCA itself and what it runs: this hub, its MCP servers, its llama.cpp servers (by pid)
 *   job        an agent's background job (harness/jobs: the job's shell, and everything under it)
 *   computer · service · container   inside a container (its cgroup): an agents' computer, one of DOCA's inference
 *              services (`doca-<id>`), or any other — named, with its compose project
 *   project    its working folder (or, where the OS gives none, a path on its command line) inside one of DOCA's
 *              projects, a conversation's worktree beside it (`<repo>.worktrees/<branch>`), or the workspace
 *   repo       its working folder inside a git repository found by walking up (named by the repository's folder)
 *   outside    everything else, by its program
 *   system     only when asked: what system.js leaves out, with why
 * A child is folded under its parent when both come from the same place (a dev server's workers under it); one whose
 * parent is elsewhere or left out stands on its own. Fixed words, filled with data — no model is asked anything.
 */
const ORDER = ['project', 'repo', 'job', 'doca', 'computer', 'service', 'container', 'outside', 'system'];
const MAX_ROOTS = 60;

const norm = (p, os) => { const s = String(p || '').replace(/[\\/]+$/, ''); return os === 'win32' ? s.replace(/\//g, '\\').toLowerCase() : s; };
const sep = os => (os === 'win32' ? '\\' : '/');
function inside(dir, root, os) {
  const d = norm(dir, os), r = norm(root, os);
  return !!r && (d === r || d.startsWith(r + sep(os)));
}
const base = (p, os) => String(p || '').replace(/[\\/]+$/, '').split(os === 'win32' ? /[\\/]/ : '/').pop();
const absolute = (a, os) => (os === 'win32' ? /^[A-Za-z]:\\/.test(a) : /^\//.test(a));

/** The folders a process speaks for: its working folder, else the paths on its command line and its program (Windows gives no folder). */
function folders(p, os) {
  if (p.cwd) return [p.cwd];
  return [...(p.args || []).slice(1).filter(a => absolute(a, os) && !/^-/.test(a)).slice(0, 6), ...(p.exe ? [p.exe] : [])];
}

/** The project (or worktree, or the workspace) a folder is in, the deepest root first. */
function projectOf(list, ctx) {
  const roots = [...(ctx.projects || [])].sort((a, b) => String(b.root).length - String(a.root).length);
  for (const dir of list) {
    for (const pr of roots) {
      const wt = `${String(pr.root).replace(/[\\/]+$/, '')}.worktrees`;
      if (inside(dir, wt, ctx.os)) {
        const branch = norm(dir, ctx.os).slice(norm(wt, ctx.os).length + 1).split(/[\\/]/)[0];
        if (branch) return { key: `project:${pr.root}:${branch}`, kind: 'project', title: `${pr.name} ⑂ ${branch}`, sub: 'a conversation\'s worktree of a project' };
      }
      if (inside(dir, pr.root, ctx.os)) return { key: `project:${pr.root}`, kind: 'project', title: pr.name, sub: pr.workspace ? 'the agents\' workspace' : 'a project in DOCA' };
    }
  }
  return null;
}

function repoOf(list, ctx) {
  for (const dir of list.slice(0, 1)) {
    const root = ctx.gitRootOf?.(dir);
    if (!root) continue;
    const parent = base(String(root).replace(/[\\/][^\\/]+[\\/]*$/, ''), ctx.os);
    const title = /\.worktrees$/.test(parent) ? `${parent.replace(/\.worktrees$/, '')} ⑂ ${base(root, ctx.os)}` : base(root, ctx.os);
    return { key: `repo:${norm(root, ctx.os)}`, kind: 'repo', title, sub: 'a git repository on this machine' };
  }
  return null;
}

/** Where one process comes from: a group's key, kind, title and line, and who started it. */
function sourceOf(p, byPid, ctx) {
  const doca = ctx.doca?.get(p.pid);
  if (doca) return { group: { key: 'doca', kind: 'doca', title: ctx.product || 'DOCA', sub: 'this hub and what it runs' }, who: { text: doca.who || `started by ${ctx.product || 'DOCA'}` } };
  const jobs = new Map((ctx.jobs || []).map(j => [j.pid, j]));
  for (let q = p, n = 0; q && n < 64; q = byPid.get(q.ppid), n++) {
    const j = jobs.get(q.pid);
    if (j) return { group: { key: `job:${j.id}`, kind: 'job', title: 'An agent\'s job', sub: j.command ? `$ ${j.command}` : j.id, go: j.go || null },
      who: { text: `started by an agent's job${j.who ? ` in the conversation "${j.who}"` : ''}`, at: j.startedAt || null } };
  }
  if (p.containerId) {
    const c = (ctx.containers || []).find(x => p.containerId.startsWith(String(x.id).slice(0, 12)));
    const name = c?.name || p.containerId.slice(0, 12);
    const kind = c?.kind || 'container';
    const title = kind === 'computer' ? `Computer "${c.label || name}"` : kind === 'service' ? (c.label || name) : name;
    const sub = kind === 'computer' ? 'an agents\' computer' : kind === 'service' ? 'one of DOCA\'s inference services' : `a container${c?.project ? ` of the compose project ${c.project}` : ''}`;
    const o = c?.origin || null;
    return { group: { key: `container:${name}`, kind, title, sub, go: c?.go || null },
      who: o ? { text: o.text, at: o.at || null, outside: !!o.outside } : { text: 'started outside DOCA', outside: true } };
  }
  const list = folders(p, ctx.os);
  const place = projectOf(list, ctx) || repoOf(list, ctx);
  let who = null;
  for (let q = byPid.get(p.ppid), n = 0; q && n < 64; q = byPid.get(q.ppid), n++) {
    if (q.pid === ctx.hubPid) { who = { text: `started from ${ctx.product || 'DOCA'}'s Terminal or a tool` }; break; }
  }
  who = who || { text: 'started outside DOCA', outside: true };
  if (place) return { group: place, who };
  return { group: { key: 'outside', kind: 'outside', title: 'Outside DOCA', sub: 'programs started elsewhere: a terminal, the desktop, a service of yours' }, who };
}

/** The masked, shortened command line (masking is the caller's: busy-read.maskCommand and more). */
const commandOf = (p, mask) => String(mask ? mask(p.args || []) : (p.args || []).join(' ')).slice(0, 240);

/**
 * procs: rows from a reader, each with `cpu` (a share of one core since the last look, or null) and `system` (a reason
 * or null). Returns { groups, counts }.
 */
function group(procs, ctx = {}) {
  const os = ctx.os || process.platform;
  ctx = { ...ctx, os };
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const kept = procs.filter(p => ctx.system || !p.system);
  const src = new Map();
  for (const p of kept) {
    const s = p.system ? { group: { key: 'system', kind: 'system', title: 'The system', sub: 'what is left out unless asked' }, who: { text: p.system } } : sourceOf(p, byPid, ctx);
    src.set(p.pid, s);
  }
  const row = p => {
    const s = src.get(p.pid);
    return { pid: p.pid, name: p.name || base(p.exe, os) || String(p.args?.[0] || '?'), command: commandOf(p, ctx.mask), cpu: p.cpu ?? null, mem: p.rss || 0,
      startedAt: p.startedAt || null, user: p.user || null, system: p.system || null, who: s.who,
      ports: (ctx.ports?.get(p.pid) || []).map(port => ({ port, ...(ctx.links?.get(port) || {}) })), children: [] };
  };
  const rows = new Map(kept.map(p => [p.pid, row(p)]));
  const roots = [];
  for (const p of kept) {
    const parent = rows.get(p.ppid);
    if (parent && p.ppid !== p.pid && src.get(p.ppid).group.key === src.get(p.pid).group.key) parent.children.push(rows.get(p.pid));
    else roots.push(rows.get(p.pid));
  }
  const total = r => {
    for (const c of r.children) total(c);
    r.children.sort((a, b) => (b.total.cpu - a.total.cpu) || (b.total.mem - a.total.mem));
    r.total = { cpu: Math.round(((r.cpu || 0) + r.children.reduce((n, c) => n + c.total.cpu, 0)) * 10) / 10,
      mem: r.mem + r.children.reduce((n, c) => n + c.total.mem, 0), count: 1 + r.children.reduce((n, c) => n + c.total.count, 0) };
    return r;
  };
  const groups = new Map();
  for (const r of roots) {
    const g = src.get(r.pid).group;
    if (!groups.has(g.key)) groups.set(g.key, { ...g, rows: [] });
    groups.get(g.key).rows.push(total(r));
  }
  const list = [...groups.values()].map(g => {
    g.rows.sort((a, b) => (b.total.cpu - a.total.cpu) || (b.total.mem - a.total.mem));
    const hidden = Math.max(0, g.rows.length - MAX_ROOTS);
    return { ...g, rows: g.rows.slice(0, MAX_ROOTS), more: hidden,
      total: { cpu: Math.round(g.rows.reduce((n, r) => n + r.total.cpu, 0) * 10) / 10, mem: g.rows.reduce((n, r) => n + r.total.mem, 0), count: g.rows.reduce((n, r) => n + r.total.count, 0) } };
  }).sort((a, b) => (ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)) || (b.total.cpu - a.total.cpu) || String(a.title).localeCompare(String(b.title)));
  const why = {};
  for (const p of procs) if (p.system) why[p.system] = (why[p.system] || 0) + 1;
  return { groups: list, counts: { total: procs.length, shown: kept.length, system: procs.filter(p => p.system).length, why } };
}

module.exports = { group, sourceOf, projectOf, repoOf, inside, folders, ORDER };

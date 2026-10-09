'use strict';

/**
 * Who wrote a file the sentinel saw change, as far as this machine can tell (asked 2026-10-10: "labelled by who when
 * known"). Mechanical, in this order:
 *   1. a DOCA agent: a tool call in the last RECENT_MS that named the file or its folder (write_file, an edit, a
 *      computer's files tool), or a shell command run in a conversation whose project holds the file
 *   2. outside DOCA, with the process that most likely wrote: one of this account's processes working in the file's
 *      repository (or watched folder) — an agent's session first, then an editor, then a build — named by its program
 *      and pid; Linux gives no "who wrote this" for a file, so it says "working here", never "wrote"
 *   3. outside DOCA, unknown
 * No model is asked anything; nothing is guessed beyond what the process table and the agents' own calls say.
 */
const path = require('path');

const P = () => { try { return require('../branding').name('product'); } catch { return 'DOCA'; } };   // the product's name (branding.js)

const RECENT_MS = 15000;
const _touch = new Map();   // file or folder → { at, sessionId }
const _shell = new Map();   // sessionId → at of its last shell command

const title = id => { try { return require('../harness/memory').getSession(id)?.title || id; } catch { return id; } };

/** An agent's tool call (agent.events): the paths it names, and whether it ran a command. */
function noteCall(evt, args) {
  if (!evt?.sessionId) return;
  const now = Date.now();
  for (const k of ['path', 'file', 'target', 'dest', 'to', 'from', 'source', 'dir', 'cwd']) {
    const v = args?.[k];
    if (typeof v === 'string' && v.length < 1024) _touch.set(path.resolve(v), { at: now, sessionId: evt.sessionId });
  }
  if (/(^|__)(shell|shell_job|hub_command)$/.test(evt.name || '')) _shell.set(evt.sessionId, now);
  if (_touch.size > 2000) for (const [k, v] of _touch) if (now - v.at > RECENT_MS) _touch.delete(k);
}

/** A DOCA conversation that just wrote `file`, or null. */
function agentOf(file) {
  const now = Date.now();
  for (let p = file, n = 0; n < 4; n++, p = path.dirname(p)) {
    const t = _touch.get(p);
    if (t && now - t.at < RECENT_MS) return t.sessionId;
  }
  for (const [sid, at] of _shell) {
    if (now - at > RECENT_MS) { _shell.delete(sid); continue; }
    try {
      const pr = require('../projects/store').forSession(sid);
      const root = pr?.root;
      if (root && (file === root || file.startsWith(path.resolve(root) + path.sep))) return sid;
    } catch { /* no project */ }
  }
  return null;
}

const RANK = { agent: 0, editor: 1, build: 2 };

/** The process of this account most likely writing in `dir`'s repository (or `root`), or null. */
async function processOf(file, root, { fresh = false } = {}) {
  const t = await require('./outside').table({ fresh }).catch(() => null);
  if (!t) return null;
  const gitRoot = require('../processes/context').gitRootOf(path.dirname(file)) || root;
  if (!gitRoot) return null;
  const { kindOf, program } = require('./notable');
  const inside = d => d && (d === gitRoot || d.startsWith(gitRoot + path.sep));
  const mine = typeof process.getuid === 'function' ? process.getuid() : null;
  const byPid = new Map(t.procs.map(p => [p.pid, p]));
  const own = p => { for (let q = p, n = 0; q && n < 64; q = byPid.get(q.ppid), n++) if (q.pid === process.pid) return true; return false; };
  const cands = t.procs.filter(p => !p.system && !p.containerId && inside(p.cwd) && (mine == null || p.uid === mine) && !own(p))
    .map(p => ({ p, k: kindOf(p) })).filter(x => x.k && x.k.kind in RANK)
    .sort((a, b) => (RANK[a.k.kind] - RANK[b.k.kind]) || (b.p.startedAt - a.p.startedAt));
  const best = cands[0];
  return best ? { pid: best.p.pid, program: program(best.p), kind: best.k.kind, label: best.k.label } : null;
}

/** Who wrote `file`: { by: 'doca'|'outside', text, sessionId?, process? }. */
async function of(file, root) {
  const sid = agentOf(file);
  if (sid) return { by: 'doca', text: `${P()} agent · ${title(sid)}`, sessionId: sid };
  // A process that just started (a session opened a moment ago) is not in a reading seconds old: read again once.
  const proc = await processOf(file, root).catch(() => null) || await processOf(file, root, { fresh: true }).catch(() => null);
  if (proc) return { by: 'outside', text: `outside ${P()} · ${proc.program} (pid ${proc.pid}) works here`, process: proc };
  return { by: 'outside', text: `outside ${P()}` };
}

module.exports = { noteCall, agentOf, processOf, of, RECENT_MS };

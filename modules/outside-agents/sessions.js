'use strict';

/**
 * Each outside agent's session, tallied from its own record (asked 2026-10-17: "which agent is editing what … the
 * estimated percentage if they have one, otherwise the overall work done reported mechanically, not wasting agents'
 * effort"). Fed by index.js with every step it says; nothing is asked of the agent and no model reads anything.
 *
 *   name      the agent and its session's own title (Claude Code's `ai-title`), else the session's first characters
 *   where     the repository it works in now: the folder its last command `cd`s into, else its own folder
 *   progress  its own list of what is left, when it keeps one — Claude Code's TodoWrite or task tools, Codex's plan —
 *             as done of total; null when it keeps none (then only the activity says how much was done)
 *   activity  edits, commands, commits and files touched, since it was first seen, and when it last acted
 *   now       its last step, in the Workstream's words
 */
const path = require('path');

const ACTIVE_MS = 15 * 60e3;   // a session silent this long is not "working now"
const _all = new Map();        // `${agent}|${session}` → tally

const keyOf = s => `${s.agent}|${s.session || '?'}`;
const DONE = /^(completed|done)$/i;

/** The folder a command moves into first (`cd /x/StatENS && …`), resolved against where the session is. */
function cdOf(command, cwd) {
  const m = /^\s*cd\s+("([^"]+)"|'([^']+)'|(\S+))\s*(&&|;|$)/.exec(String(command || ''));
  const dir = m && (m[2] || m[3] || m[4]);
  return dir ? path.resolve(cwd || '/', dir.replace(/^~(?=$|\/)/, require('os').homedir())) : null;
}

/** The repository (or folder) a path is in, by name: the nearest folder above it holding a .git, else its own name. */
function repoOf(dir) {
  if (!dir) return null;
  const fs = require('fs');
  for (let d = dir, i = 0; i < 12 && d && d !== path.dirname(d); d = path.dirname(d), i++) {
    try { if (fs.existsSync(path.join(d, '.git'))) return path.basename(d); } catch { /* unreadable */ }
  }
  return path.basename(dir);
}

function tally(step) {
  const k = keyOf(step);
  if (!_all.has(k)) {
    _all.set(k, { agent: step.agent, label: step.label, session: String(step.session || ''), title: null, sub: !!step.sub, cwd: step.cwd || null,
      dir: step.cwd || null, firstAt: step.at || Date.now(), lastAt: 0, edits: 0, commands: 0, commits: 0, files: new Set(), plan: null, tasks: null, now: '' });
    if (_all.size > 300) _all.delete(_all.keys().next().value);
  }
  return _all.get(k);
}

/** One step (index.js `say`): counted, its title, folder and plan kept. `text` is how the Workstream said it. */
function note(step, text = '') {
  const t = tally(step);
  if (step.title) t.title = step.title;
  if (step.cwd && step.cwd !== t.cwd) { t.cwd = step.cwd; t.dir = step.cwd; }   // it moved: where it works now is its folder (until a cd says more)
  t.lastAt = Math.max(t.lastAt, step.at || Date.now());
  if (step.kind === 'plan' && Array.isArray(step.todos) && step.todos.length) {
    t.plan = { done: step.todos.filter(s => DONE.test(s)).length, total: step.todos.length, from: step.agent === 'codex' ? 'its plan' : 'its todo list' };
    return t;
  }
  if (step.kind === 'task') {
    t.tasks = t.tasks || { created: 0, done: new Set() };
    if (step.op === 'create') t.tasks.created++;
    else if (DONE.test(step.status)) t.tasks.done.add(step.taskId);
    if (t.tasks.created) t.plan = { done: Math.min(t.tasks.done.size, t.tasks.created), total: t.tasks.created, from: 'its task list' };
    return t;
  }
  if (step.kind === 'command') {
    t.commands++;
    const into = cdOf(step.command, t.cwd);
    if (into) t.dir = into;
    if (/\bgit\s+(-C\s+\S+\s+)?commit\b/.test(step.command || '')) t.commits++;
  }
  if (step.kind === 'edit') {
    t.edits++;
    for (const f of step.files || []) { const abs = path.resolve(t.dir || t.cwd || '/', f); t.files.add(abs); t.dir = path.dirname(abs); }
    if (t.files.size > 200) t.files = new Set([...t.files].slice(-200));
  }
  if (text) t.now = String(text).slice(0, 200);
  return t;
}

/** Another session of the same agent working in the same repository now, which a name must tell apart from `t`. */
const twin = t => [..._all.values()].some(o => o !== t && o.agent === t.agent && Date.now() - o.lastAt < ACTIVE_MS && repoOf(o.dir || o.cwd) === repoOf(t.dir || t.cwd));

/** How a session is named: the agent, a subagent marked, its own title — else its id's first characters, only when
 *  another session of that agent works in the same repository (alone, the id is noise). */
const nameOf = t => `${t.label}${t.sub ? ' (subagent)' : ''}${t.title ? ` · ${t.title}` : t.session && twin(t) ? ` · ${t.session.slice(0, 8)}` : ''}`;

/** The session a step belongs to, as the Workstream names it ("Claude Code · GitHub audit · StatENS"). */
function whoOf(step) {
  const t = _all.get(keyOf(step));
  if (!t) return null;
  const where = repoOf(t.dir || t.cwd);
  return `${nameOf(t)}${where ? ` · ${where}` : ''}`;
}

/** The sessions working now, newest first: what the Workstream's "Working now" draws. */
function list({ now = Date.now() } = {}) {
  return [..._all.values()].filter(t => now - t.lastAt < ACTIVE_MS).sort((a, b) => b.lastAt - a.lastAt).map(t => ({
    kind: 'outside', agent: t.agent, id: `${t.agent}:${t.session}`, name: nameOf(t), where: repoOf(t.dir || t.cwd),
    progress: t.plan ? { ...t.plan, percent: Math.round(100 * t.plan.done / t.plan.total) } : null,
    activity: { edits: t.edits, commands: t.commands, commits: t.commits, files: t.files.size, sinceMs: now - t.firstAt, lastAgoMs: now - t.lastAt },
    now: t.now,
  }));
}

module.exports = { note, whoOf, list, cdOf, repoOf, ACTIVE_MS, _reset: () => _all.clear() };

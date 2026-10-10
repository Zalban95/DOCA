'use strict';

/**
 * The Workstream's sentinel (TODO H10.9; asked 2026-10-06: "files being edited pop up automatically, with a sentinel
 * script when workstream is open"). While any Workstream page is open it watches the folders the work happens in —
 * the projects, their worktrees, the workspace, `workstream.roots` (by default the folder DOCA is installed in, so the
 * repositories beside it; asked 2026-10-10) and any folder an agent's write_file lands in (roots.js) — and reports each file as it
 * changes with what changed (diff.js). Whatever writes there is seen: the agent's tools, a shell, git, a build. It holds
 * nothing while no page is open.
 *
 * Watching: on macOS and Windows one recursive `fs.watch` per root (the OS does it natively); on Linux, where a
 * recursive watch is a handle per folder, it walks each root itself and skips what is never the work (.git,
 * node_modules, build output, virtual environments, DOCA's own data), up to MAX_DIRS folders, adding folders as they
 * appear. The text before an edit is the last one seen, else the file in git's HEAD, else unknown (shown whole, marked).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SKIP = new Set(['.git', 'node_modules', '.doca', '.releases', 'dist', 'build', 'out', '.next', '.nuxt', '__pycache__', '.venv', 'venv',
  'target', '.gradle', '.idea', 'coverage', '.cache', '.dart_tool', '.turbo', '.parcel-cache', '.pytest_cache', '.mypy_cache', '.certs']);
const MAX_DIRS = 4000;
const MAX_BYTES = 512 * 1024;
const QUIET_MS = 250;
const SNAP_FILES = 4000, SNAP_BYTES = 40 * 1024 * 1024, SNAP_FILE = 256 * 1024;   // what is copied at the start, so a first edit diffs   // a save that writes in three steps is one change

let _on = false;
let _startedAt = 0;
const _watchers = new Map();   // dir or root → FSWatcher
const _seen = new Map();       // file → its text as last seen
const _pending = new Map();    // file → timer
let _emit = () => {};

const skipped = p => p.split(/[\\/]/).some(seg => SKIP.has(seg)) || /\.(log|lock|swp|tmp)$|~$/.test(p);
const dataDir = () => path.resolve(process.env.DOCA_DATA_DIR || path.join(require('os').homedir(), '.doca'));   // DOCA's own state is never the work

/** The folders watched now (roots.js: the projects, worktrees, the workspace, `workstream.roots`, the agents' folders). */
const rootList = () => require('./roots').list({ extra: [..._extra] });
const roots = () => rootList().map(r => r.path);
const _extra = new Set();

function onChange(file) {
  if (!file || skipped(file) || (dataDir() && file.startsWith(dataDir() + path.sep))) return;
  clearTimeout(_pending.get(file));
  _pending.set(file, setTimeout(() => { _pending.delete(file); report(file); }, QUIET_MS));
}

function gitHead(file) {
  try {
    const dir = path.dirname(file);
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    const rel = path.relative(top, file).split(path.sep).join('/');
    return execFileSync('git', ['-C', top, 'show', `HEAD:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, maxBuffer: MAX_BYTES * 2 });
  } catch { return null; }
}

function report(file) {
  let st;
  try { st = fs.statSync(file); } catch {
    if (_seen.has(file)) { _seen.delete(file); _emit({ path: file, deleted: true }); }
    return;
  }
  if (st.isDirectory()) { if (process.platform === 'linux') walk([file]); return; }
  if (keysFile(file)) return;   // the keys files: never shown, not even that they changed
  if (st.size > MAX_BYTES) return _emit({ path: file, big: true, size: st.size });
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  if (text.includes('\u0000')) return _emit({ path: file, binary: true, size: st.size });
  // A file that holds secrets beside settings (the prefs file and its copies, OpenClaw's config, a .env) is shown with
  // every secret-named value masked, as the agent's read_file shows it (harness/secret-view.js).
  const masked = secretKind(file);
  if (masked) text = view(file, text);
  let before = _seen.has(file) ? _seen.get(file) : gitHead(file);
  if (masked && before && !_seen.has(file)) before = view(file, before);
  // Not seen and not in git: new if it was born after the sentinel started, else unknown (shown whole, marked).
  const born = before === null && st.birthtimeMs > 0 && st.birthtimeMs >= _startedAt - 1000;
  if (born) before = '';
  _seen.set(file, text);
  if (before === text) return;
  const d = require('./diff').diff(before ?? '', text);
  _emit({ path: file, root: _watched.filter(r => file.startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0] || null, added: d.added, removed: d.removed, hunks: d.hunks,
    created: before === '', unknown: before === null, replaced: !!d.replaced, lines: text.split('\n').length });
}

const secretKind = f => { try { return require('../harness/secret-view').kindOf(f); } catch { return null; } };
const view = (f, t) => { try { return require('../harness/secret-view').view(f, t); } catch { return ''; } };
/** One of the protected keys files or folders (paths.PROTECTED_*). */
function keysFile(f) {
  try {
    const p = require('../paths');
    return p.PROTECTED_FILES.some(x => path.resolve(x) === f) || p.PROTECTED_DIRS.some(d => f.startsWith(path.resolve(d) + path.sep));
  } catch { return false; }
}

function watchDir(dir, cb) {
  if (_watchers.has(dir) || _watchers.size >= MAX_DIRS) return;
  try {
    const w = fs.watch(dir, { persistent: false }, cb);
    w.on('error', () => { try { w.close(); } catch { /* closed */ } _watchers.delete(dir); });
    _watchers.set(dir, w);
  } catch { /* gone or not readable */ }
}

/**
 * Linux: every folder of the roots, by hand, skipping what is never the work — breadth first across all of them, in
 * the order given (the projects and the folders a person named before the wide default), so that past MAX_DIRS (a
 * folder of many repositories and their worktrees) the top of every repository is watched rather than all of one.
 */
function walk(list) {
  const queue = [...list];
  for (let i = 0; i < queue.length && _watchers.size < MAX_DIRS; i++) {
    const dir = queue[i];
    if (skipped(dir) || dataInside(dir)) continue;
    watchDir(dir, (_ev, name) => name && onChange(path.join(dir, String(name))));
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name)) queue.push(path.join(dir, e.name));
  }
}
const dataInside = d => d === dataDir() || d.startsWith(dataDir() + path.sep);

function watchRoots(list) {
  if (process.platform === 'linux') return walk(list);
  for (const root of list) {
    try {
      const w = fs.watch(root, { persistent: false, recursive: true }, (_ev, name) => name && onChange(path.join(root, String(name))));
      w.on('error', () => _watchers.delete(root));
      _watchers.set(root, w);
    } catch { walk([root]); }
  }
}

/**
 * The text files of the roots as they are now (within SNAP_*), so the first edit of each shows what it changed — read a
 * batch at a time between other work, so holding the Workstream answers at once however many files there are.
 */
async function snapshot(list, budget = { files: SNAP_FILES, bytes: SNAP_BYTES }) {
  const queue = [...list];
  for (let i = 0, n = 0; i < queue.length && budget.files > 0 && budget.bytes > 0; i++) {
    if (!_on) return;
    const dir = queue[i];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) queue.push(p); continue; }
      if (!e.isFile() || skipped(p) || _seen.has(p)) continue;
      try {
        const st = fs.statSync(p);
        if (st.size > SNAP_FILE) continue;
        const text = fs.readFileSync(p, 'utf8');
        if (text.includes('\u0000')) continue;
        if (!_seen.has(p)) _seen.set(p, text);
        budget.files--; budget.bytes -= st.size;
      } catch { /* gone */ }
      if (++n % 200 === 0) await new Promise(r => setImmediate(r));
    }
  }
}

/** Start watching (idempotent); `emit(change)` hears every file that changed. */
function start(emit) {
  _emit = emit || _emit;
  if (_on) return refresh();
  _on = true;
  _startedAt = Date.now();
  _watched = roots();
  watchRoots(_watched);
  snapshot(_watched).catch(() => { /* a first edit shows whole */ });
}

/**
 * The roots changed (a project made, `workstream.roots` saved, an agent wrote somewhere new): the folders are walked
 * again in their order, so a folder a person adds is watched first even when the wide default had used the budget.
 * What was seen is kept, so an edit still diffs against it.
 */
function refresh() {
  const now = roots();
  if (now.join('\n') === _watched.join('\n')) return;
  const added = now.filter(r => !_watched.includes(r));
  for (const w of _watchers.values()) try { w.close(); } catch { /* closed */ }
  _watchers.clear();
  _watched = now;
  watchRoots(_watched);
  if (added.length) snapshot(added).catch(() => {});
}
let _watched = [];

/** A folder an agent wrote into: watched from now on (while the sentinel runs). */
function include(dir) {
  if (!dir) return;
  const d = path.resolve(dir);
  if (roots().some(r => d === r || d.startsWith(r + path.sep))) return;
  _extra.add(d);
  if (_on) refresh();
}

function stop() {
  _on = false;
  for (const w of _watchers.values()) try { w.close(); } catch { /* closed */ }
  _watchers.clear(); _seen.clear(); _extra.clear(); _watched = [];
  for (const t of _pending.values()) clearTimeout(t);
  _pending.clear();
}

const status = () => ({ on: _on, roots: _on ? roots() : [], folders: _watchers.size, capped: _watchers.size >= MAX_DIRS,
  where: _on ? rootList().map(r => ({ path: r.path, from: r.from, ...(r.name ? { name: r.name } : {}), ...(r.wide ? { wide: true } : {}) })) : [] });

module.exports = { start, stop, refresh, include, status, roots, rootList, skipped, report, MAX_DIRS };

'use strict';

/**
 * The folders the Workstream's sentinel watches (asked 2026-10-10, from the phone: "Still nothing automatically on Live
 * or Workstream" — the work that evening was in the repositories beside DOCA's own install, edited by agents outside
 * DOCA, and the sentinel watched only DOCA's projects and the agents' workspace). Each with where it comes from:
 *   project     a project's root (Projects), not archived
 *   worktree    a conversation's git worktree
 *   workspace   the agents' workspace (Settings → System → Paths)
 *   setting     `workstream.roots`: folders a person adds, and by default `..` — the folder DOCA is installed in, so
 *               the repositories beside it (a person's other work, DOCA's own worktrees) are seen; a relative entry is
 *               read against the install (DOCA_HOME). The default is left out where it would be the home folder, the
 *               filesystem's root or the temporary folder — too wide to be "the work"; a folder a person names is kept
 *               unless it is the root itself.
 *   agent       a folder an agent's write_file landed in while the sentinel ran (sentinel.include)
 * Only folders that exist are listed; a folder inside another stays listed (walked first, and naming its files).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const install = () => path.resolve(process.env.DOCA_HOME || path.join(__dirname, '..', '..'));
const tryOr = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

/** Too wide to be "the work": the filesystem's root, the home folder, the temporary folder. */
function tooWide(dir) {
  const d = path.resolve(dir);
  return d === path.parse(d).root || d === path.resolve(os.homedir()) || d === path.resolve(os.tmpdir());
}

/** `workstream.roots` as folders: relative entries against the install; the shipped default dropped where too wide. */
function fromSetting(prefs) {
  const list = tryOr(() => require('../settings-schema').value('workstream.roots', prefs), ['..']);
  const shipped = tryOr(() => require('../settings-schema').leaf('workstream.roots').default, ['..']);
  return list.map(e => String(e || '').trim()).filter(Boolean).map(e => {
    const abs = path.resolve(install(), e.replace(/^~(?=$|[\\/])/, os.homedir()));
    const wide = shipped.includes(e) ? tooWide(abs) : abs === path.parse(abs).root;
    return wide ? null : { path: abs, from: 'setting', entry: e };
  }).filter(Boolean);
}

/**
 * Every folder watched, with where it comes from, in the order they are walked (sentinel.js): the projects, worktrees,
 * the workspace, the agents' folders and the folders a person named first, the wide default last — so a budget of
 * folders spent on the wide one never leaves a project unwatched. A folder inside another stays listed: it is walked
 * first, and its files are labelled with it.
 */
function list({ extra = [], prefs } = {}) {
  const out = [];
  const add = (p, from, more = {}) => { if (p) out.push({ path: path.resolve(String(p)), from, ...more }); };
  for (const p of tryOr(() => require('../projects/store').list(), [])) if (!p.archivedAt && p.root) add(p.root, 'project', { name: p.name || null });
  for (const s of tryOr(() => require('../harness/memory').listSessions().sessions, [])) if (!s.archivedAt && s.worktree?.path) add(s.worktree.path, 'worktree');
  add(tryOr(() => require('../paths').describe().find(x => x.key === 'WORKSPACE_DIR')?.active || require('../paths').WORKSPACE_DIR, null), 'workspace');
  for (const d of extra) add(d, 'agent');
  const shipped = tryOr(() => require('../settings-schema').leaf('workstream.roots').default, ['..']);
  const setting = fromSetting(prefs);
  for (const r of setting.filter(r => !shipped.includes(r.entry))) out.push(r);
  for (const r of setting.filter(r => shipped.includes(r.entry))) out.push({ ...r, wide: true });
  const seen = new Map();
  for (const r of out) if (!seen.has(r.path) && tryOr(() => fs.statSync(r.path).isDirectory(), false)) seen.set(r.path, r);
  return [...seen.values()];
}

/** The listed folder a file is in, deepest match first (for a file's label: "in doca", "in the project Benchie"). */
function of(file, roots) {
  return [...roots].sort((a, b) => b.path.length - a.path.length).find(r => file.startsWith(r.path + path.sep)) || null;
}

module.exports = { list, of, fromSetting, tooWide, install };

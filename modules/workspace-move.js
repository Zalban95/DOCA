'use strict';
/**
 * Moving an install's own folders out of OpenClaw's workspace into DOCA's (paths.js DOCA_WS; asked 2026-10-11).
 *
 * Only what is DOCA's moves: the attachments and the specialists' definitions. What else lies in OpenClaw's workspace
 * (its own files, older work) stays where it is — it may be OpenClaw's, and a project names its own folder anyway.
 * Each moved folder leaves a link at its old place, so a path an old conversation names still opens. Nothing is
 * deleted: the way back is to remove the new folder's two entries and the links (both said in the answer).
 * The new folders are used from the next start (paths are read once, when DOCA starts).
 */
const fs = require('fs');
const path = require('path');

/** Whether this install still works in OpenClaw's folder, and could move. */
function state() {
  const paths = require('./paths');
  const set = paths.describe().filter(r => ['WORKSPACE_DIR', 'ATTACHMENTS_DIR', 'AGENTS_DIR'].includes(r.key));
  const pinned = set.filter(r => r.source !== 'default').map(r => r.key);   // a path someone chose is theirs: not moved
  const legacy = path.resolve(paths.WORKSPACE_DIR) === path.resolve(paths.LEGACY_WS);
  return { legacy, pinned, from: paths.LEGACY_WS, to: paths.DOCA_WS, canMove: legacy && !pinned.length && !fs.existsSync(paths.DOCA_WS) };
}

function moveDir(from, to) {
  if (!fs.existsSync(from)) { fs.mkdirSync(to, { recursive: true }); return 'made'; }
  try { fs.renameSync(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;   // another disk: copy, then take the old one away
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
  try { fs.symlinkSync(to, from, 'junction'); } catch { /* a link is a convenience: Windows without the right says no */ }
  return 'moved';
}

/** Make DOCA's workspace and move the attachments and specialists into it. */
function move() {
  const s = state();
  if (!s.canMove) {
    const why = !s.legacy ? 'This install already uses its own workspace.'
      : s.pinned.length ? `These paths were set by hand (${s.pinned.join(', ')}); change them in Paths instead.`
      : `${s.to} already exists; move what you want there by hand, or remove it first.`;
    throw Object.assign(new Error(why), { status: 409 });
  }
  fs.mkdirSync(s.to, { recursive: true });
  const done = {};
  for (const sub of ['attachments', 'agents']) done[sub] = moveDir(path.join(s.from, sub), path.join(s.to, sub));
  require('./activity').note({ from: 'person', what: `moved the attachments and specialists into ${s.to}`, why: 'DOCA\'s own workspace instead of OpenClaw\'s' });
  return { ok: true, to: s.to, done, restartRequired: true,
    note: `Attachments and specialists are now in ${s.to}; their old places link there. Restart to use it.` };
}

function mount(app) {
  app.get('/api/paths/workspace', (_req, res) => res.json(state()));
  app.post('/api/paths/move-workspace', (_req, res) => {
    try { res.json(move()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { state, move, mount };

'use strict';

/**
 * Bringing files back out of a snapshot — a person's click, always (the route asks for their password: auth/guarded.js).
 *
 *   beside   the default: next to where it was, in a folder "Restored <date>", so nothing is overwritten
 *   replace  where it was, over what is there now (the panel asks first)
 *   to       into a folder the person chose; files already there are kept unless `overwrite`
 *   home     a fresh install: every folder of a snapshot made under another machine's home lands in this machine's home
 *            (a Linux ~/Documents into a Windows Documents and back — folders.mapHome); files already there are kept
 *            unless `overwrite`; folders that were not under that home are listed as left, for the person to place
 *
 * One item is restored as restic's `<snapshot>:<its folder> --include /<its name>`, so it lands under the target by its
 * own name, never with the whole path above it.
 */
const fs = require('fs');
const path = require('path');

const restic = require('./restic');
const folders = require('./folders');
const { snapId, snapPath, snapshots } = require('./browse');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const isAbs = p => path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);
const today = () => new Date().toISOString().slice(0, 10);

function split(at) {
  const i = at.lastIndexOf('/');
  return { parent: i <= 0 ? '/' : at.slice(0, i), name: at.slice(i + 1) };
}

/** The argv that restores one item of a snapshot into a folder — pure, for the tests. */
function restoreArgs(id, at, target, { overwrite = false } = {}) {
  const { parent, name } = split(at);
  if (!name) return ['restore', '--json', `${id}:/`, '--target', target, '--overwrite', overwrite ? 'always' : 'never'];
  return ['restore', '--json', `${id}:${parent}`, '--target', target, '--include', `/${name}`, '--overwrite', overwrite ? 'always' : 'never'];
}

/** A whole folder of a snapshot, its content into `target` (the folder itself is `target`). */
function folderArgs(id, at, target, { overwrite = false } = {}) {
  return ['restore', '--json', `${id}:${at}`, '--target', target, '--overwrite', overwrite ? 'always' : 'never'];
}

function summary(stdout) {
  const s = restic.jsonLines(stdout).reverse().find(j => j.message_type === 'summary') || {};
  return { files: s.files_restored ?? s.total_files ?? 0, bytes: s.bytes_restored ?? s.total_bytes ?? 0, skipped: s.files_skipped ?? 0 };
}

const note = (what, person) => { try { require('../activity').note({ from: 'machine-backup', what, why: 'a person asked (Settings → Backups)', person }); } catch { /* a record */ } };

/** One item: {snapshot, path, mode: beside|replace|to, target?, overwrite?}. */
async function one({ snapshot, path: item, mode = 'beside', target = '', overwrite = false }, person = null) {
  const id = snapId(snapshot), at = snapPath(item);
  const { parent } = split(at);
  const home = folders.toLocal(parent);
  let dest;
  if (mode === 'beside') dest = path.join(home, `Restored ${today()}`);
  else if (mode === 'replace') { dest = home; overwrite = true; }
  else if (mode === 'to') { if (!target || !isAbs(String(target))) throw bad('Choose the folder to restore into.'); dest = String(target); }
  else throw bad('mode is beside, replace or to.');
  fs.mkdirSync(dest, { recursive: true });
  const r = await restic.run(restoreArgs(id, at, dest, { overwrite }));
  const s = summary(r.stdout);
  note(`restored ${at} from the machine backup (${s.files} files) into ${dest}`, person);
  return { ok: true, into: dest, ...s };
}

/**
 * A fresh install: the snapshot's folders, each mapped into this machine's home. `only`: some of its paths (else all).
 * `left` lists those that were not under that machine's home: they have no place here until the person picks one.
 */
async function home({ snapshot, only = null, overwrite = false }, person = null, machine = {}) {
  const id = snapId(snapshot);
  const all = await snapshots();
  const s = all.find(x => x.id === id || x.id.startsWith(id)) || (id === 'latest' ? all[0] : null);
  if (!s) throw bad('No such snapshot.', 404);
  if (!s.home) throw bad('This snapshot does not say which home folder it was made in: restore its folders one by one instead.', 409);
  const wanted = (only && only.length ? s.paths.filter(p => only.includes(p)) : s.paths);
  const done = [], left = [];
  for (const p of wanted) {
    const to = folders.mapHome(p, { home: s.home, platform: s.os || 'linux' }, machine);
    if (!to) { left.push(p); continue; }
    const at = p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1');
    fs.mkdirSync(to, { recursive: true });
    const r = await restic.run(folderArgs(s.id, at, to, { overwrite }));
    done.push({ from: p, to, ...summary(r.stdout) });
  }
  note(`brought back ${done.length} folders from the machine backup of ${s.host} (${s.time.slice(0, 10)})${left.length ? `, ${left.length} left to place` : ''}`, person);
  return { ok: true, done, left };
}

module.exports = { one, home, restoreArgs, folderArgs, split };

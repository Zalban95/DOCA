'use strict';

/**
 * A second copy of every backup, in a folder on this machine — another disk, a NAS mount (the owner, 2026-10-09: "a
 * limited number of snapshots decided in settings, and the possibility to set a second path"). Setting `backup.mirror`
 * (Settings → Backups → A second copy; never the agent's to propose).
 *
 *   set(dir)          checked when saved: an absolute folder, made if missing, that this hive can write — and not the
 *                     backups folder itself; empty switches it off
 *   after(file)       called after every backup is made (by hand or on the schedule): copied there (a `.part` renamed
 *                     when whole), then the scheduled ones there kept to the same number as here. A failed copy is
 *                     an activity line and a notice to the admins — never a failed backup: the one here stands
 *   status()          where, and how the last copy went
 */
const fs = require('fs');
const path = require('path');
const store = require('../store');

const DOC = 'backup/mirror';
const where = () => require('../settings-schema').value('backup.mirror');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

function writable(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.doca-probe-${process.pid}`);
  fs.writeFileSync(probe, 'ok');
  fs.rmSync(probe, { force: true });
}

function set(dir) {
  const v = String(dir || '').trim();
  const { loadPrefs, savePrefs } = require('../utils');
  if (v) {
    if (require('../hosted').on()) throw bad('A hosted hive keeps one volume: its host copies it (deploy/hive.sh backup).', 409);
    if (!path.isAbsolute(v)) throw bad('The second path is a whole folder path, like /mnt/nas/doca-backups or D:\\Backups.');
    const abs = path.resolve(v), own = path.resolve(require('../paths').BACKUP_DIR);
    if (abs === own || abs.startsWith(own + path.sep)) throw bad('That is the backups folder itself: a second copy goes somewhere else — another disk is the point.');
    if (require('../edition-mode').inCode(abs)) throw bad(require('../edition-mode').refusal(abs));
    try { writable(abs); } catch (e) { throw bad(`${abs} cannot be written here (${e.code || e.message}). Check that the disk is mounted and this hive's user may write there.`); }
  }
  const prefs = loadPrefs();
  savePrefs({ ...prefs, backup: { ...(prefs.backup || {}), mirror: v ? path.resolve(v) : '' } });
  return status();
}

function after(file) {
  const dir = where();
  if (!dir || !file) return null;
  const name = path.basename(file), at = new Date().toISOString();
  try {
    writable(dir);
    const part = path.join(dir, `${name}.part`);
    fs.copyFileSync(file, part);
    fs.renameSync(part, path.join(dir, name));
    const removed = require('./schedule').prune(require('./schedule').config().keep, dir);
    store.writeJson(DOC, { lastAt: at, lastName: name, lastError: null });
    return { copied: name, removed };
  } catch (e) {
    const why = `${e.code || ''} ${e.message}`.trim();
    store.writeJson(DOC, { ...store.readJson(DOC, {}), lastTriedAt: at, lastError: why });
    try { require('../activity').note({ from: 'backup', what: `the second copy of ${name} failed: ${why}`, why: `to ${dir}; the backup itself was made`, level: 'error' }); } catch { /* a record */ }
    try { require('../notices').post({ title: 'A backup\'s second copy failed', text: `${name} was made, but copying it to ${dir} failed: ${why}. Check that the disk is there (Settings → Backups).`, from: 'backup' }); } catch { /* a record */ }
    return { error: why };
  }
}

function status() { return { dir: where(), ...store.readJson(DOC, {}) }; }

module.exports = { set, after, status, writable };

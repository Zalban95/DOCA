'use strict';

/**
 * One backup of this machine's files: restic backup of the chosen folders, then forget --prune to the kept number of
 * daily, weekly and monthly copies. One at a time; never while DOCA waits to restart (CONSTITUTION S10). Every run is
 * written down — started, files, bytes new, how long, the files it could not read — as an activity line (Chronicle's
 * source hub) and in the run log beside the snapshots; a failure is also a notice to the admins (CONSTITUTION §1:
 * nothing runs unseen). restic's own stale locks (a run cut off by a restart) are cleared first, as restic advises.
 */
const os = require('os');

const restic = require('./restic');
const config = require('./config');
const state = require('./state');
const folders = require('./folders');
const destination = require('./destination');

const TAG = 'doca-machine';
let _running = null;   // {startedAt, why, percent, files, bytes, totalBytes}

function running() { return _running ? { ..._running } : null; }

/** The argv of the backup itself — pure, so a test reads exactly what restic is asked. */
function backupArgs({ paths, exclude = [], home = os.homedir(), platform = process.platform, host = os.hostname(), skip = [] }) {
  return ['backup', '--json', '--tag', TAG, '--tag', `doca-home=${home}`, '--tag', `doca-os=${platform}`, '--host', host, '--exclude-caches',
    ...exclude.flatMap(e => ['--exclude', e]), ...skip.flatMap(p => ['--exclude', p]), '--', ...paths];
}

function forgetArgs({ keepDaily = 7, keepWeekly = 0, keepMonthly = 0, host = os.hostname() }) {
  return ['forget', '--json', '--tag', TAG, '--host', host, '--group-by', 'host', '--keep-daily', keepDaily,
    ...(keepWeekly ? ['--keep-weekly', keepWeekly] : []), ...(keepMonthly ? ['--keep-monthly', keepMonthly] : []), '--prune'];
}

const fmtBytes = n => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);
const note = (what, extra = {}) => { try { require('../activity').note({ from: 'machine-backup', what, ...extra }); } catch { /* a record */ } };

function tellAdmins(title, text) {
  try { require('../notices').post({ title, text, from: 'machine-backup', link: { label: 'Backups', href: '#settings/backups' } }); } catch { /* a record */ }
}

/**
 * Back up now. `why`: the reason, for the record; `person`: who asked (a click), else the schedule. Resolves the run's
 * account; a failure resolves too ({ok: false, error}) after being written down — the caller need not catch.
 */
async function run({ why = 'asked for now', person = null } = {}) {
  if (_running) return { skipped: 'A backup of this machine is already running.' };
  let draining = null;
  try { draining = require('../harness/drain').pending(); } catch { /* no harness */ }
  if (draining) return { skipped: `${require('../branding').name('product')} is waiting to restart: the backup starts after it.` };
  const cfg = config.get();
  const startedAt = new Date();
  _running = { startedAt: startedAt.toISOString(), why, percent: 0, files: 0, bytes: 0, totalBytes: 0 };
  const account = { at: startedAt.toISOString(), why, by: person?.name || person?.email || null, ok: false, snapshotId: null,
    filesNew: 0, filesChanged: 0, filesTotal: 0, bytesNew: 0, bytesTotal: 0, seconds: 0, errorCount: 0, errors: [], missing: [], error: null };
  try {
    const dest = destination.check(cfg.repo);
    if (!dest.set) throw new Error('No destination is set.');
    if (dest.reachable === false) throw new Error(dest.note);
    const { present, missing } = folders.chosen(cfg.folders);
    account.missing = missing;
    if (!present.length) throw new Error('None of the chosen folders is on this machine.');
    note('started backing up this machine\'s files', { why, person });
    // The destination itself is never backed up into itself (a folder inside a backed-up one).
    const skip = dest.kind === 'folder' ? [cfg.repo] : [];
    await restic.run(['unlock'], { ok: [0, 1] }).catch(() => {});
    const r = await restic.run(backupArgs({ paths: present, exclude: cfg.exclude, skip }), { ok: [0, 3], onLine: line => {
      let j; try { j = JSON.parse(line); } catch { return; }
      if (j.message_type === 'status') Object.assign(_running, { percent: Math.round((j.percent_done || 0) * 100), files: j.files_done || 0, bytes: j.bytes_done || 0, totalBytes: j.total_bytes || 0 });
      else if (j.message_type === 'error') { account.errorCount++; if (account.errors.length < 20) account.errors.push({ item: String(j.item || ''), message: String(j.error?.message || '').slice(0, 300) }); }
      else if (j.message_type === 'summary') Object.assign(account, { snapshotId: j.snapshot_id || null, filesNew: j.files_new || 0, filesChanged: j.files_changed || 0,
        filesTotal: j.total_files_processed || 0, bytesNew: j.data_added_packed ?? j.data_added ?? 0, bytesTotal: j.total_bytes_processed || 0 });
    } });
    if (!account.snapshotId) throw Object.assign(new Error('restic finished without making a snapshot'), { stderr: r.stderr });
    account.ok = true;
    // Keeping to the numbers asked: its failure is its own, and never undoes the backup just made.
    try { await restic.run(forgetArgs(cfg)); } catch (e) { account.pruneError = e.message; }
  } catch (e) {
    account.error = e.message;
  } finally {
    account.seconds = Math.round((Date.now() - startedAt.getTime()) / 100) / 10;
    _running = null;
  }
  state.addRun(account);
  const at = new Date().toISOString();
  if (account.ok) {
    state.patch({ lastOkAt: at, lastTriedAt: at, lastError: null, lastSnapshot: account.snapshotId });
    note(`backed up this machine's files: ${account.filesTotal} files, ${fmtBytes(account.bytesNew)} new, in ${account.seconds} s`
      + `${account.errorCount ? ` — ${account.errorCount} could not be read` : ''}${account.missing.length ? ` — ${account.missing.length} chosen folders are not here` : ''}`,
    { why, person, level: account.errorCount || account.pruneError ? 'warn' : 'info' });
  } else {
    const again = state.get().lastError === account.error;   // the same failure each hour is told once
    state.patch({ lastTriedAt: at, lastError: account.error });
    note(`backing up this machine's files failed: ${account.error}`, { why, person, level: 'error' });
    if (!again) tellAdmins('This machine\'s backup failed', `${account.error} It is tried again within the hour while the destination can be reached (Settings → Backups).`);
  }
  return account;
}

module.exports = { run, running, backupArgs, forgetArgs, TAG };

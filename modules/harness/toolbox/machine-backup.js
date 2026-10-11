'use strict';

/**
 * This machine's files, backed up (modules/machine-backup), for the agent: whether the backup is set up and working,
 * its history, and where the copies of a file are ("when was the last copy of my thesis?"). It only reads: it never
 * runs, restores, deletes or changes the password — restoring is the person's click in Settings → Backups, which asks
 * for their password. The machine's files are an admin's, so a turn acting for someone else is refused.
 *
 * Not in registry.NEVER: it reads, and a specialist sent to find a lost file may need it; a mission holds it only through
 * its kit (panel), and a mission's person must still be an admin.
 */
const human = n => (n == null ? '?' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);
const when = iso => String(iso || '').replace('T', ' ').slice(0, 16);
const WHERE = 'Settings → Backups → This machine\'s files';

async function status() {
  const s = await require('../../machine-backup/routes').status();
  const c = s.config;
  if (!s.restic.found) return `restic is not installed, so this machine's files are not backed up. It is installed from ${WHERE} (or System tools → restic).`;
  if (!s.setUp) return `The backup of this machine's files is not set up yet: ${WHERE} chooses where it goes and makes its password.`;
  const lines = [`Backup of this machine's files: ${c.enabled ? `on, daily at ${c.at}${c.catchUp ? ', caught up when the destination comes back' : ''}` : 'off (only Back up now)'}.`,
    `Destination: ${c.repo} — ${s.destination.reachable === false ? `NOT reachable: ${s.destination.note}` : s.destination.reachable ? `reachable${s.destination.freeBytes != null ? `, ${human(s.destination.freeBytes)} free` : ''}` : 'an address, tried when it runs'}.`,
    `Folders: ${s.usingSuggestions ? s.suggestions.filter(x => x.on).map(x => x.path).join(', ') + ' (the suggestions)' : c.folders.join(', ')}.`,
    `Keeps ${c.keepDaily} daily${c.keepWeekly ? `, ${c.keepWeekly} weekly` : ''}${c.keepMonthly ? `, ${c.keepMonthly} monthly` : ''} copies.`];
  if (s.running) lines.push(`Running now: ${s.running.percent}% (${s.running.files} files).`);
  if (s.lastOkAt) lines.push(`Last good backup: ${when(s.lastOkAt)}.`);
  if (s.lastError && (!s.lastOkAt || s.lastTriedAt > s.lastOkAt)) lines.push(`The last try (${when(s.lastTriedAt)}) failed: ${s.lastError}`);
  if (c.enabled && s.next) lines.push(`Next: ${s.due.wait ? s.due.why : when(s.next)}.`);
  return lines.join('\n');
}

async function history(limit) {
  const list = await require('../../machine-backup/browse').snapshots();
  if (!list.length) return 'The backup has no snapshots yet.';
  return [`${list.length} snapshots, newest first:`, ...list.slice(0, limit).map(s => `- ${when(s.time)} ${s.short} on ${s.host}: ${s.filesTotal ?? '?'} files, `
    + `${human(s.bytesNew)} new${s.seconds != null ? `, ${s.seconds} s` : ''}${s.errorCount ? `, ${s.errorCount} could not be read` : ''} — ${s.paths.length} folders`)].join('\n');
}

async function find(q, limit) {
  const r = await require('../../machine-backup/browse').find(q, { limit });
  if (!r.total) return `No copy of "${q}" in any snapshot.`;
  return [`${r.total} cop${r.total === 1 ? 'y' : 'ies'} of "${q}"${r.total > r.matches.length ? `, the newest ${r.matches.length}` : ''}:`,
    ...r.matches.map(m => `- ${m.path}${m.type === 'dir' ? '/' : ''} in snapshot ${m.snapshot.slice(0, 8)} (${when(m.time)})${m.size != null && m.type !== 'dir' ? `, ${human(m.size)}` : ''}${m.mtime ? `, changed ${when(m.mtime)}` : ''}`),
    `To bring one back, the person opens that snapshot in ${WHERE} and restores it (beside it, in its place, or to a folder).`].join('\n');
}

module.exports = [{
  name: 'machine_backup',
  description: 'Read the backup of this machine\'s own files (restic): whether it is set up and working, its history, and where the copies of a file are — '
    + 'use it when the person asks whether their files are backed up, when the last backup ran, or for an older copy of a file. '
    + 'status says where it goes, which folders, when and the last result; history lists the snapshots; find looks for a file name or pattern (*report*) in every snapshot. '
    + 'It only reads: restoring is the person\'s, in Settings → Backups.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'history', 'find'] },
      q: { type: 'string', description: 'find: a file or folder name, or a pattern with * (e.g. *thesis*.pdf).' },
      limit: { type: 'integer', description: 'history and find: how many (default 15, at most 50).' },
    },
    required: ['action'],
  },
  run: async ({ action, q, limit }, ctx = {}) => {
    if (ctx.user && !require('../session-access').isHost(ctx.user)) return 'Error: this machine\'s files and their backup are an admin\'s.';
    const n = Math.min(50, Math.max(1, Number(limit) || 15));
    try {
      if (action === 'status') return await status();
      if (action === 'history') return await history(n);
      if (action === 'find') return q ? await find(q, n) : 'Error: find needs q, a name or a pattern.';
      return 'Error: action is status, history or find.';
    } catch (e) { return `Error: ${e.message}`; }
  },
}];

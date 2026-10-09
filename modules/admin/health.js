'use strict';

/**
 * Hub → Admin, Health: is the hive itself fine. Read from each module's own read — the version, the update check
 * (the channel in production, git's last look in development: never a new look from here), the licence and the mode,
 * the last backup and its second copy, the disk, the GPUs, the machines in trouble (machines/rows.js) and how long
 * the hub has run. `read()` gathers, `build(inputs)` words it; a test hands build() its own inputs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ago, span, bytes, plural, line, DAY } = require('./words');

const BACKUP_NAME = /^[A-Za-z0-9._-]+\.dBac$/;   // backup/routes.js NAME

function newestBackup(dir) {
  let best = null;
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!BACKUP_NAME.test(n)) continue;
      const at = fs.statSync(path.join(dir, n)).mtime.toISOString();
      if (!best || at > best.at) best = { name: n, at };
    }
  } catch { /* no folder yet: no backup */ }
  return best;
}

let _gpu = { at: 0, v: null };
async function gpus() {
  if (Date.now() - _gpu.at < 30e3) return _gpu.v;
  let v = [];
  try { v = await require('../gpu').read(); } catch { /* none readable */ }
  _gpu = { at: Date.now(), v };
  return v;
}

function licence() {
  const s = require('../license').status();
  return { source: s.source, valid: s.valid, edition: s.edition, customer: s.customer, expiry: s.expiry, lastCheckIn: s.lastCheckIn,
    checkInFailed: !!s.lastError && (!s.lastCheckIn || String(s.lastTry || '') > String(s.lastCheckIn)), online: !!s.server,
    readOnly: s.readOnly, grace: s.grace, lapsesAt: s.lapsesAt, graceDays: s.graceDays, mode: s.mode };
}

function update(production) {
  if (production) {
    const s = require('../update-channel').status();
    return { via: 'channel', latest: s.latest?.version || null, available: !!s.latest, urgent: !!s.urgent, checkedAt: s.lastCheck,
      failed: !!s.lastError, staged: s.staged ? (s.staged.version || String(s.staged)) : null, waiting: !!s.waiting };
  }
  const c = require('../update').lastCheck();
  return { via: 'git', latest: c?.latest || null, available: !!c?.updateAvailable, checkedAt: c?.checkedAt || null, failed: !!c && !c.checked };
}

async function read() {
  const mode = require('../edition-mode').state();
  const paths = require('../paths');
  let disk = null;
  try { const st = fs.statfsSync(require('../store').DATA_DIR); disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch { /* unknown */ }
  let trouble = [], machinesError = null;
  try {
    const r = await require('../machines/rows').rows();
    trouble = r.rows.filter(x => x.point === 'error').map(x => ({ kind: x.kind, name: x.name, detail: x.detail || '' }));
  } catch (e) { machinesError = e.message; }
  const sched = require('../backup/schedule').status();
  return {
    version: require('../../package.json').version, mode, hosted: require('../hosted').on(),
    update: update(mode.mode === 'production'), licence: licence(),
    backup: { last: newestBackup(paths.BACKUP_DIR), every: sched.every, scheduleError: sched.lastError || null, mirror: require('../backup/mirror').status() },
    disk, gpus: await gpus(), trouble, machinesError,
    uptime: { hub: process.uptime() * 1000, machine: os.uptime() * 1000 },
  };
}

function licenceLines(l, now) {
  const out = [];
  if (l.source === 'grace') out.push(line('licence', 'Licence', `none yet — every feature until ${String(l.grace?.until || '').slice(0, 10)}`, 'ask', 'settings/system'));
  else if (l.source === 'none') out.push(line('licence', 'Licence', 'none — the core only', 'info', 'settings/system'));
  else if (!l.valid) out.push(line('licence', 'Licence', 'does not verify for this hive', 'err', 'settings/system'));
  else out.push(line('licence', 'Licence', [l.edition || 'licensed', l.customer].filter(Boolean).join(' · '), 'ok', 'settings/system'));
  if (l.readOnly) out.push(line('licence-ro', 'Licensed features', 'read-only', 'err', 'settings/system'));
  if (l.valid && l.expiry) {
    const left = Date.parse(l.expiry) - now;
    out.push(line('licence-expiry', 'Licence ends', `${String(l.expiry).slice(0, 10)} (${left > 0 ? `in ${span(left)}` : 'passed'})`, left < 0 ? 'err' : left < 14 * DAY ? 'ask' : 'ok', 'settings/system'));
  }
  if (l.valid && l.online) out.push(line('licence-checkin', 'Last check-in', l.checkInFailed ? `failed${l.lastCheckIn ? ` — last good ${ago(l.lastCheckIn, now)}` : ''}` : (ago(l.lastCheckIn, now) || 'not yet'),
    l.checkInFailed ? 'ask' : 'ok', 'settings/system'));
  return out;
}

function build(x, now = Date.now()) {
  const lines = [line('version', 'Running', `${x.version}`, 'ok', 'settings/general')];
  const u = x.update || {};
  if (u.available) lines.push(line('update', 'Update', `${u.latest} ${u.staged ? 'staged, switched to once nothing runs' : 'is waiting'}${u.urgent ? ' (urgent)' : ''}`, u.urgent ? 'err' : 'ask', 'settings/general', u.via === 'channel' ? 'from the update channel' : 'from git'));
  else if (u.failed) lines.push(line('update', 'Update', 'could not look', 'ask', 'settings/general', u.via === 'channel' ? 'the update channel did not answer' : 'git could not read the tags'));
  else lines.push(line('update', 'Update', u.checkedAt ? `none — looked ${ago(u.checkedAt, now)}` : 'not looked yet', u.checkedAt ? 'ok' : 'info', 'settings/general'));
  lines.push(...licenceLines(x.licence || {}, now));
  const m = x.mode || {};
  lines.push(line('mode', 'Mode', `${m.mode || 'production'}${x.hosted ? ' · hosted' : ''}`, 'info', 'settings/system', m.why || null));
  const b = x.backup || {};
  const age = b.last ? now - Date.parse(b.last.at) : null;
  lines.push(line('backup', 'Last backup', b.last ? ago(b.last.at, now) : 'none yet', !b.last || b.scheduleError ? 'ask' : age > 8 * DAY ? 'ask' : 'ok', 'settings/backups',
    b.scheduleError ? 'the last scheduled backup failed' : b.every && b.every !== 'off' ? `scheduled ${b.every}` : 'no schedule'));
  if (b.mirror?.dir) lines.push(line('mirror', 'Second copy', b.mirror.lastError ? 'failed' : (ago(b.mirror.lastAt, now) || 'none yet'), b.mirror.lastError ? 'err' : 'ok', 'settings/backups'));
  if (x.disk) {
    const f = x.disk.free / (x.disk.total || 1);
    lines.push(line('disk', 'Disk free', `${bytes(x.disk.free)} of ${bytes(x.disk.total)}`, f < 0.05 ? 'err' : f < 0.12 ? 'ask' : 'ok', 'settings/system'));
  }
  for (const [i, g] of (x.gpus || []).entries()) {
    const used = Number(g.memUsed), total = Number(g.memTotal);
    if (!Number.isFinite(total) || !total) continue;
    const known = Number.isFinite(used) && g.memUsed != null;
    lines.push(line(`gpu-${i}`, (x.gpus.length > 1 ? `GPU ${i + 1} memory` : 'GPU memory'), known ? `${bytes(used * 1048576)} of ${bytes(total * 1048576)} in use` : `${bytes(total * 1048576)} (in use: not readable)`,
      known && used / total > 0.95 ? 'ask' : 'ok', 'models', g.name || null));
  }
  const t = x.trouble || [];
  lines.push(line('trouble', 'Machines in trouble', t.length ? plural(t.length, 'machine') : 'none', t.length ? 'err' : 'ok', 'live',
    t.length ? t.slice(0, 3).map(r => `${r.name}${r.detail ? ` (${r.detail})` : ''}`).join(', ') : x.machinesError ? 'could not read them' : null));
  lines.push(line('uptime', 'Hub running for', span(x.uptime?.hub), 'ok', 'settings/system', `the machine for ${span(x.uptime?.machine)}`));
  return { id: 'health', title: 'Health', lines };
}

module.exports = { read, build, newestBackup };

'use strict';

/**
 * Files' list of places, with how full each is, and the disks that could be mounted (asked 2026-10-12).
 *   GET  /api/files/disks              { supported, note, mounted: [{path, device, type, label, total, used, free,
 *                                        canUnmount, why, devPath}], unmounted: [{path, label, size, fstype, state,
 *                                        canMount, why}] }
 *   POST /api/files/disks/mount        { device, password? }   udisks first; with the password, the sudo path (SSE)
 *   POST /api/files/disks/unmount      { device, password? }
 * A host's, as the rest of /api/files (auth/rights.js). Each mount and unmount — asked, done or failed — is an
 * activity line (activity.js), with who asked and from which screen; never the password.
 * Linux reads lsblk; macOS and Windows mount their disks themselves, and the answer says so rather than guessing.
 */
const fs = require('fs');
const os = require('os');
const mount = require('./mount');

const NOTE = {
  win32: 'Windows gives each disk a drive letter itself; a disk without one gets it in Disk Management. Nothing to mount from here.',
  darwin: 'macOS mounts disks itself under /Volumes. One it left unmounted is mounted in Disk Utility — not from here yet.',
  hosted: 'A hosted hive does not reach the machine\'s disks.',
};

/** statfs with a deadline: a network mount that hangs must not hold the list. */
function space(p, ms = 1500) {
  if (typeof fs.promises.statfs !== 'function') return Promise.resolve(null);
  const read = fs.promises.statfs(p).then(s => {
    const total = s.blocks * s.bsize;
    return total ? { total, used: (s.blocks - s.bfree) * s.bsize, free: s.bavail * s.bsize } : null;
  }).catch(() => null);
  return Promise.race([read, new Promise(r => setTimeout(() => r(null), ms).unref?.())]);
}

async function handleList(req, res) {
  const files = require('../files');
  const hosted = require('../hosted').on();
  const platform = process.platform;
  let mounted = [];
  try { mounted = hosted ? [] : files.mountsList(); } catch { /* none read */ }
  const home = os.homedir();
  if (!hosted && !mounted.some(m => m.path === home)) mounted.unshift({ device: '', path: home, type: '', home: true });
  let disks = [], note = hosted ? NOTE.hosted : NOTE[platform] || null;
  if (!hosted && platform === 'linux') {
    try { disks = await mount.read(); } catch (e) { note = `The disks that are not mounted could not be listed: ${e.message}`; }
  }
  const byMount = new Map();
  for (const d of disks) for (const mp of d.mountpoints) byMount.set(mp, d);
  const rows = await Promise.all(mounted.map(async m => {
    const d = byMount.get(m.path);
    return { path: m.path, device: m.device, type: m.type, home: !!m.home, label: d?.label || null, devPath: d?.path || null,
      canUnmount: !!d?.canUnmount && !m.home, why: d?.why || null, ...(await space(m.path)) };
  }));
  const unmounted = disks.filter(d => d.state !== 'mounted').map(d => ({ path: d.path, name: d.name, label: d.label, size: d.size,
    fstype: d.fstype, state: d.state, canMount: d.canMount, why: d.why, removable: d.removable }));
  res.json({ supported: !hosted && platform === 'linux', platform, note, mounted: rows, unmounted });
}

const nameOf = d => `${d.label || d.name} (${d.path})`;

function noteAct(req, act, d, ok, detail) {
  try {
    const acts = require('../machines/acts');
    const by = { person: acts.personOf(req.auth?.user), via: acts.viaOf(req) };
    const what = `${act === 'mount' ? 'mounted' : 'unmounted'} the disk ${nameOf(d)}${ok && detail ? ` ${act === 'mount' ? 'at' : 'from'} ${detail}` : ''}`;
    require('../activity').note({ from: 'person', what, person: by.person, act, via: by.via, ok, level: ok ? 'info' : 'warn',
      why: [by.via && `from ${by.via}`, !ok && `it failed${detail ? `: ${String(detail).slice(0, 160)}` : ''}`].filter(Boolean).join('; ') });
  } catch { /* the act happened; the line is best effort */ }
}

/** One handler for both verbs. */
const act = verb => async (req, res) => {
  if (require('../hosted').on() || process.platform !== 'linux') {
    return res.status(501).json({ error: require('../hosted').on() ? NOTE.hosted : NOTE[process.platform] || `Not supported on ${process.platform}.` });
  }
  const device = String(req.body?.device || '');
  if (!/^\/dev\/[\w./-]+$/.test(device)) return res.status(400).json({ error: 'device: the disk\'s path, as /dev/…' });
  let d;
  try { d = await mount.find(device); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!d) return res.status(404).json({ error: `${device} is not one of this hub's disks.` });
  if (verb === 'mount' && !d.canMount) return res.status(409).json({ error: d.why || `${nameOf(d)} is already mounted.` });
  if (verb === 'unmount' && !d.canUnmount) return res.status(409).json({ error: d.why ? `${nameOf(d)} stays: ${d.why}.` : `${nameOf(d)} is not mounted.` });

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) {
    const r = await mount.viaUdisks(d, verb);
    if (r.ok || !r.needs) noteAct(req, verb, d, r.ok, r.ok ? r.folder : r.error);
    return res.json(r.needs ? { ok: false, needs: r.needs, error: r.error } : r);
  }
  // The panel's sudo path: the person typed the password; the outcome is read back from the disks themselves.
  const plan = verb === 'mount' ? mount.mountPlan(d) : mount.unmountPlan(d);
  res.on('close', async () => {
    let after = null;
    try { after = await mount.find(device); } catch { /* read failed: say it failed */ }
    const ok = verb === 'mount' ? !!after?.mountpoints.length : !!after && !after.mountpoints.length;
    noteAct(req, verb, d, ok, ok ? (verb === 'mount' ? after.mountpoints[0] : plan.folder) : 'with sudo');
  });
  require('../utils').streamCmd(res, plan.sudo, { password });
};

function mountRoutes(app) {
  app.get('/api/files/disks', handleList);
  app.post('/api/files/disks/mount', act('mount'));
  app.post('/api/files/disks/unmount', act('unmount'));
}

module.exports = { mount: mountRoutes, handleList, space, NOTE };

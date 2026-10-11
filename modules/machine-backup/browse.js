'use strict';

/**
 * Reading the backup: its snapshots (each with what its run said), one folder level of a snapshot at a time (restic ls
 * is not recursive when given a folder), finding a file across every snapshot, and downloading a file or a folder as a
 * .zip (restic dump, streamed). Every id and path is checked before it becomes an argument, and none reaches a shell.
 */
const restic = require('./restic');
const state = require('./state');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** A snapshot id (8–64 hex) or "latest". */
function snapId(v) {
  const s = String(v || '');
  if (s === 'latest' || /^[0-9a-f]{8,64}$/.test(s)) return s;
  throw bad('Not a snapshot id.');
}

/** A path inside a snapshot, as restic writes it: absolute, with "/" (Windows ones as /C/Users/…). */
function snapPath(v) {
  const s = String(v || '');
  if (!s.startsWith('/') || s.includes('\0') || s.length > 4096 || /(^|\/)\.\.(\/|$)/.test(s)) throw bad('Not a path in a backup.');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

const tagValue = (tags, k) => (tags || []).find(t => t.startsWith(`${k}=`))?.slice(k.length + 1) || null;

/** Every snapshot, newest first, with its run's account where this machine made it. */
async function snapshots() {
  const r = await restic.run(['snapshots', '--json']);
  let list = [];
  try { list = JSON.parse(r.stdout || '[]') || []; } catch { list = []; }
  const runs = new Map(state.runs().filter(x => x.snapshotId).map(x => [x.snapshotId, x]));
  return list.map(s => {
    const run = runs.get(s.id), sum = s.summary || {};
    const start = Date.parse(sum.backup_start || s.time), end = Date.parse(sum.backup_end || '');
    return { id: s.id, short: s.short_id || s.id.slice(0, 8), time: s.time, host: s.hostname, paths: s.paths || [], tags: s.tags || [],
      home: tagValue(s.tags, 'doca-home'), os: tagValue(s.tags, 'doca-os'),
      filesNew: sum.files_new ?? run?.filesNew ?? null, filesTotal: sum.total_files_processed ?? run?.filesTotal ?? null,
      bytesNew: sum.data_added_packed ?? sum.data_added ?? run?.bytesNew ?? null, bytesTotal: sum.total_bytes_processed ?? null,
      seconds: Number.isFinite(end) && Number.isFinite(start) ? Math.round((end - start) / 100) / 10 : run?.seconds ?? null,
      errorCount: run?.errorCount || 0, errors: run?.errors || [],
      // Where each folder would land on this machine when brought back into this home (null: no place here).
      lands: (s.paths || []).map(p => { const home = tagValue(s.tags, 'doca-home'); return home ? require('./folders').mapHome(p, { home, platform: tagValue(s.tags, 'doca-os') || 'linux' }) : null; }) };
  }).sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

/** One folder of a snapshot: [{name, path, type: dir|file|…, size, mtime}]. With no folder, the snapshot's own paths. */
async function list(snapshot, dir) {
  const id = snapId(snapshot);
  if (!dir) {
    const all = await snapshots();
    const s = id === 'latest' ? all[0] : all.find(x => x.id === id || x.id.startsWith(id));
    if (!s) throw bad('No such snapshot.', 404);
    return s.paths.map(p => ({ name: p, path: p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1'), type: 'dir', top: true }));
  }
  const at = snapPath(dir);
  const r = await restic.run(['ls', '--json', id, at]);
  return restic.jsonLines(r.stdout).filter(n => n.struct_type === 'node' && n.path !== at)
    .map(n => ({ name: n.name, path: n.path, type: n.type, size: n.size ?? null, mtime: n.mtime || null }))
    .sort((a, b) => (a.type === 'dir') !== (b.type === 'dir') ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name));
}

/** A file's copies across snapshots: restic find, a glob ("*report*"), at most `limit` matches, newest first. */
async function find(pattern, { limit = 40 } = {}) {
  const p = String(pattern || '').trim();
  if (!p || p.length > 300 || p.includes('\0')) throw bad('Say what to look for: a file name, or a pattern like *report*.');
  const r = await restic.run(['find', '--json', p.includes('*') || p.includes('?') ? p : `*${p}*`]);
  let groups = [];
  try { groups = JSON.parse(r.stdout || '[]') || []; } catch { groups = restic.jsonLines(r.stdout); }
  const times = new Map((await snapshots().catch(() => [])).map(s => [s.id, s.time]));
  const out = [];
  for (const g of groups) for (const m of g.matches || []) out.push({ snapshot: g.snapshot, time: times.get(g.snapshot) || null, path: m.path, type: m.type, size: m.size ?? null, mtime: m.mtime || null });
  out.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return { total: out.length, matches: out.slice(0, limit) };
}

/** Stream a file (as it is) or a folder (as a .zip) out of a snapshot into `res`. */
async function download(snapshot, item, { dir = false, res }) {
  const id = snapId(snapshot), at = snapPath(item);
  const name = (at.split('/').pop() || 'backup').replace(/[^\w.\- ()]/g, '_');
  res.setHeader('Content-Type', dir ? 'application/zip' : 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${dir ? `${name}.zip` : name}"; filename*=UTF-8''${encodeURIComponent(dir ? `${name}.zip` : name)}`);
  // A folder: its content at the root of the zip (snapshot:subfolder), not the whole path above it.
  const args = dir ? ['dump', '--archive', 'zip', `${id}:${at}`, '/'] : ['dump', id, at];
  await restic.run(args, { stdout: res });
  res.end();
}

module.exports = { snapshots, list, find, download, snapId, snapPath, tagValue };

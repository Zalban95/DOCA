'use strict';

/**
 * Settings checkpoints, git style (asked 2026-10-06: "hands off the wheel is fine, checkpoints before edits"). Every
 * save of the prefs file keeps the version it replaces, with which top-level settings changed, so any change — a
 * person's, an applied proposal, Unattended mode applying the agent's own — can be looked at and undone. Restoring is
 * itself a save, so it is checkpointed too and can be undone in turn. The last `KEEP` are kept, in
 * DATA_DIR/checkpoints/prefs (local: a checkpoint is this machine's history, never part of a pack or a backup's restore).
 *
 * Restoring puts back only the leaves that checkpoint's save changed (deep test A, c B4): restoring a `theme` change
 * used to write the whole file back — and a top-level key whole — so the agent's model, chosen since, was gone. Each
 * checkpoint keeps the paths it changed (`leaves`); one kept before them has its leaves worked out from the next
 * version. The panel shows the leaves before a restore.
 */
const fs = require('fs');
const path = require('path');

const KEEP = 200;
const dir = () => path.join(require('./store').DATA_DIR, 'checkpoints', 'prefs');

/** The top-level keys whose value differs between two prefs objects (migrations' own record aside). */
function changed(before = {}, after = {}) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => k !== 'migrations' && JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

const plain = v => v && typeof v === 'object' && !Array.isArray(v);

/** The leaf paths (arrays of keys) whose value differs between two prefs objects; an array is one leaf. */
function leaves(before = {}, after = {}, at = []) {
  if (!plain(before) || !plain(after)) return JSON.stringify(before) === JSON.stringify(after) ? [] : [at];
  const out = [];
  for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!at.length && k === 'migrations') continue;
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    // A section that is new (or gone) is its leaves too, so undoing it never takes what was added beside them later.
    const b = before[k] === undefined && plain(after[k]) ? {} : before[k], a = after[k] === undefined && plain(before[k]) ? {} : after[k];
    out.push(...(plain(b) && plain(a) ? leaves(b, a, [...at, k]) : [[...at, k]]));
  }
  return out;
}

const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const has = (o, k) => plain(o) && Object.prototype.hasOwnProperty.call(o, k);

/** `into` with the value at `path` taken from `from` — or removed, when `from` had none there. */
function putBack(into, from, path) {
  if (path.some(k => UNSAFE.has(k))) return;
  let src = from, dst = into;
  for (const k of path.slice(0, -1)) {
    src = has(src, k) ? src[k] : undefined;
    if (!plain(dst[k])) { if (src === undefined) return; dst[k] = {}; }
    dst = dst[k];
  }
  const last = path.at(-1);
  if (has(src, last)) dst[last] = JSON.parse(JSON.stringify(src[last]));
  else delete dst[last];
}

/** Before `next` is written over `file`: keep what is there, unless nothing would change. Never throws. */
function keep(file, next) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    let before = {};
    try { before = JSON.parse(raw); } catch { /* a broken file is kept as it is */ }
    const keys = changed(before, next);
    if (!keys.length) return null;
    fs.mkdirSync(dir(), { recursive: true });
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), changed: keys, leaves: leaves(before, next), prefs: raw }));
    const all = fs.readdirSync(dir()).filter(n => n.endsWith('.json')).sort();
    for (const n of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(dir(), n), { force: true });
    return id;
  } catch { return null; }
}

const read = n => { try { return JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')); } catch { return null; } };
const names = () => { try { return fs.readdirSync(dir()).filter(n => n.endsWith('.json')).sort(); } catch { return []; } };
const parse = raw => { try { return JSON.parse(raw); } catch { return {}; } };

/** A checkpoint's leaves: kept with it, else worked out against the version after it (the next one, or today's). */
function leavesOf(c, all = names()) {
  if (Array.isArray(c.leaves)) return c.leaves;
  const next = all[all.indexOf(`${c.id}.json`) + 1];
  const after = next ? parse(read(next)?.prefs) : require('./utils').loadPrefs();
  return leaves(parse(c.prefs), after);
}

/** Newest first: when, which settings the save after it changed, and which leaves (dotted paths, up to 40). */
function list(limit = 50) {
  const all = names();
  return all.slice().reverse().slice(0, limit).map(n => {
    const c = read(n);
    if (!c) return null;
    const l = leavesOf(c, all).map(p => p.join('.'));
    return { id: c.id, at: c.at, changed: c.changed, leaves: l.slice(0, 40), more: Math.max(0, l.length - 40) };
  }).filter(Boolean);
}

/** Undo what a checkpoint's save changed, leaf by leaf (the current settings become a checkpoint first, through savePrefs). */
function restore(id) {
  if (!/^[\w-]{10,80}$/.test(String(id))) throw Object.assign(new Error('No such checkpoint.'), { status: 404 });
  const c = read(`${id}.json`);
  if (!c) throw Object.assign(new Error('No such checkpoint.'), { status: 404 });
  let before;
  try { before = JSON.parse(c.prefs); } catch { throw Object.assign(new Error('That checkpoint kept a settings file that was not readable, so there is nothing to put back.'), { status: 409 }); }
  const { loadPrefs, savePrefs } = require('./utils');
  const now = loadPrefs();
  const next = JSON.parse(JSON.stringify(now));
  const paths = leavesOf(c);
  for (const p of paths) putBack(next, before, p);
  savePrefs(next);
  return { restored: id, changed: changed(now, next), leaves: leaves(now, next).map(p => p.join('.')) };
}

function mount(app) {
  app.get('/api/settings/checkpoints', (_req, res) => res.json({ checkpoints: list() }));
  app.post('/api/settings/checkpoints/:id/restore', (req, res) => {
    try { res.json(restore(req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { keep, list, restore, changed, leaves, mount, KEEP };

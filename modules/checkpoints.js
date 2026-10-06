'use strict';

/**
 * Settings checkpoints, git style (asked 2026-10-06: "hands off the wheel is fine, checkpoints before edits"). Every
 * save of the prefs file keeps the version it replaces, with which top-level settings changed, so any change — a
 * person's, an applied proposal, Unattended mode applying the agent's own — can be looked at and undone. Restoring is
 * itself a save, so it is checkpointed too and can be undone in turn. The last `KEEP` are kept, in
 * DATA_DIR/checkpoints/prefs (local: a checkpoint is this machine's history, never part of a pack or a backup's restore).
 */
const fs = require('fs');
const path = require('path');

const KEEP = 200;
const dir = () => path.join(require('./store').DATA_DIR, 'checkpoints', 'prefs');

/** The top-level keys whose value differs between two prefs objects (migrations' own record aside). */
function changed(before = {}, after = {}) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => k !== 'migrations' && JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
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
    fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), changed: keys, prefs: raw }));
    const all = fs.readdirSync(dir()).filter(n => n.endsWith('.json')).sort();
    for (const n of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(dir(), n), { force: true });
    return id;
  } catch { return null; }
}

/** Newest first: when, and which settings the save after it changed. */
function list(limit = 50) {
  let names = [];
  try { names = fs.readdirSync(dir()).filter(n => n.endsWith('.json')).sort().reverse().slice(0, limit); } catch { return []; }
  return names.map(n => { try { const c = JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')); return { id: c.id, at: c.at, changed: c.changed }; } catch { return null; } }).filter(Boolean);
}

/** Put a checkpoint's settings back (the current ones become a checkpoint first, through savePrefs). */
function restore(id) {
  if (!/^[\w-]{10,80}$/.test(String(id))) throw Object.assign(new Error('No such checkpoint.'), { status: 404 });
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf8')); } catch { throw Object.assign(new Error('No such checkpoint.'), { status: 404 }); }
  const prefs = JSON.parse(c.prefs);
  const { loadPrefs, savePrefs } = require('./utils');
  const now = loadPrefs();
  savePrefs(prefs);
  return { restored: id, changed: changed(now, prefs) };
}

function mount(app) {
  app.get('/api/settings/checkpoints', (_req, res) => res.json({ checkpoints: list() }));
  app.post('/api/settings/checkpoints/:id/restore', (req, res) => {
    try { res.json(restore(req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { keep, list, restore, changed, mount, KEEP };

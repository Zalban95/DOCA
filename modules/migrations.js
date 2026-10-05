'use strict';

/**
 * Migrations for the prefs file (TODO H2.5; hive.md §1, "upgradable").
 *
 * A default that changes needs nothing here: settings-schema.js `value()` falls back to the declared default, so
 * every install that never set the key gets the new one. What does need a migration is a key that is renamed or
 * moved — the old name would sit in somebody's file, unread, while the new code read its default — and a stored
 * value that equals an old default and should follow it. Each migration is a row in MIGRATIONS, run once per prefs
 * file, in order, when the server starts (server.js, before createApp), so a restored backup or a copied file
 * from an older install is brought forward at its next start.
 *
 *   { id: '2.178-tts-voice', note: 'what changed and why', steps: [move('a.b', 'c.d'), defaultChanged('x.y', 5, 10)] }
 *
 * Steps are idempotent (a move whose source is gone does nothing; the newer key wins when both exist), the prefs
 * file is copied to DATA_DIR/migrations/ before it is rewritten, and what ran is recorded in the file itself under
 * `migrations.applied`, so the record travels with the file. A new file is stamped as having every migration the
 * code that creates it knows (utils.savePrefs → stamp()), so a value a person chose later is never
 * mistaken for an old default; an existing file is never stamped, since apply() runs before anything saves.
 */
const fs = require('fs');
const path = require('path');

const get = (o, dotted) => dotted.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function set(o, dotted, v) {
  const ks = dotted.split('.'); const last = ks.pop();
  let x = o;
  for (const k of ks) { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; }
  x[last] = v;
}
function unset(o, dotted) {
  const ks = dotted.split('.'); const chain = [o];
  for (const k of ks.slice(0, -1)) { const n = chain[chain.length - 1]?.[k]; if (n == null || typeof n !== 'object') return; chain.push(n); }
  delete chain[chain.length - 1][ks[ks.length - 1]];
  // Leave no empty objects behind where the old key was.
  for (let i = chain.length - 1; i > 0; i--) if (!Object.keys(chain[i]).length) delete chain[i - 1][ks[i - 1]];
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A key renamed or moved (`from` and `to` are dotted paths). When both exist, `to` — written by newer code — wins. */
const move = (from, to) => ({ describe: `${from} → ${to}`, run(p) {
  const v = get(p, from);
  if (v === undefined) return false;
  if (get(p, to) === undefined) set(p, to, v);
  unset(p, from);
  return true;
} });

/** A stored value equal to the old default follows the new one; anything else was somebody's choice and stays. */
const defaultChanged = (at, was, now) => ({ describe: `${at}: ${JSON.stringify(was)} → ${JSON.stringify(now)} (it was the old default)`, run(p) {
  if (!same(get(p, at), was)) return false;
  set(p, at, now);
  return true;
} });

/** A key nothing reads any more. */
const drop = at => ({ describe: `${at} removed`, run(p) {
  if (get(p, at) === undefined) return false;
  unset(p, at);
  return true;
} });

// Newest last. An id is never reused or edited once released: a file that has it recorded will not run it again.
const MIGRATIONS = [];

const appliedIn = p => new Set(Array.isArray(p?.migrations?.applied) ? p.migrations.applied : []);

/** Pure: the prefs brought forward, and what ran. `list` is for tests. */
function run(prefs, list = MIGRATIONS, now = new Date().toISOString()) {
  const out = JSON.parse(JSON.stringify(prefs || {}));
  const done = appliedIn(out);
  const ran = [];
  for (const m of list) {
    if (done.has(m.id)) continue;
    const changed = m.steps.filter(s => s.run(out)).map(s => s.describe);
    done.add(m.id);
    ran.push({ id: m.id, note: m.note, changed, at: now });
  }
  if (ran.length) out.migrations = { ...(out.migrations || {}), applied: [...done],
    log: [...(out.migrations?.log || []), ...ran.filter(r => r.changed.length)].slice(-20) };
  return { prefs: out, ran };
}

/** A new prefs file, about to be written by this code: it has had every migration this code knows. */
function stamp(prefs, list = MIGRATIONS) {
  if (!prefs || typeof prefs !== 'object' || prefs.migrations) return prefs;
  return { ...prefs, migrations: { applied: list.map(m => m.id) } };
}

function backupDir() { return path.join(require('./store').DATA_DIR, 'migrations'); }

/** At start: run what this prefs file has not had, keeping a copy of it first. Never creates a prefs file. */
function apply({ file = require('./paths').PREFS_FILE, list = MIGRATIONS, log = console.log } = {}) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { ran: [] }; }
  let prefs;
  try { prefs = JSON.parse(raw); } catch { return { ran: [], error: 'the prefs file is not JSON; left as it is' }; }
  const { prefs: next, ran } = run(prefs, list);
  if (!ran.length) return { ran };
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, `prefs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(copy, raw, { mode: 0o600 });
  for (const old of fs.readdirSync(dir).filter(f => f.startsWith('prefs-')).sort().slice(0, -10)) fs.rmSync(path.join(dir, old), { force: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  for (const r of ran.filter(r => r.changed.length)) log(`[migrations] ${r.id}: ${r.changed.join('; ')}`);
  return { ran, backup: copy };
}

/** For Settings → System: every migration, whether this prefs file has had it, and what it changed here. */
function status(prefs = require('./utils').loadPrefs()) {
  const done = appliedIn(prefs);
  const log = prefs?.migrations?.log || [];
  return { migrations: MIGRATIONS.map(m => ({ id: m.id, note: m.note, steps: m.steps.map(s => s.describe), applied: done.has(m.id),
    changed: log.find(l => l.id === m.id)?.changed || [], at: log.find(l => l.id === m.id)?.at || null })) };
}

function mount(app) {
  app.get('/api/settings/migrations', (req, res) => res.json(status()));
}

module.exports = { MIGRATIONS, move, defaultChanged, drop, run, stamp, apply, status, mount };

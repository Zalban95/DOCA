'use strict';

/**
 * The data layer (docs/design/database.md): SQLite by default, PostgreSQL when
 * DOCA_DB_URL names one — the same calls either way.
 *
 *   await db.ready()           open and migrate (once)
 *   await db.run(sql, params)  → { changes }
 *   await db.all(sql, params)  → rows
 *   await db.get(sql, params)  → row | undefined
 *   await db.tx(async q => …)  a transaction; q has run / all / get
 *   await db.snapshot(file)    a consistent copy (SQLite: VACUUM INTO)
 *
 * SQL is written once, in the subset both speak, with `?` placeholders.
 */
const fs   = require('fs');
const path = require('path');
const store = require('../store');

let impl = null;
let opening = null;

function sqlite() {
  // node:sqlite still announces itself as experimental on Node 22; say it once in our words instead.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w?.message || w).includes('SQLite') ? undefined : emit.call(process, w, ...a));
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } finally { process.emitWarning = emit; }
  const file = path.join(store.DATA_DIR, 'doca.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  const q = {
    run: async (sql, p = []) => { const r = d.prepare(sql).run(...p); return { changes: Number(r.changes) }; },
    all: async (sql, p = []) => d.prepare(sql).all(...p),
    get: async (sql, p = []) => d.prepare(sql).get(...p),
  };
  return {
    kind: 'sqlite', file, ...q,
    exec: async sql => d.exec(sql),
    tx: async fn => { d.exec('BEGIN'); try { const r = await fn(q); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; } },
    snapshot: async to => { fs.rmSync(to, { force: true }); d.prepare('VACUUM INTO ?').run(to); return to; },
    close: () => d.close(),
  };
}

function postgres(url) {
  let pg;
  try { pg = require('pg'); } catch { throw new Error('DOCA_DB_URL names PostgreSQL, and the "pg" package is not installed: npm install pg'); }
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const numbered = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const on = c => ({
    run: async (sql, p = []) => ({ changes: (await c.query(numbered(sql), p)).rowCount }),
    all: async (sql, p = []) => (await c.query(numbered(sql), p)).rows,
    get: async (sql, p = []) => (await c.query(numbered(sql), p)).rows[0],
  });
  return {
    kind: 'postgres', url: url.replace(/:[^:@/]*@/, ':***@'), ...on(pool),
    exec: async sql => pool.query(sql),
    tx: async fn => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn(on(c)); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    snapshot: async () => null,   // a server database is backed up by its own tools (pg_dump), not by copying files
    close: () => pool.end(),
  };
}

/** Open (once) and bring the schema up to date. */
function ready() {
  if (impl) return Promise.resolve(impl);
  if (!opening) opening = (async () => {
    const d = process.env.DOCA_DB_URL ? postgres(process.env.DOCA_DB_URL) : sqlite();
    await require('./migrations').migrate(d);
    impl = d;
    return d;
  })().catch(e => { opening = null; throw e; });
  return opening;
}

const call = name => async (...a) => (await ready())[name](...a);

/** For tests and for a restore that replaces the file: close, so the next call opens again. */
function close() { try { impl?.close(); } catch { /* closed */ } impl = null; opening = null; }

module.exports = { ready, run: call('run'), all: call('all'), get: call('get'), tx: call('tx'), snapshot: call('snapshot'), close,
  get kind() { return impl?.kind || (process.env.DOCA_DB_URL ? 'postgres' : 'sqlite'); } };

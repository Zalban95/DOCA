'use strict';

/**
 * The Library's index in doca.db (schema step 13): `library_items`, a row per file with its size, modified time,
 * content hash, state and mechanical description; `library_pieces`, a row per piece with its vector (base64 float32,
 * as `embeddings` keeps them). Searching keeps one model's vectors in memory — loaded on the first search, dropped
 * when the index changes and after IDLE_MS without a search — because decoding every row per search would be the
 * slow part; pgvector is where this goes past a few hundred thousand pieces.
 */
const db = require('../db');
const E = require('../retrieval/embed');

const IDLE_MS = 10 * 60 * 1000;
let _mem = null, _timer = null;   // {model, rows: [{path, piece, kind, at, end, text, vec}]}

function forget() { _mem = null; if (_timer) { clearTimeout(_timer); _timer = null; } }

const parse = r => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : {}, size: Number(r.size), mtimeMs: Number(r.mtime_ms) });

async function items(where = '', args = []) {
  return (await db.all(`SELECT * FROM library_items WHERE tenant_id = 'local'${where}`, args)).map(parse);
}
async function item(p) { const r = await db.get("SELECT * FROM library_items WHERE tenant_id = 'local' AND path = ?", [p]); return r ? parse(r) : null; }

/** Replace a file's row and pieces in one transaction; pieces carry their vectors already. */
async function put(row, pieces = null, model = null) {
  await db.tx(async q => {
    await q.run("DELETE FROM library_items WHERE tenant_id = 'local' AND path = ?", [row.path]);
    await q.run(`INSERT INTO library_items (path, folder, kind, size, mtime_ms, hash, model, state, note, meta, indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [row.path, row.folder, row.kind, row.size, row.mtimeMs, row.hash || null, row.model || null, row.state, row.note || null, JSON.stringify(row.meta || {}), new Date().toISOString()]);
    if (!pieces) return;
    await q.run("DELETE FROM library_pieces WHERE tenant_id = 'local' AND path = ?", [row.path]);
    let n = 0;
    for (const p of pieces) {
      if (!p.vec) continue;
      const v = E.normalise(p.vec);
      await q.run('INSERT INTO library_pieces (path, piece, kind, at_sec, end_sec, text, model, dims, vec) VALUES (?,?,?,?,?,?,?,?,?)',
        [row.path, n++, p.kind, p.at ?? null, p.end ?? null, p.text ? String(p.text).slice(0, 4000) : null, model, v.length, E.toText(v)]);
    }
  });
  forget();
}

/** Only the time changed: the content hash is the same, so the pieces stand. */
async function touch(p, mtimeMs) {
  await db.run("UPDATE library_items SET mtime_ms = ? WHERE tenant_id = 'local' AND path = ?", [mtimeMs, p]);
}

async function remove(paths) {
  if (!paths.length) return 0;
  await db.tx(async q => {
    for (const p of paths) {
      await q.run("DELETE FROM library_pieces WHERE tenant_id = 'local' AND path = ?", [p]);
      await q.run("DELETE FROM library_items WHERE tenant_id = 'local' AND path = ?", [p]);
    }
  });
  forget();
  return paths.length;
}

async function clear() {
  await db.run("DELETE FROM library_pieces WHERE tenant_id = 'local'");
  await db.run("DELETE FROM library_items WHERE tenant_id = 'local'");
  forget();
}

async function pieceCount() { return Number((await db.get("SELECT COUNT(*) AS n FROM library_pieces WHERE tenant_id = 'local'"))?.n || 0); }

/** A file's pieces with their vectors (tags, similar files). */
async function piecesOf(p, model) {
  return (await db.all("SELECT piece, kind, at_sec, end_sec, text, vec FROM library_pieces WHERE tenant_id = 'local' AND path = ? AND model = ? ORDER BY piece", [p, model]))
    .map(r => ({ piece: r.piece, kind: r.kind, at: r.at_sec, end: r.end_sec, text: r.text, vec: E.fromText(r.vec) }));
}

/** Every piece of one model, decoded once and kept while searches come. */
async function vectors(model) {
  if (_mem?.model !== model) {
    const rows = await db.all("SELECT path, piece, kind, at_sec, end_sec, text, vec FROM library_pieces WHERE tenant_id = 'local' AND model = ?", [model]);
    _mem = { model, rows: rows.map(r => ({ path: r.path, piece: r.piece, kind: r.kind, at: r.at_sec, end: r.end_sec, text: r.text, vec: E.fromText(r.vec) })) };
  }
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(forget, IDLE_MS);
  if (_timer.unref) _timer.unref();
  return _mem.rows;
}

async function stats() {
  const byKind = await db.all("SELECT kind, state, COUNT(*) AS n FROM library_items WHERE tenant_id = 'local' GROUP BY kind, state");
  return { byKind: byKind.map(r => ({ kind: r.kind, state: r.state, n: Number(r.n) })), pieces: await pieceCount() };
}

module.exports = { items, item, put, touch, remove, clear, pieceCount, piecesOf, vectors, stats, forget };

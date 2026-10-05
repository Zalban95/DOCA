'use strict';

/**
 * Documents and lines in the database, synchronously (docs/design/database.md,
 * step 2): what conversations are (their index, `harness/sessions`), what they
 * say (each transcript, `transcript:<id>`), and what the agent remembers
 * (`harness/memory`). The same shapes the JSON / JSONL files had, so the
 * callers (harness/memory.js) change only where they read and write.
 *
 * A key's old file is imported the first time the key is read, once, and left
 * on disk. With PostgreSQL configured this falls back to the files (its driver
 * is asynchronous; an in-memory copy in front of it is the later step), and
 * says so once.
 */
const fs = require('fs');
const store = require('../store');

let _warned = false;
function h() {
  const raw = require('./index').syncHandle();
  if (!raw && !_warned) { _warned = true; console.warn('[db] PostgreSQL is configured: conversations and memory stay in files for now.'); }
  return raw;
}
const now = () => new Date().toISOString();

function imported(raw, key) { return !!raw.prepare('SELECT 1 FROM meta WHERE key = ?').get(`imported:${key}`); }
function mark(raw, key) { raw.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(`imported:${key}`, now()); }

/** Pull a key's old file in, once, inside one write-locked transaction (another process may be doing the same). */
function importOnce(raw, key, file, kind) {
  if (imported(raw, key)) return;
  raw.exec('BEGIN IMMEDIATE');
  try {
    if (!imported(raw, key)) {
      if (kind === 'doc') {
        const doc = fs.existsSync(file) ? store.readJson(key, undefined) : undefined;
        if (doc !== undefined) raw.prepare('INSERT OR REPLACE INTO docs (tenant_id, key, value, updated_at) VALUES (\'local\', ?, ?, ?)').run(key, JSON.stringify(doc), now());
      } else {
        const ins = raw.prepare('INSERT INTO lines (tenant_id, key, value) VALUES (\'local\', ?, ?)');
        for (const row of store.readJsonl(file)) ins.run(key, JSON.stringify(row));
      }
      mark(raw, key);
    }
    raw.exec('COMMIT');
  } catch (e) { raw.exec('ROLLBACK'); throw e; }
}

const docFile = key => require('path').join(store.DATA_DIR, `${key}.json`);

function getDoc(key, fallback) {
  const raw = h();
  if (!raw) return store.readJson(key, fallback);
  importOnce(raw, key, docFile(key), 'doc');
  const row = raw.prepare('SELECT value FROM docs WHERE tenant_id = \'local\' AND key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setDoc(key, value) {
  const raw = h();
  if (!raw) return store.writeJson(key, value);
  importOnce(raw, key, docFile(key), 'doc');
  raw.prepare('INSERT OR REPLACE INTO docs (tenant_id, key, value, updated_at) VALUES (\'local\', ?, ?, ?)').run(key, JSON.stringify(value), now());
}

/** Every line of `key`, oldest first. `file` is where versions before the database kept them. */
function lines(key, file) {
  const raw = h();
  if (!raw) return store.readJsonl(file);
  importOnce(raw, key, file, 'lines');
  return raw.prepare('SELECT value FROM lines WHERE tenant_id = \'local\' AND key = ? ORDER BY id').all(key).map(r => JSON.parse(r.value));
}

function append(key, file, row) {
  const raw = h();
  if (!raw) return store.appendJsonl(file, row);
  importOnce(raw, key, file, 'lines');
  raw.prepare('INSERT INTO lines (tenant_id, key, value) VALUES (\'local\', ?, ?)').run(key, JSON.stringify(row));
}

/**
 * Rewrite the newest of `key`'s lines that `change` returns a new value for (it returns null to pass one by), looking
 * back at most `depth` lines. The one place a line changes after it was written: a spoken answer cut short by the
 * person (chat-call-hold.js) keeps only what was heard.
 */
function editLast(key, file, change, depth = 60) {
  const raw = h();
  if (!raw) {
    const rows = store.readJsonl(file);
    for (let i = rows.length - 1; i >= Math.max(0, rows.length - depth); i--) {
      const next = change(rows[i]);
      if (next) { rows[i] = next; fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); return next; }
    }
    return null;
  }
  importOnce(raw, key, file, 'lines');
  for (const r of raw.prepare('SELECT id, value FROM lines WHERE tenant_id = \'local\' AND key = ? ORDER BY id DESC LIMIT ?').all(key, depth)) {
    const next = change(JSON.parse(r.value));
    if (next) { raw.prepare('UPDATE lines SET value = ? WHERE id = ?').run(JSON.stringify(next), r.id); return next; }
  }
  return null;
}

/** Forget a key's lines — and its old file, so it is not imported again. */
function dropLines(key, file) {
  const raw = h();
  try { fs.rmSync(file, { force: true }); } catch { /* gone */ }
  if (!raw) return;
  raw.prepare('DELETE FROM lines WHERE tenant_id = \'local\' AND key = ?').run(key);
  mark(raw, key);
}

module.exports = { getDoc, setDoc, lines, append, editLast, dropLines };

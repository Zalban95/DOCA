'use strict';

/**
 * Tiny durable store: atomic JSON documents and append-only JSONL logs under
 * DOCA_DATA_DIR (default <repo>/.doca). Used by the /api/v1 client layer and
 * by the built-in harness for sessions and memory.
 *
 * Deliberately separate from .dashboard-prefs.json, which is read-modify-
 * written from many modules without coordination. Everything here goes
 * through one writer per document and uses tmp+rename so a crash mid-write
 * never leaves a torn file.
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DOCA_DATA_DIR || path.join(__dirname, '..', '.doca');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

function docPath(name) { return path.join(DATA_DIR, `${name}.json`); }

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(docPath(name), 'utf8')); }
  catch { return typeof fallback === 'function' ? fallback() : fallback; }
}

function writeJson(name, data) {
  ensureDir(path.dirname(docPath(name)));
  const tmp = docPath(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, docPath(name));
}

function removeJson(name) {
  try { fs.rmSync(docPath(name), { force: true }); } catch {}
}

/** Sub-directory helper (media, outbox, artifacts, harness…). */
function dir(sub) { return ensureDir(path.join(DATA_DIR, sub)); }

function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function writeJsonl(file, rows) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

module.exports = { DATA_DIR, dir, readJson, writeJson, removeJson, appendJsonl, readJsonl, writeJsonl };

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

// DOCA_HOME is where the launcher (run.sh) keeps what outlives a version: set,
// it holds the data even when this code runs from a release folder.
const DATA_DIR = process.env.DOCA_DATA_DIR || path.join(process.env.DOCA_HOME || path.join(__dirname, '..'), '.doca');

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

/**
 * The shape of the data in DATA_DIR, as one number.
 *
 * A version reads the data it finds, and a rollback runs older code on newer
 * data — so the data says which shape it is in, and a version whose code is
 * older than that shape is refused (see modules/releases.js), and so is a
 * `.dBac` restore into it. `package.json` → `docaDataFormat` is what this code
 * writes; bump both together, with a migration, when the shape changes.
 * Stamped the first time this runs against a data directory without a stamp.
 */
const DATA_FORMAT = Number(require('../package.json').docaDataFormat) || 1;

function dataFormat() {
  let stamp = readJson('format', null);
  if (!stamp) {
    stamp = { dataFormat: DATA_FORMAT, stampedBy: require('../package.json').version, at: new Date().toISOString() };
    try { writeJson('format', stamp); } catch {}
  }
  return Number(stamp.dataFormat) || 1;
}

module.exports = { DATA_DIR, DATA_FORMAT, dataFormat, dir, readJson, writeJson, removeJson, appendJsonl, readJsonl, writeJsonl };

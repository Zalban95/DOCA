'use strict';
/**
 * Reading and writing the files of the protected keys folder so that a power cut cannot lose them.
 *
 * Found 2026-10-11: the keys for services were a plain writeFileSync, which empties the file before it writes it, and
 * every reader turned a file it could not parse into "no keys". A power cut on 2026-10-09 left the file damaged; the
 * next key saved (a day later) wrote a file holding only itself, and Home Assistant's token was gone.
 *
 * So: a write goes to a temporary file, flushed to disk, then renamed over the old one (a rename is all or nothing),
 * and the file it replaces is kept beside it as `<name>.prev`. A read of a file that is there but cannot be read
 * falls back to `.prev`, keeps the damaged one as `<name>.damaged-<time>` for a person to look at, and says so; with
 * no good copy at all it throws, so a save refuses rather than writing over keys it could not read.
 */
const fs = require('fs');
const path = require('path');

class DamagedKeys extends Error {
  constructor(file) {
    super(`The keys file ${path.basename(file)} cannot be read and has no good earlier copy — nothing was changed. ` +
      `It is kept as it is in ${path.dirname(file)}; restore it from a backup, or move it away to start empty.`);
    this.code = 'keys_damaged'; this.status = 500; this.file = file;
  }
}

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) throw new SyntaxError('empty');
  return JSON.parse(text);
}

/** The file's contents, `empty` when there is none yet. A damaged file falls back to its earlier copy, or throws. */
function read(file, empty = {}) {
  if (!fs.existsSync(file)) return empty;
  try { return parse(file); } catch { /* damaged: below */ }
  const prev = file + '.prev';
  let good;
  try { good = parse(prev); } catch { throw new DamagedKeys(file); }
  const aside = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { fs.renameSync(file, aside); fs.copyFileSync(prev, file); fs.chmodSync(file, 0o600); } catch { /* read-only: still answer */ }
  console.warn(`[keys] ${path.basename(file)} could not be read — its earlier copy is used, the damaged one kept as ${path.basename(aside)}`);
  try { require('./activity').note({ from: 'hub', what: `${path.basename(file)} could not be read: its earlier copy is used`, why: `the damaged file is kept as ${path.basename(aside)}` }); } catch { /* no activity log here */ }
  return good;
}

/** Write `data` as JSON, all or nothing, keeping what it replaces as `.prev`. */
function write(file, data, { compact = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, compact ? JSON.stringify(data) : JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(file)) {
    try { parse(file); fs.copyFileSync(file, file + '.prev'); fs.chmodSync(file + '.prev', 0o600); } catch { /* never keep a damaged copy as the earlier one */ }
  }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  try { const d = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch { /* Windows cannot open a folder */ }
}

module.exports = { read, write, DamagedKeys };

'use strict';

/**
 * Reading what other agents append to their own session records, a little at a time (index.js). Each file is read from
 * the byte where the last look stopped — never again from the start — at most CAP bytes a look, and only whole lines are
 * handed on (a line still being written waits for the next look). Only this account's own regular files are read: a
 * symbolic link is never followed, a file owned by someone else is left alone, and a folder is walked only below the
 * root it was given. A file that shrank or was replaced is read again from its start.
 */
const fs = require('fs');
const path = require('path');

const CAP = 256 * 1024;          // bytes a file gives per look
const MAX_LINE = 2 * 1024 * 1024; // a line longer than this (a pasted file) is skipped whole
const mine = () => (typeof process.getuid === 'function' ? process.getuid() : null);

/** A regular file of this account, not a link: its stat, or null. */
function own(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) return null;
    const uid = mine();
    if (uid != null && st.uid !== uid) return null;
    return st;
  } catch { return null; }
}

/**
 * Files under `root` matching `match`, at most `depth` folders down, modified in the last `withinMs` — never through a
 * link, newest first, at most `max`.
 */
function find(root, { match, depth = 2, withinMs = 6 * 3600e3, max = 200 } = {}) {
  const out = [], now = Date.now();
  const walk = (dir, d) => {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (d > 0) walk(p, d - 1); continue; }
      if (!e.isFile() || !match(p)) continue;
      const st = own(p);
      if (st && now - st.mtimeMs < withinMs) out.push({ file: p, mtimeMs: st.mtimeMs, size: st.size });
    }
  };
  try { if (fs.lstatSync(root).isDirectory()) walk(root, depth); } catch { /* not on this machine */ }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max);
}

/** One reader over many files: what each holds since the last look. */
function reader() {
  const state = new Map();   // file → { ino, offset, carry, meta }
  return {
    /** Known from now on: `fromStart` reads it from its first byte (a session that began after the reader did), else from its end. */
    know(file, fromStart) {
      if (state.has(file)) return state.get(file);
      const st = own(file);
      const s = { ino: st?.ino ?? null, offset: fromStart || !st ? 0 : st.size, carry: Buffer.alloc(0), meta: {} };
      state.set(file, s);
      return s;
    },
    /** The whole lines appended since the last look, and the file's own state (`meta`, for its parser). */
    lines(file) {
      const s = this.know(file, true), st = own(file);
      if (!st) return { lines: [], meta: s.meta };
      if (st.ino !== s.ino || st.size < s.offset) { s.ino = st.ino; s.offset = 0; s.carry = Buffer.alloc(0); }
      if (st.size === s.offset) return { lines: [], meta: s.meta };
      const n = Math.min(CAP, st.size - s.offset), buf = Buffer.alloc(n);
      let fd = null;
      try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); fs.readSync(fd, buf, 0, n, s.offset); } catch { return { lines: [], meta: s.meta }; } finally { if (fd != null) try { fs.closeSync(fd); } catch { /* closed */ } }
      s.offset += n;
      // Kept as bytes until a newline: a character cut by the cap is joined whole at the next look.
      const all = s.carry.length ? Buffer.concat([s.carry, buf]) : buf, end = all.lastIndexOf(0x0a);
      s.carry = Buffer.from(end < 0 ? all : all.subarray(end + 1));
      if (s.carry.length > MAX_LINE) s.carry = Buffer.alloc(0);   // past the cap: dropped, and the next newline starts afresh
      const text = end < 0 ? '' : all.subarray(0, end).toString('utf8');
      return { lines: text.split('\n').filter(l => l.trim()), meta: s.meta };
    },
    forget(file) { state.delete(file); },
    has: file => state.has(file),
    size: () => state.size,
    clear: () => state.clear(),
  };
}

module.exports = { find, reader, own, CAP };

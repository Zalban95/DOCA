'use strict';

/**
 * Read a file only when it is a regular file (audit 2026-10-17: the live hub stopped answering — 116 connections queued,
 * its main thread in `wait_for_partner`, the kernel's wait for the other end of a named pipe). A synchronous read of a
 * FIFO, a socket or a device waits for a writer that may never come, and in Node that wait is the whole hub's: every
 * page, call and device goes silent. Paths that come from a person, an agent or a folder being walked or watched (the
 * Workstream's sentinel, the Files tab, read_file, search) are read through here; another program's pipe in a watched
 * folder — a tool on this machine makes them — is then skipped or refused in words instead.
 */
const fs = require('fs');

/** Throws, in words, unless `file` is a regular file; returns its stat. */
function stat(file) {
  const st = fs.statSync(file);
  if (st.isDirectory()) throw Object.assign(new Error(`${file} is a folder, not a file.`), { code: 'EISDIR' });
  if (!st.isFile()) throw Object.assign(new Error(`${file} is not a regular file (a pipe, socket or device): reading it would wait for a writer forever.`), { code: 'ENOTREG' });
  return st;
}

/** fs.readFileSync, for a regular file only. */
function read(file, encoding) {
  stat(file);
  return fs.readFileSync(file, encoding);
}

/** Whether a stat (or Dirent) is a regular file. */
const regular = s => !!s && typeof s.isFile === 'function' && s.isFile();

module.exports = { stat, read, regular };

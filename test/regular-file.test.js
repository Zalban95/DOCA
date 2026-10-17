'use strict';

/**
 * A named pipe never hangs the hub (audit 2026-10-17: the live hub stopped answering, its main thread waiting on the
 * other end of a FIFO). read_file, the Files tab's read, a project search and the Workstream sentinel each meet a pipe
 * and answer at once — refused in words, or skipped — instead of a synchronous read that waits for a writer forever.
 * POSIX only: Windows has no mkfifo.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const posix = process.platform !== 'win32';
let dir, pipe;
before(async () => {
  await H.start();
  if (!posix) return;
  dir = fs.mkdtempSync(path.join(H.tmp, 'fifo-'));
  fs.writeFileSync(path.join(dir, 'note.txt'), 'hello pipe');
  pipe = path.join(dir, 'a-pipe');
  execFileSync('mkfifo', [pipe]);
});
after(() => H.stop());

test('read_file, the Files tab, search and the sentinel answer at once around a named pipe', { skip: !posix && 'no mkfifo on Windows', timeout: 20000 }, async () => {
  const rf = require('../modules/regular-file');
  assert.throws(() => rf.read(pipe), /not a regular file/);
  assert.equal(rf.read(path.join(dir, 'note.txt'), 'utf8'), 'hello pipe');

  const tools = require('../modules/harness/tools');
  const out = await tools.call('read_file', { path: pipe }, [], {});
  assert.match(String(out), /not a regular file/);

  const r = await H.api(null, 'GET', `/api/files/read?path=${encodeURIComponent(pipe)}`);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /Not a regular file/);

  const found = await tools.call('search_files', { path: dir, query: 'hello' }, [], {});
  assert.match(String(found), /note\.txt/, 'the search goes on past the pipe');

  // The Workstream's sentinel hears a change at the pipe's path: it returns, having read nothing.
  const t0 = Date.now();
  require('../modules/workstream/sentinel').report(pipe);
  assert.ok(Date.now() - t0 < 1000, 'the sentinel skips a pipe');
});

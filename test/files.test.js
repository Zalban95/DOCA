'use strict';

/**
 * The files routes, and the difference between "that file is gone" and "the
 * server broke".
 *
 * A config favourite whose file was moved or deleted is the ordinary way a read
 * fails, and it answered 500 — which sent the user looking for a server fault
 * in a file that had simply been renamed. Same class as the `keys.js` ENOENT
 * bug. What is worth pinning is that the status carries the meaning: 404 when
 * the path is not there, 403 when it is there and not ours to read, 500 only
 * when something is genuinely wrong with this process.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');

const h = require('./helpers');           // must come first: it sets the env

test.before(async () => { await h.start(); });
test.after(async () => { await h.stop() });

const get = (p) => h.api(null, 'GET', p);

test('reading a file that is not there is 404, not 500', async () => {
  const missing = path.join(os.tmpdir(), `doca-definitely-not-here-${Date.now()}.txt`);
  const r = await get('/api/files/read?path=' + encodeURIComponent(missing));

  assert.equal(r.status, 404, 'a missing file is not a server fault');
  assert.match(r.body.error, /No such file/);
  assert.equal(r.body.code, 'ENOENT', 'the code travels so the caller can act on it');
});

test('reading a path that is not a file at all is still 404', async () => {
  // ENOTDIR: a component of the path is a file. Same class as ENOENT from the
  // caller's side — the path does not name a readable file — and it used to be
  // a 500 too.
  const f = path.join(os.tmpdir(), `doca-notdir-${Date.now()}.txt`);
  fs.writeFileSync(f, 'x');
  try {
    const r = await get('/api/files/read?path=' + encodeURIComponent(path.join(f, 'child.txt')));
    assert.equal(r.status, 404);
  } finally { fs.unlinkSync(f); }
});

test('reading a file it may not read is 403, not 404 and not 500', async () => {
  // The path exists and is a file; the permission is what stops us. Reporting
  // 404 here would be a lie and 500 would be a false alarm.
  const f = path.join(os.tmpdir(), `doca-noperm-${Date.now()}.txt`);
  fs.writeFileSync(f, 'secret');
  fs.chmodSync(f, 0o000);
  try {
    const r = await get('/api/files/read?path=' + encodeURIComponent(f));
    // Running as root defeats the permission bit entirely; skip rather than
    // assert something the environment cannot produce.
    if (process.getuid && process.getuid() === 0) return;
    assert.equal(r.status, 403);
  } finally { fs.chmodSync(f, 0o600); fs.unlinkSync(f); }
});

test('reading a file that is there still works', async () => {
  const f = path.join(os.tmpdir(), `doca-read-${Date.now()}.txt`);
  fs.writeFileSync(f, 'hello from the files route');
  try {
    const r = await get('/api/files/read?path=' + encodeURIComponent(f));
    assert.equal(r.status, 200);
    assert.equal(r.body.content, 'hello from the files route');
    assert.ok(r.body.mtime, 'mtime still reported');
  } finally { fs.unlinkSync(f); }
});

test('a directory is refused as a directory, not as a fault', async () => {
  const r = await get('/api/files/read?path=' + encodeURIComponent(os.tmpdir()));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Is a directory/);
});

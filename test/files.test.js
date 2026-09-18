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

test('the other filesystem routes report a missing file the same way', async () => {
  // W1.3 named one line number (`files.js:79`) and the fix stopped at it. The
  // same `catch (e) { res.status(500) }` sat on every neighbouring handler, so
  // rename, raw and download each answered 500 for "that file is gone" — the
  // user goes looking for what broke in the panel when nothing did. Found by
  // probing them after fixing only the one the entry named.
  const missing = path.join(os.tmpdir(), `doca-gone-${Date.now()}.txt`);

  const rename = await h.api(null, 'POST', '/api/files/rename',
    { from: missing, to: missing + '.moved' });
  assert.equal(rename.status, 404, 'renaming a file that is gone is not a server fault');
  assert.equal(rename.body.code, 'ENOENT');

  const raw = await get('/api/files/raw?path=' + encodeURIComponent(missing));
  assert.equal(raw.status, 404);
  assert.match(String(raw.body.error), /No such file/);

  const dl = await get('/api/files/download?path=' + encodeURIComponent(missing));
  assert.equal(dl.status, 404);
  assert.match(String(dl.body.error), /No such file/);

  // A rename that CAN work still works, so the guard did not make the route
  // refuse everything.
  const src = path.join(os.tmpdir(), `doca-src-${Date.now()}.txt`);
  fs.writeFileSync(src, 'move me');
  try {
    const ok = await h.api(null, 'POST', '/api/files/rename', { from: src, to: src + '.moved' });
    assert.equal(ok.status, 200);
    assert.equal(fs.readFileSync(src + '.moved', 'utf8'), 'move me');
  } finally { try { fs.unlinkSync(src + '.moved'); } catch {} }
});

test('the filesystem error mapping itself, including the branches a probe cannot reach', async () => {
  // The routes above exercise 404 and 200. EACCES needs a permission bit and
  // root defeats that, and a genuine 500 needs a fault this process cannot
  // produce on demand — so those two arms are checked directly rather than
  // pretended to by a test that would pass for the wrong reason.
  const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'files.js'), 'utf8');
  const status = new Function('e', src.match(/function fsStatus\(e\) \{[\s\S]*?\n\}/)[0] + '; return fsStatus(e);');

  assert.equal(status({ code: 'ENOENT' }), 404);
  assert.equal(status({ code: 'ENOTDIR' }), 404);
  assert.equal(status({ code: 'EACCES' }), 403);
  assert.equal(status({ code: 'EPERM' }), 403);
  assert.equal(status({ code: 'EIO' }), 500, 'a real fault is still a fault');
  assert.equal(status(null), 500);
  assert.equal(status(new Error('no code')), 500);
});

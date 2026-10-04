'use strict';

// /api/files/read?sniff=1 answers a binary file as binary, for the Projects editor's previews.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

test('a NUL in the first 8 KB is binary when asked; text and the unasked read are unchanged', async () => {
  const bin = path.join(H.tmp, 'x.bin'), txt = path.join(H.tmp, 'x.txt');
  fs.writeFileSync(bin, Buffer.from([0x7f, 0x45, 0, 1, 2]));
  fs.writeFileSync(txt, 'héllo');
  const b = await H.api(null, 'GET', `/api/files/read?path=${encodeURIComponent(bin)}&sniff=1`);
  assert.deepEqual({ binary: b.body.binary, size: b.body.size, content: b.body.content }, { binary: true, size: 5, content: undefined });
  const t = await H.api(null, 'GET', `/api/files/read?path=${encodeURIComponent(txt)}&sniff=1`);
  assert.equal(t.body.content, 'héllo');
  const plain = await H.api(null, 'GET', `/api/files/read?path=${encodeURIComponent(bin)}`);
  assert.equal(typeof plain.body.content, 'string', "the Files tab's own read is as it was");
});

test('raw HTML and SVG are served sandboxed; a picture is not (audit 2026-10-04)', async () => {
  const fs2 = require('node:fs');
  const html = path.join(H.tmp, 'evil.html'), png = path.join(H.tmp, 'ok.png');
  fs2.writeFileSync(html, '<script>fetch("/api/files/list")</script>');
  fs2.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const r = await fetch(`${H.base}/api/files/raw?path=${encodeURIComponent(html)}`, { headers: { Cookie: H.owner.cookie } });
  assert.match(r.headers.get('content-security-policy') || '', /sandbox/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const p = await fetch(`${H.base}/api/files/raw?path=${encodeURIComponent(png)}`, { headers: { Cookie: H.owner.cookie } });
  assert.equal(p.headers.get('content-security-policy'), null);
});

test('paste: never into itself, links copied as links, protected files inside a folder left behind (audit 2026-10-04)', async () => {
  const fs2 = require('node:fs');
  const src = fs2.mkdtempSync(path.join(H.tmp, 'paste-src-'));
  fs2.mkdirSync(path.join(src, 'sub'));
  fs2.writeFileSync(path.join(src, 'a.txt'), 'a');
  let linked = true;
  try { fs2.symlinkSync('/etc/hostname', path.join(src, 'host-link')); } catch { linked = false; }
  const into = await H.api(null, 'POST', '/api/files/paste', { op: 'copy', paths: [src], dest: path.join(src, 'sub') });
  assert.equal(into.status, 207);
  assert.match(into.body.errors[0], /cannot be pasted into itself/);
  const dest = fs2.mkdtempSync(path.join(H.tmp, 'paste-dest-'));
  const ok = await H.api(null, 'POST', '/api/files/paste', { op: 'copy', paths: [src], dest });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const copied = path.join(dest, path.basename(src));
  assert.equal(fs2.readFileSync(path.join(copied, 'a.txt'), 'utf8'), 'a');
  if (linked) assert.equal(fs2.lstatSync(path.join(copied, 'host-link')).isSymbolicLink(), true, 'a link stays a link');
});

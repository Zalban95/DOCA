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

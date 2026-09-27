'use strict';

/**
 * The off-site copy (modules/backup/remote.js): Signature V4 by hand, upload,
 * keep the last N there, and never an open backup when only protected ones go.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');

const H      = require('./helpers');
const remote = require('../modules/backup/remote');

let bucket, url;
const objects = new Map();
test.before(async () => {
  await H.start();
  bucket = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!/^AWS4-HMAC-SHA256 Credential=AKTEST\/\d{8}\/eu-test\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/.test(req.headers.authorization || '')) { res.statusCode = 403; return res.end('<Error><Code>AccessDenied</Code><Message>unsigned</Message></Error>'); }
    const key = decodeURIComponent(u.pathname.replace(/^\/b\/?/, ''));
    if (req.method === 'PUT') { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { objects.set(key, Buffer.concat(chunks)); res.end(); }); return; }
    if (req.method === 'DELETE') { objects.delete(key); res.statusCode = 204; return res.end(); }
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
      const pre = u.searchParams.get('prefix') || '';
      return res.end(`<ListBucketResult>${[...objects].filter(([k]) => k.startsWith(pre)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>2026-09-27T00:00:00Z</LastModified><Size>${v.length}</Size></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    res.statusCode = 400; res.end();
  });
  await new Promise(r => bucket.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${bucket.address().port}`;
});
test.after(async () => { bucket.close(); await H.stop(); });

test('Signature V4 matches AWS\'s own published example', () => {
  const h = remote.sign({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z') });
  assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('settings keep the keys write-only; a round trip, then only the last N auto- backups stay', async () => {
  assert.equal((await H.api(null, 'POST', '/api/backups/remote', { endpoint: 'not a url' })).status, 400);
  const saved = await H.api(null, 'POST', '/api/backups/remote', { endpoint: url, region: 'eu-test', bucket: 'b', prefix: 'desk', keep: 2,
    accessKeyId: 'AKTEST', secretAccessKey: 'secret', enabled: true, encryptedOnly: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.hasKeys, true);
  assert.equal(saved.body.prefix, 'desk/');
  assert.ok(!JSON.stringify(saved.body).includes('secret'), 'the secret never comes back');
  assert.deepEqual((await H.api(null, 'POST', '/api/backups/remote/test')).body, { ok: true, listed: true });

  const f = path.join(H.tmp, 'auto-x.dBac');
  fs.writeFileSync(f, 'backup bytes');
  await assert.rejects(remote.afterBackup(f, { encrypted: false }), /not password-protected/);
  for (const n of ['auto-1', 'auto-2', 'auto-3']) { fs.copyFileSync(f, path.join(H.tmp, `${n}.dBac`)); await remote.afterBackup(path.join(H.tmp, `${n}.dBac`), { encrypted: true }); }
  objects.set('desk/by-hand.dBac', Buffer.from('mine'));
  await remote.prune(2);
  assert.deepEqual([...objects.keys()].sort(), ['desk/auto-2.dBac', 'desk/auto-3.dBac', 'desk/by-hand.dBac'], 'a backup made by hand is never removed');
  assert.equal(objects.get('desk/auto-3.dBac').toString(), 'backup bytes');
});

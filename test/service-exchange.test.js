'use strict';

/** A service that trades id:secret for a token (hi3d.ai's shape), an upload, and a model kept as a file. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const tools = require('../modules/harness/tools');

let stub, origin, tokens = 0, refuseOnce = true, lastUpload = null;
test.before(async () => {
  await H.start();
  stub = http.createServer((req, res) => {
    let raw = Buffer.alloc(0);
    req.on('data', c => { raw = Buffer.concat([raw, c]); });
    req.on('end', () => {
      if (req.url === '/open-api/v1/auth/token') {
        if (req.headers.authorization !== `Basic ${Buffer.from('cid:csecret').toString('base64')}`) { res.statusCode = 401; return res.end('{"code":40010000}'); }
        tokens++;
        return res.end(JSON.stringify({ code: 200, data: { accessToken: `tok-${tokens}-abcdef`, tokenType: 'Bearer' } }));
      }
      if (req.url === '/model.stl') return res.end('solid x\nendsolid x\n');   // a signed link: no token
      if (!/^Bearer tok-\d+-abcdef$/.test(req.headers.authorization || '')) { res.statusCode = 401; return res.end('no'); }
      if (req.url === '/open-api/v1/submit-task') {
        if (refuseOnce) { refuseOnce = false; res.statusCode = 401; return res.end('expired'); }
        lastUpload = raw.toString('latin1');
        return res.end(JSON.stringify({ code: 200, data: { task_id: 't1' }, echo: req.headers.authorization }));
      }
      res.end('{}');
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${stub.address().port}`;
});
test.after(async () => { stub.close(); await H.stop(); });

test('the hub trades id:secret for a token, renews it when refused, uploads a picture, and keeps the model', async () => {
  let r = await H.api(null, 'POST', '/api/connectors/keys/all', { name: 'hi3d', origin, place: 'exchange', field: `${origin}/open-api/v1/auth/token`, key: 'cid:csecret' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await H.api(null, 'POST', '/api/connectors/keys/all', { name: 'bad', origin, place: 'exchange', field: 'https://elsewhere.example/token', key: 'a:b' })).status, 400, 'the token address is the service\'s own');
  const pic = path.join(require('node:os').tmpdir(), `chair-${process.pid}.png`);
  fs.writeFileSync(pic, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  const out = await tools.call('http_fetch', { url: `${origin}/open-api/v1/submit-task`, key: 'hi3d', form: { request_type: '3', model: 'hi3dv3.0' }, files: { images: pic } }, [], {});
  assert.match(out, /HTTP 200/);
  assert.match(out, /"task_id":"t1"/);
  assert.equal(out.includes('tok-'), false, 'the token is never shown');
  assert.equal(tokens, 2, 'refused once: a fresh token, and the request again');
  assert.match(lastUpload, /name="request_type"\r\n\r\n3/);
  assert.match(lastUpload, /name="images"; filename="chair-\d+\.png"/);

  const saved = await tools.call('http_fetch', { url: `${origin}/model.stl`, save_as: 'chair.stl' }, [], {});
  assert.match(saved, /saved .* as chair(-\d+)?\.stl .*as a 3D model/);
  const att = require('../modules/attachments');
  assert.equal(att.playableKind(att.mimeFor('chair.stl')), 'model');
  assert.equal(att.playableKind(att.mimeFor('x.glb')), 'model');
  fs.rmSync(pic, { force: true });
});

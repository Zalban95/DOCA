'use strict';

/** Wake words trained here and kept like models (modules/wakeword): what is ready, refusals, keeping and serving. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('a fresh hub says what training still needs, and refuses to train or record before it is set up', async () => {
  const r = await H.api(null, 'GET', '/api/wakeword?word=doca');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ready, { env: false, generator: false, features: false, rir: false, noise: false, runtime: false });
  assert.deepEqual(r.body.samples, { word: 'doca', said: 0, other: 0 });
  assert.deepEqual(r.body.models, []);
  const t = await H.api(null, 'POST', '/api/wakeword/train', { word: 'doca' });
  assert.equal(t.status, 409);
  assert.match(t.body.error, /Set up the trainer first \(missing: env, generator, features, rir, noise, runtime\)/);
  assert.equal((await H.api(null, 'POST', '/api/wakeword/train', { word: 'ab' })).status, 400, 'three letters at least');
  const rec = await fetch(`${H.base}/api/wakeword/samples?word=doca&kind=word`, { method: 'POST', headers: { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'audio/webm' }, body: Buffer.from('x') });
  assert.equal(rec.status, 409, 'recordings are split by the trainer\'s environment');
  assert.equal((await fetch(`${H.base}/api/wakeword/samples?word=doca&kind=maybe`, { method: 'POST', headers: { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' }, body: Buffer.from('x') })).status, 400);
});

test('a kept model is listed with its scores and served to any signed-in screen; training is an admin\'s', async () => {
  const ww = require('../modules/wakeword');
  const tmp = path.join(ww.dir(), 'tmp.onnx');
  fs.mkdirSync(ww.dir(), { recursive: true });
  fs.writeFileSync(tmp, Buffer.from('onnx-bytes'));
  ww.keep('Doca', tmp, { scores: { heardPerson: { of: 2, n: 2, share: 1 } } });
  const list = (await H.api(null, 'GET', '/api/wakeword')).body.models;
  assert.equal(list[0].name, 'doca');
  assert.equal(list[0].scores.heardPerson.share, 1);
  assert.match(list[0].sha256, /^[0-9a-f]{64}$/);
  const viewer = await H.signIn('viewer');
  const got = await fetch(`${H.base}/api/wakeword/models/doca/model.onnx`, { headers: { Cookie: viewer.cookie } });
  assert.equal(got.status, 200);
  assert.equal(Buffer.from(await got.arrayBuffer()).toString(), 'onnx-bytes');
  assert.equal((await H.api(null, 'GET', '/api/wakeword', undefined, { Cookie: viewer.cookie })).status, 403, 'the rest is an admin\'s');
  assert.equal((await H.api(null, 'POST', '/api/wakeword/setup', {}, { Cookie: viewer.cookie })).status, 403);
  assert.equal((await fetch(`${H.base}/api/wakeword/runtime/passwd`, { headers: { Cookie: viewer.cookie } })).status, 404, 'only the runtime\'s two models');
  assert.equal((await H.api(null, 'DELETE', '/api/wakeword/models/doca')).body.removed, 'doca');
});

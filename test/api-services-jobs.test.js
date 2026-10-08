'use strict';

/**
 * An API service used by its actions (modules/api-services/, the `service` tool), end to end against a stub of hi3d.ai's
 * shape: id:secret traded for a token, a multipart submit, a task asked after until it succeeds, the model and its
 * preview fetched from another address (a CDN) without the key and kept as attachments — and the conversation told.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let api, cdn, origin, cdnOrigin, polls = 0, cdnAuth = [], uploads = [];
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60, 1)]);
const tools = () => require('../modules/harness/tools');
const jobs = () => require('../modules/api-services/jobs');

test.before(async () => {
  await H.start();
  cdn = http.createServer((req, res) => {
    cdnAuth.push(req.headers.authorization || null);
    if (req.url.startsWith('/files/0.glb')) { res.setHeader('Content-Type', 'application/octet-stream'); return res.end(GLB); }
    if (req.url.startsWith('/cover.webp')) { res.setHeader('Content-Type', 'image/webp'); return res.end(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')); }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => cdn.listen(0, '127.0.0.1', r));
  cdnOrigin = `http://127.0.0.1:${cdn.address().port}`;
  api = http.createServer((req, res) => {
    let raw = Buffer.alloc(0);
    req.on('data', c => { raw = Buffer.concat([raw, c]); });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/open-api/v1/auth/token') {
        if (req.headers.authorization !== `Basic ${Buffer.from('cid:csecret').toString('base64')}`) { res.statusCode = 401; return res.end('{}'); }
        return res.end(JSON.stringify({ code: 200, data: { accessToken: 'tok-zz-123456' } }));
      }
      if (req.headers.authorization !== 'Bearer tok-zz-123456') { res.statusCode = 401; return res.end('no'); }
      if (u.pathname === '/open-api/v1/submit-task') { uploads.push(raw.toString('latin1')); return res.end(JSON.stringify({ code: 200, data: { task_id: `t${uploads.length}` } })); }
      if (u.pathname === '/open-api/v1/query-task') {
        polls++;
        const id = u.searchParams.get('task_id');
        if (id === 'tbad') return res.end(JSON.stringify({ code: 50010001, data: {}, msg: 'generate failed' }));
        if (polls % 2) return res.end(JSON.stringify({ code: 200, data: { task_id: id, state: 'processing' } }));
        return res.end(JSON.stringify({ code: 200, data: { task_id: id, state: 'success', url: `${cdnOrigin}/files/0.glb?sig=1`, cover_url: `${cdnOrigin}/cover.webp` } }));
      }
      if (u.pathname === '/open-api/v1/balance') return res.end(JSON.stringify({ code: 200, data: { totalBalance: 14 }, echo: req.headers.authorization }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${api.address().port}`;
  jobs()._unit(10);   // a second is 10 ms here: the hub asks every 200 ms
  // The shipped hi3d template, pointed at the stub: the form's own route reads it, Save keeps it with its key.
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '../modules/api-services/templates/hi3d.openapi.json'), 'utf8'));
  doc.servers = [{ url: `${origin}/open-api/v1` }];
  doc.components.securitySchemes.key.flows.clientCredentials.tokenUrl = `${origin}/open-api/v1/auth/token`;
  const r = await H.api(null, 'POST', '/api/connectors/services/all', { name: 'hi3d', server: `${origin}/open-api/v1`, key: 'cid:csecret',
    openapi: JSON.stringify(doc), auth: { type: 'oauth2', tokenUrl: `${origin}/open-api/v1/auth/token`, tokenBody: 'json' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
test.after(async () => { api.close(); cdn.close(); await H.stop(); });

const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 20)); } return null; };
const picture = () => require('../modules/attachments').save(Buffer.from([137, 80, 78, 71, 1, 2, 3]), 'chair.png', { from: 'test' }).name;

test('list and describe come from the definition; the key is never in them', async () => {
  const list = await tools().call('service', {}, [], {});
  assert.match(list, /hi3d — hi3d\.ai \(Hitem3D\): .*Actions: submitTask \(long job\), queryTask, getBalance/);
  const d = await tools().call('service', { action: 'describe', service: 'hi3d', operation: 'submitTask' }, [], {});
  assert.match(d, /⟦external content — from the API service hi3d/, 'its descriptions are the provider\'s words');
  assert.match(d, /images: string — a file|images \(?.*a file/);
  assert.match(d, /request_type: integer, required, one of 1 \| 2 \| 3/);
  assert.equal(/csecret|tok-zz/.test(list + d), false);
});

test('a long job: submitted, followed by the hub, the files kept from the CDN without the key, the conversation told', async () => {
  const sessionId = require('../modules/harness/memory').createSession('3D').id;
  const out = await tools().call('service', { action: 'call', service: 'hi3d', operation: 'submitTask', params: { request_type: 3, model: 'hi3dv3.0', format: 2 },
    files: { images: picture() }, save_as: 'chair', wait: 0 }, [], { sessionId });
  assert.match(out, /Submitted: job sj_[0-9a-f]+ \(its id at hi3d: t1\)/);
  assert.match(out, /do not poll it yourself/);
  assert.match(uploads[0], /name="request_type"\r\n\r\n3/);
  assert.match(uploads[0], /name="images"; filename="chair(-\d+)?\.png"/);
  const rec = await until(() => { const j = jobs().list({ sessionId })[0]; return j?.state !== 'running' && j; });
  assert.equal(rec.state, 'done', JSON.stringify(rec));
  assert.deepEqual(rec.files.map(f => f.name.replace(/-\d+(?=\.)/, '')), ['chair.glb', 'chair-cover.webp']);
  assert.ok(rec.files[0].model, 'a 3D model');
  assert.deepEqual(fs.readFileSync(rec.files[0].path), GLB);
  assert.deepEqual(cdnAuth, [null, null], 'the CDN never got the key or the token');
  // Automatic turns are off in tests (helpers.js): the message waits for the conversation's next turn.
  const waiting = require('../modules/harness/inbox').waiting(sessionId);
  assert.equal(waiting.length, 1);
  assert.match(waiting[0].message, /^\[panel\] Service job sj_\w+ \(hi3d submitTask, its id there t1\) is done\.\nKept:\n- chair/);
  assert.match(waiting[0].message, /Show it with show_media/);
  assert.ok(require('../modules/activity').list({ limit: 20 }).some(a => a.from === 'services' && /hi3d submitTask done: kept chair/.test(a.what)));
});

test('a job that ends within the wait is answered in the call, and wakes nobody; a free conversation is woken', async () => {
  const sessionId = require('../modules/harness/memory').createSession('quick').id;
  const out = await tools().call('service', { action: 'call', service: 'hi3d', operation: 'submitTask', params: { request_type: 3, model: 'hi3dv3.0' },
    files: { images: picture() }, wait: 10 }, [], { sessionId });
  assert.match(out, /is done\.\nKept:/);
  assert.equal(require('../modules/harness/inbox').waiting(sessionId).length, 0);

  const sup = require('../modules/harness/supervisor');
  const woken = [];
  sup._setTurn(async (id, message) => { woken.push({ id, message }); return { text: 'ok' }; });
  sup._setEnabled(true);
  try {
    const other = require('../modules/harness/memory').createSession('woken').id;
    await tools().call('service', { action: 'call', service: 'hi3d', operation: 'submitTask', follow: 'tbad', wait: 0 }, [], { sessionId: other });
    await until(() => woken.length);
    assert.equal(woken[0].id, other);
    assert.match(woken[0].message, /^\[panel\] Service job .* failed\.\n⟦external content — from the service hi3d.*\ngenerate failed\n/s);
    assert.match(woken[0].message, /do not submit it again unless the person asks/);
  } finally { sup._setEnabled(false); }
});

test('answers are scrubbed of the token and framed; a restart reports what it stopped following', async () => {
  const out = await tools().call('service', { action: 'call', service: 'hi3d', operation: 'getBalance' }, [], {});
  assert.match(out, /^⟦external content — from the API service hi3d \(getBalance\)/);
  assert.match(out, /"totalBalance":14/);
  assert.match(out, /"echo":"Bearer \[key\]"/);
  assert.equal(out.includes('tok-zz-123456'), false);
  assert.match(await tools().call('service', { action: 'call', service: 'hi3d', operation: 'queryTask', params: {} }, [], {}), /queryTask needs task_id/);
  assert.match(await tools().call('service', { action: 'call', service: 'hi3d', operation: 'nope' }, [], {}), /has no action "nope". It has: submitTask, queryTask, getBalance/);

  const def = require('../modules/api-services/store').get('hi3d');
  const rec = jobs().start(def, def.actions[0], { remote: 'tlate', sessionId: require('../modules/harness/memory').createSession('r').id });
  jobs().recover();
  const j = jobs().get(rec.id);
  assert.equal(j.state, 'interrupted');
  assert.match(jobs().sentence(j), /interrupted by a restart.*follow "tlate"/s);
});

test('the risk table reads the action\'s own method: a read is a read, a submit to a stranger is outward', () => {
  const { classify } = require('../modules/harness/risk/classify');
  assert.equal(classify('service', { action: 'describe', service: 'hi3d' }).tier, 'read');
  assert.equal(classify('service', { service: 'hi3d', operation: 'getBalance' }).tier, 'read');
  assert.equal(classify('service', { service: 'hi3d', operation: 'submitTask' }).tier, 'reversible', '127.0.0.1 is the owner\'s own');
  assert.equal(classify('service', { service: 'nowhere', operation: 'x' }).tier, 'outward', 'unknown reads as a POST to a stranger');
});

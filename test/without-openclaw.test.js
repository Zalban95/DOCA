'use strict';

/**
 * "OpenClaw is a peer, not a prerequisite" (TODO.md), kept true: on a machine
 * with no OpenClaw stack, no ~/.openclaw and no config of its, the panel boots,
 * the built-in harness is the default, a turn runs against a provider added in
 * Settings → API Keys, every OpenClaw surface reports absence rather than
 * failing — and nothing creates OpenClaw's files.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const http   = require('node:http');

const H     = require('./helpers');
const paths = require('../modules/paths');

let model;
test.before(async () => {
  // helpers points COMPOSE_DIR and CONFIG_PATH into a fresh temp dir: nothing of OpenClaw's exists.
  assert.equal(fs.existsSync(paths.CONFIG_PATH), false);
  model = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'm' }] }));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello without OpenClaw.' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  await H.start();
});
test.after(async () => { model.close(); await H.stop(); });

test('the built-in harness is the default, and OpenClaw is simply not installed', async () => {
  const r = await H.api(null, 'GET', '/api/harness');
  assert.equal(r.status, 200);
  assert.equal(r.body.default, 'doca');
  assert.equal(r.body.harnesses.find(h => h.id === 'openclaw').detected, false);
  assert.equal(require('../modules/provider-keys').openclawInstalled(), false);
});

test('a provider added in Settings runs a turn — and no OpenClaw file is created for it', async () => {
  const url = `http://127.0.0.1:${model.address().port}/v1`;
  let r = await H.api(null, 'POST', '/api/keys/add-provider', { name: 'local', baseUrl: url });
  assert.equal(r.status, 200);
  r = await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'local', model: 'm' });
  assert.equal(r.status, 200);

  const res = await fetch(`${H.base}/api/harness/chat`, {
    method: 'POST', body: JSON.stringify({ message: 'Hi' }),
    headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.match(await res.text(), /Hello without OpenClaw\./);
  assert.equal(fs.existsSync(paths.CONFIG_PATH), false, 'still no openclaw.json');
});

test('every OpenClaw surface says "not here" instead of failing', async () => {
  const ok = async p => { const r = await H.api(null, 'GET', p); assert.ok(r.status < 500, `${p} → ${r.status}`); return r.body; };
  assert.deepEqual((await ok('/api/skills')).skills, []);
  await ok('/api/snapshots');
  await ok('/api/chat/status');
  await ok('/api/keys');
  const tools = (await ok('/api/system/tools')).tools;
  assert.equal(tools.find(t => t.id === 'openclaw').detected, false);
  assert.equal(fs.existsSync(paths.CONFIG_PATH), false, 'and looking created nothing either');
});

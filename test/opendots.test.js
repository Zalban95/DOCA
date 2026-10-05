'use strict';

// OpenDots as a peer harness (modules/harness/opendots.js; docs/design/opendots-integration.md §3): its states told
// apart, its own Compose project started and stopped (never its volumes removed), Open to its own page, and the
// floating chat saying where it answers instead of another agent answering for it.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const H = require('./helpers');

const posix = process.platform !== 'win32';
const dir = path.join(H.tmp, 'opendots');
const calls = path.join(H.tmp, 'od-docker.log');
let site;

before(async () => {
  if (posix) {
    const fake = path.join(H.tmp, 'od-docker');
    fs.writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${JSON.stringify(calls)}\nexit 0\n`, { mode: 0o755 });
    process.env.DOCA_CONTAINER_CLI = fake;
  }
  site = http.createServer((_q, r) => r.end('<!doctype html><title>OpenDots</title>'));
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  await H.start();
  const r = await H.api(null, 'POST', '/api/harness/opendots/config', { dir, url: 'http://127.0.0.1:1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
after(async () => { delete process.env.DOCA_CONTAINER_CLI; site.close(); await H.stop(); });

const state = async () => (await H.api(null, 'GET', '/api/harness/opendots/state')).body;
const stack = action => fetch(`${H.base}/api/harness/opendots/stack`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie }, body: JSON.stringify({ action }) }).then(r => r.text());

test('absent, then setup required, then stopped, then answering — each said as such', async () => {
  assert.equal((await state()).state, 'absent');
  const row = (await H.api(null, 'GET', '/api/harness')).body.harnesses.find(h => h.id === 'opendots');
  assert.equal(row.detected, false);
  assert.match(row.installCmd, /git clone https:\/\/github.com\/CopilotKit\/OpenDots\.git .*checkout c2569bb6/, 'pinned, never main or latest');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'compose.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(dir, '.env'), 'INTELLIGENCE_API_KEY=\nOWNER_TOKEN=\n');
  const s = await state();
  assert.equal(s.state, 'setup');
  assert.deepEqual(s.missing, ['INTELLIGENCE_API_KEY', 'OWNER_TOKEN']);
  assert.match(await stack('start'), /Setup first: INTELLIGENCE_API_KEY, OWNER_TOKEN/, 'not started without its keys');
  fs.writeFileSync(path.join(dir, '.env'), 'INTELLIGENCE_API_KEY=ik_123\nOWNER_TOKEN="t0k"\n');
  assert.equal((await state()).state, 'stopped');
  await H.api(null, 'POST', '/api/harness/opendots/config', { url: `http://127.0.0.1:${site.address().port}` });
  assert.equal((await state()).state, 'ready');
  assert.equal((await H.api(null, 'POST', '/api/harness/opendots/config', { url: 'javascript:alert(1)' })).status, 400);
});

test('its own Compose project, started and stopped — its volume is never removed', { skip: !posix && 'a POSIX fake CLI' }, async () => {
  assert.match(await stack('start'), /"ok":true/);
  assert.match(await stack('stop'), /"ok":true/);
  const log = fs.readFileSync(calls, 'utf8');
  assert.match(log, /^compose -p opendots up -d --build$/m);
  assert.match(log, /^compose -p opendots stop$/m);
  assert.doesNotMatch(log, /down|-v\b/);
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'POST', '/api/harness/opendots/config', { dir: '/' }, { Cookie: member.cookie })).status, 403);
});

test('the floating chat says where OpenDots answers, instead of another agent answering', () => {
  const shot = require('../modules/harness/one-shot'), catalog = require('../modules/harness/catalog');
  assert.equal(shot.adapterFor(catalog.get('opendots')), null);
  assert.match(shot.whyNot(catalog.get('opendots')), /answers in its own page/);
});

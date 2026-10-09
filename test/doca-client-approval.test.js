'use strict';

// doca-client paired by a member waits for approval (the hub's devices-approval/): it says who was asked, lends
// nothing meanwhile, and starts lending once allowed — or stops, as revoked, when refused.

const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let dir, client, ctrl, lending;
before(async () => {
  await H.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-client-approval-'));
  fs.mkdirSync(path.join(dir, 'home'));
  process.env.DOCA_CLIENT_DIR = path.join(dir, 'cfg');
  client = require('../clients/node/doca-client');
  ctrl = new AbortController();
});
after(async () => { ctrl.abort(); await lending?.stop(); await H.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

async function pairAs(who, name) {
  const start = await H.api(null, 'POST', '/api/devices/pair', { name, preset: 'phone' }, { Cookie: who.cookie, 'X-Doca-Password': '' });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  return client.pair(H.base, start.body.code, { name });
}

test('it waits for approval, says who was asked, and lends once allowed', async () => {
  const mia = await H.signIn('member');
  const cfg = await pairAs(mia, 'mia-laptop');
  assert.equal(cfg.approval.state, 'pending');
  const said = [];
  const running = client.run({ grant: ['files'], bind: '127.0.0.1', port: 0, root: path.join(dir, 'home'), signal: ctrl.signal, log: m => said.push(m) });
  for (let i = 0; i < 50 && !said.length; i++) await H.sleep(50);
  assert.match(said[0], /waits for approval: Waiting for approval by member \(its person\), owner/);
  assert.equal(require('../modules/api-v1/devices').get(cfg.deviceId).grants, undefined, 'nothing granted or offered meanwhile');
  const ok = await H.api(null, 'POST', `/api/devices/${cfg.deviceId}/approve`, {}, { Cookie: mia.cookie, 'X-Doca-Password': '' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  lending = await running;
  assert.ok(said.some(m => /mia-laptop was allowed/.test(m)));
  assert.ok(said.some(m => /serves \d+ tool\(s\)/.test(m)), said.join('\n'));
  await lending.stop(); lending = null;
});

test('refused, it stops as revoked and remembers it', async () => {
  const mia = await H.signIn('member');
  const cfg = await pairAs(mia, 'stranger-laptop');
  const said = [];
  const running = client.run({ grant: ['files'], bind: '127.0.0.1', port: 0, log: m => said.push(m) });
  for (let i = 0; i < 50 && !said.length; i++) await H.sleep(50);
  assert.equal((await H.api(null, 'POST', `/api/devices/${cfg.deviceId}/refuse`, {})).status, 200);
  await assert.rejects(running, e => e.code === 'revoked');
  assert.ok(client.load().revokedAt);
});

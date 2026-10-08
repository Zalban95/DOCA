'use strict';

// A machine paired with a role that lacks mcp:self (the pairing card used to preselect "watch") has its offer refused.
// doca-client said "accept its offer in the hub" anyway, and a person waited on an MCP tab that stayed empty
// (self-test round two, B1). It now says what the token lacks and how to give it.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./helpers');

let dir, client, lending;
before(async () => {
  await H.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-client-refused-'));
  fs.mkdirSync(path.join(dir, 'home'));
  process.env.DOCA_CLIENT_DIR = path.join(dir, 'cfg');
  client = require('../clients/node/doca-client');
});
after(async () => { await lending?.stop(); await H.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('paired as a watch, its refused offer is said in words: the scope it lacks and how to give it', async () => {
  const start = await H.api(null, 'POST', '/api/devices/pair', { name: 'desk', preset: 'watch' });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const cfg = await client.pair(H.base, start.body.code, { name: 'desk' });
  const said = [];
  lending = await client.run({ grant: ['files'], bind: '127.0.0.1', port: 0, root: path.join(dir, 'home'), log: m => said.push(m) });
  const line = said.join('\n');
  assert.doesNotMatch(line, /accept its offer/, 'it does not send its person to wait for an offer that was refused');
  assert.match(line, /refused its offer: this machine's token lacks mcp:self/);
  assert.match(line, /Role "phone"/);
  assert.ok(line.includes(`grant ${cfg.deviceId} --preset phone`), 'it names the command that gives it, with its own id');
  const offers = (await H.api(null, 'GET', '/api/mcp')).body.offers || [];
  assert.ok(!offers.some(o => o.deviceId === cfg.deviceId), 'and indeed nothing waits in the MCP tab');
});

test('any other refusal is said with its status and the hub\'s words', () => {
  const line = client.refusal({ deviceId: 'dev_x' }, 'its offer', { status: 409, body: { error: { code: 'exists', message: 'An offer already waits' } } });
  assert.match(line, /refused its offer \(409\): An offer already waits/);
});

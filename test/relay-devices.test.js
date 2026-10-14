'use strict';

/**
 * The model relay for paired devices (relay/device.js, relay/v1.js; the owner's yes of 2026-10-14): a device with
 * `relay:use` and its own switch on asks the hub's models at /api/v1/relay with its own token; switching on a device
 * that can send text asks for the password, an extension of a phone or an output-only device does not; every request
 * is tagged `relay:device:<id>` in the usage ledger and Chronicle.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const http   = require('node:http');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

const SECRET = 'sk-relay-device-provider-key-0123456789';
let stub;

test.before(async () => {
  await H.start();
  stub = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      // `greedy` bills far more than the request and its answer can be: what the leak check is for.
      const usage = body.model === 'greedy' ? { prompt_tokens: 90000, completion_tokens: 7, total_tokens: 90007 } : { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 };
      if (!body.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: 'x', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Hello there' }, finish_reason: 'stop' }], usage }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hello there' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ models: { providers: {
    stub: { baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: SECRET },
  } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'stub', model: 'm1' });
  require('../modules/computers/strays').docker = async () => '';
  const r = await H.api(null, 'POST', '/api/computers/relay', { enabled: true, computers: false, devices: true, models: ['stub/m1', 'stub/greedy'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
test.after(async () => {
  await require('../modules/relay').close();
  stub.closeAllConnections();
  await new Promise(r => stub.close(r));
  await H.stop();
});

const devices = () => require('../modules/api-v1/devices');
const NO_PASSWORD = { 'X-Doca-Password': '' };
const ask = (token, path, body) => fetch(`${H.base}/api/v1/relay${path}`, {
  method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const hi = { messages: [{ role: 'user', content: 'hi' }] };
const relayRows = async via => {
  const db = require('../modules/db');
  for (let i = 0; i < 40; i++) {
    const rows = await db.all("SELECT * FROM usage WHERE kind = 'relay' AND agent = ?", [via]);
    if (rows.length) return rows;
    await H.sleep(25);
  }
  return [];
};

test('switching a device on: an extension of the phone and an output-only device without the password, one that types with it', async () => {
  const phone = H.mkDevice('Relay phone', 'phone', H.PHONE_CAPS);
  const watch = H.mkDevice('Relay watch', 'watch', H.WATCH_CAPS);
  devices().update(watch.device.id, { pairedBy: phone.device.id });
  const glasses = H.mkDevice('Relay glasses', 'viewer', { formFactor: 'glasses', screen: { w: 640, h: 400 } });
  const lone = H.mkDevice('Lone watch', 'watch', H.WATCH_CAPS);   // voice in, and no phone it extends

  const dj = require('../modules/relay/device');
  assert.equal(dj.judge(devices().get(watch.device.id)).asks, false, 'paired through the phone');
  assert.match(dj.judge(devices().get(watch.device.id)).why, /Relay phone/);
  assert.equal(dj.judge(devices().get(glasses.device.id)).asks, false, 'takes no text');
  assert.equal(dj.judge(devices().get(lone.device.id)).asks, true, 'voice is text');
  assert.equal(dj.judge(devices().get(phone.device.id)).asks, true);

  let r = await H.api(null, 'POST', `/api/computers/relay/devices/${watch.device.id}`, { on: true }, NO_PASSWORD);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await H.api(null, 'POST', `/api/computers/relay/devices/${glasses.device.id}`, { on: true }, NO_PASSWORD);
  assert.equal(r.status, 200);
  assert.ok(devices().get(glasses.device.id).scopes.includes('relay:use'), 'its switch grants the scope its token lacked');
  r = await H.api(null, 'POST', `/api/computers/relay/devices/${phone.device.id}`, { on: true }, NO_PASSWORD);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'password_required');
  assert.equal(devices().get(phone.device.id).relayOn, undefined, 'nothing switched');
  r = await H.api(null, 'POST', `/api/computers/relay/devices/${phone.device.id}`, { on: true });
  assert.equal(r.status, 200, 'with the password typed');
  r = await H.api(null, 'POST', `/api/computers/relay/devices/${phone.device.id}`, { on: false }, NO_PASSWORD);
  assert.equal(r.status, 200, 'switching off never asks');

  const lines = require('../modules/activity').list({ limit: 50 }).filter(l => l.via === `relay:device:${watch.device.id}`);
  assert.ok(lines.some(l => l.act === 'relay-on' && /extension of the phone/.test(l.why)), 'kept in the log, tagged with the device');
  r = await H.api(null, 'GET', '/api/computers/relay');
  const row = r.body.deviceList.find(d => d.id === lone.device.id);
  assert.equal(row.asks, true);
  assert.equal(row.on, false);
  assert.ok(!JSON.stringify(r.body).includes('doca_'), 'never a token');
  const m = await H.signIn('member', 'relay-dev-member@test.local');
  r = await H.api(null, 'POST', `/api/computers/relay/devices/${watch.device.id}`, { on: false }, { Cookie: m.cookie });
  assert.equal(r.status, 403, 'the owner\'s card: a host\'s');
});

test('a device asks with its own token over the panel\'s HTTPS; refused without its switch, the scope or the relay for devices', async () => {
  const m = await H.signIn('member', 'relay-dev-use@test.local');
  const dev = H.mkDevice('Relay watch 2', 'watch', { formFactor: 'glasses' });
  devices().update(dev.device.id, { userId: m.user.id, orgId: m.orgId });
  let r = await ask(dev.token, '/chat/completions', hi);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, 'scope_required', 'a watch\'s token holds no relay:use until its switch gives it');
  await H.api(null, 'POST', `/api/computers/relay/devices/${dev.device.id}`, { on: true });
  r = await ask(dev.token, '/models');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data.map(x => x.id), ['m1', 'greedy']);
  r = await ask(dev.token, '/chat/completions', hi);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.choices[0].message.content, 'Hello there');
  assert.ok(!JSON.stringify(j).includes(SECRET));
  r = await ask(dev.token, '/chat/completions', { ...hi, stream: true });
  assert.match(await r.text(), /Hello there[\s\S]*\[DONE\]/);

  const via = `relay:device:${dev.device.id}`;
  const rows = await relayRows(via);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(x => x.person_id === m.user.id && x.session_id === null), 'counted for the device\'s person');

  // Chronicle: the owner sees it with the device's name; the member their own; another person nothing.
  r = await H.api(null, 'GET', '/api/chronicle?source=relay');
  assert.equal(r.status, 200);
  assert.ok(r.body.rows.some(x => x.via === via && /Relay watch 2/.test(x.text) && !/hi/.test(x.text.split('·').pop())), JSON.stringify(r.body.rows));
  r = await H.api(null, 'GET', '/api/chronicle?source=relay', undefined, { Cookie: m.cookie, 'X-Doca-Password': '' });
  assert.ok(r.body.rows.length && r.body.rows.every(x => x.person?.id === m.user.id));
  const other = await H.signIn('member', 'relay-dev-other@test.local');
  r = await H.api(null, 'GET', '/api/chronicle?source=relay', undefined, { Cookie: other.cookie, 'X-Doca-Password': '' });
  assert.equal(r.body.rows.length, 0);

  await H.api(null, 'POST', `/api/computers/relay/devices/${dev.device.id}`, { on: false });
  r = await ask(dev.token, '/chat/completions', hi);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, 'relay_off');
  await H.api(null, 'POST', `/api/computers/relay/devices/${dev.device.id}`, { on: true });
  await H.api(null, 'POST', '/api/computers/relay', { devices: false });
  try {
    r = await ask(dev.token, '/models');
    assert.equal(r.status, 403);
    assert.match((await r.json()).error.message, /off for paired devices/);
  } finally { await H.api(null, 'POST', '/api/computers/relay', { devices: true }); }
});

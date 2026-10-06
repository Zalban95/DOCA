'use strict';

/** Keys for services (modules/service-keys.js): pasted once, added by the hub to the service's own address only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const keys = require('../modules/service-keys');
const tools = require('../modules/harness/tools');

let stub, origin;
test.before(async () => {
  await H.start();
  stub = http.createServer((req, res) => res.end(JSON.stringify({ auth: req.headers.authorization || null, xkey: req.headers['x-api-key'] || null, url: req.url })));
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${stub.address().port}`;
});
test.after(async () => { stub.close(); await H.stop(); });

const fetchTool = (args, ctx = {}) => tools.call('http_fetch', args, [], ctx);

test('the admin pastes a key; the agent names it; the hub adds it to that address only and never shows it', async () => {
  let r = await H.api(null, 'POST', '/api/connectors/keys/all', { name: 'hyper3d', origin, key: 'sk-SECRET-123', note: '3D models from text' });
  assert.equal(r.status, 200);
  assert.equal(r.body.key.hasKey, true);
  assert.equal(JSON.stringify(r.body).includes('sk-SECRET'), false, 'never a key back');
  assert.equal(JSON.stringify((await H.api(null, 'GET', '/api/connectors/keys/all')).body).includes('sk-SECRET'), false);
  // In the readings since 2.250.0 (turn/fits.js), not the tool's description.
  assert.match(require('../modules/harness/turn/fits').inventory(new Set(['http_fetch'])), /hyper3d → http:\/\/127\.0\.0\.1:\d+ \(3D models from text\)/, 'the agent knows its name and address');

  const out = await fetchTool({ url: `${origin}/v1/generate`, key: 'hyper3d' });
  assert.match(out, /"auth":"Bearer \[key\]"/, 'sent as Bearer, and the echo is scrubbed');
  assert.equal(out.includes('sk-SECRET'), false);
  assert.match(await fetchTool({ url: 'http://127.0.0.2:9/x', key: 'hyper3d' }), /sent only to http:\/\/127\.0\.0\.1/, 'another address gets nothing');
  assert.match(await fetchTool({ url: `${origin}/x`, key: 'nope' }), /No key named "nope"\. Keys for services: hyper3d/);
  assert.match(await fetchTool({ url: `${origin}/x`, key: 'hyper3d' }, { user: { id: 'u1', role: 'member' } }), /only on an admin's turns/);

  await H.api(null, 'POST', '/api/connectors/keys/all', { name: 'other', origin, key: 'k-777', place: 'header', field: 'X-Api-Key', prefix: '' });
  assert.match(await fetchTool({ url: `${origin}/y`, key: 'other' }), /"xkey":"\[key\]"/, 'any header, without a prefix');
  await H.api(null, 'POST', '/api/connectors/keys/all', { name: 'q', origin, key: 'qq-999', place: 'query', field: 'api_key', who: 'everyone' });
  assert.match(await fetchTool({ url: `${origin}/z?a=1`, key: 'q' }, { user: { id: 'u1', role: 'member' } }), /api_key=\[key\]/, 'in the address, and opened to everyone');

  const file = require('../modules/paths').SERVICE_KEYS_FILE;
  assert.ok(require('../modules/paths').PROTECTED_FILES.includes(file));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal((await H.api(null, 'POST', '/api/connectors/keys/all', { name: 'Bad Name', origin, key: 'x' })).status, 400);
  assert.equal((await H.api(null, 'DELETE', '/api/connectors/keys/other')).status, 200);
  const member = await H.signIn('member', 'sk-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/connectors/keys/all', undefined, { Cookie: member.cookie })).status, 403);
});

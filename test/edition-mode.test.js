'use strict';

/**
 * Development or production (modules/edition-mode.js; docs/design/production.md): decided by the licence (the lab, or
 * `all`) and the hosted profile, never a setting. A production hive's code is out of reach of every file tool and
 * route, its admin included, the lab is not there, the routes that change DOCA itself are absent, and the licence's
 * seats and devices are held; a development hive is as it always was. Projects and the workspace work in both.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder, and trusts the test key
const T = require('./licence-trust');
const fs = require('fs');
const path = require('path');
const http = require('http');

const mode = () => require('../modules/edition-mode');
const lic = () => require('../modules/license');
const keys = () => require('../modules/license/keys');
const tools = () => require('../modules/harness/tools');
const APP = path.resolve(__dirname, '..');
const SERVER = path.join(APP, 'server.js');

function licence(opts) { keys().preloaded.certificate = opts ? T.sign(opts) : null; lic().reload(); }
const development = () => { keys().preloaded.certificate = T.preloadedFull; lic().reload(); };

test.before(() => H.start());
test.after(async () => { development(); await H.stop(); });

test('each combination: lab or all and not hosted is development; anything else is production', () => {
  const hosted = require('../modules/hosted');
  const was = hosted.on;
  try {
    for (const [codes, isHosted, want] of [[['all'], false, 'development'], [['lab'], false, 'development'], [['voice', 'lab'], false, 'development'],
      [['voice'], false, 'production'], [[], false, 'production'], [['all'], true, 'production'], [['lab'], true, 'production'], [['voice'], true, 'production']]) {
      hosted.on = () => isHosted;
      licence({ codes });
      assert.equal(mode().mode(), want, `${codes.join('+') || 'core'}${isHosted ? ', hosted' : ''}`);
      assert.match(mode().state().why, /.{10,}/);
    }
    hosted.on = () => false;
    licence(null);
    assert.equal(mode().mode(), 'production', 'no licence at all');
  } finally { hosted.on = was; development(); }
  assert.equal(mode().mode(), 'development');
});

test('the lab is a development hive\'s alone, whatever the licence says', () => {
  const hosted = require('../modules/hosted'), was = hosted.on;
  try {
    hosted.on = () => true; licence({ codes: ['all'] });
    assert.equal(lic().has('lab'), false); assert.equal(lic().featureOn('developer'), false); assert.equal(lic().has('voice'), true);
    assert.ok(require('../modules/license/gate').off().features.includes('evals'));
  } finally { hosted.on = was; development(); }
  assert.equal(lic().has('lab'), true);
});

test('the agent is told which, in one stable line; production never names the code', () => {
  const env = () => require('../modules/harness/environment').block({ provider: 'p', model: 'm' });
  assert.match(env(), /hive: development/); assert.match(env(), /panel code: /);
  licence({ codes: ['voice'] });
  try {
    assert.match(env(), /hive: production — DOCA itself/);
    assert.doesNotMatch(env(), /panel code: /); assert.doesNotMatch(env(), /releasing DOCA/);
    assert.ok(!env().includes(APP), 'the code\'s folder is not named');
  } finally { development(); }
});

test('production: no file tool reads, writes, searches or runs in the code; the workspace and data work', async () => {
  fs.writeFileSync(path.join(H.tmp, 'mine.txt'), 'my own file');
  licence({ codes: ['voice'] });
  try {
    assert.match(await tools().call('read_file', { path: SERVER }), /DOCA's own code/);
    assert.match(await tools().call('write_file', { path: path.join(APP, 'x.txt'), content: 'x' }), /DOCA's own code/);
    assert.match(await tools().call('list_dir', { path: path.join(APP, 'modules') }), /DOCA's own code/);
    assert.match(await tools().call('search_files', { query: 'createApp', path: APP }), /DOCA's own code/);
    assert.match(await tools().call('shell', { command: `cat ${SERVER}` }), /DOCA's own code/);
    assert.match(await tools().call('canvas', { action: 'open', path: SERVER, title: 'x' }), /^Error:/);
    assert.match(await tools().call('read_file', { path: 'mine.txt' }), /my own file/, 'the workspace reads');
    assert.equal(mode().inCode(path.join(require('../modules/store').DATA_DIR, 'x.json')), false, 'the data is not code');
    const q = encodeURIComponent;
    assert.equal((await H.api(null, 'GET', `/api/files/read?path=${q(SERVER)}`)).status, 403);
    assert.equal((await H.api(null, 'POST', '/api/projects', { root: APP })).status, 403);
    assert.equal((await H.api(null, 'GET', `/api/files/read?path=${q(path.join(H.tmp, 'mine.txt'))}`)).status, 200);
  } finally { development(); }
  assert.match(await tools().call('read_file', { path: SERVER, maxLength: 200 }), /use strict|require/, 'development reads its code');
});

test('production: what changes DOCA itself is absent — git updates, packages, promoting into the repository, the lab', async () => {
  licence({ codes: ['voice'] });
  const server = http.createServer(require('../server').createApp());   // an app built under this licence, as a restart would
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const call = (m, p) => fetch(`http://127.0.0.1:${server.address().port}${p}`, { method: m, headers: { Cookie: H.owner.cookie, 'X-Doca-Password': H.owner.password, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  try {
    for (const [m, p] of [['POST', '/api/update'], ['GET', '/api/deps'], ['POST', '/api/harness/agents/coder/promote'], ['GET', '/api/developer/releasing'], ['GET', '/api/evals']])
      assert.equal((await call(m, p)).status, 404, `${m} ${p}`);
    assert.equal((await call('GET', '/api/licence')).body.mode, 'production');
    assert.equal((await call('GET', '/api/update/channel')).status, 200, 'the update channel is there');
    assert.equal((await call('GET', '/api/versions')).body.production, true, 'versions: the signed ones only');
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); development(); }
  assert.notEqual((await H.api(null, 'GET', '/api/deps')).status, 404, 'development keeps them');
});

test('seats: a production licence\'s, held when a person is added or restored; never in development', async () => {
  licence({ codes: ['voice'], seats: 2 });
  try {
    const a = await H.api(null, 'POST', '/api/auth/users', { email: 'seat-a@doca.local', name: 'A', level: 'member' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await H.api(null, 'POST', '/api/auth/users', { email: 'seat-b@doca.local', name: 'B', level: 'member' });
    assert.equal(b.status, 409); assert.match(b.body.error, /2 seats.*Suspend someone|licence with more seats/);
    assert.equal((await H.api(null, 'PATCH', `/api/auth/users/${a.body.user.id}`, { suspended: true })).status, 200);
    assert.equal((await H.api(null, 'POST', '/api/auth/users', { email: 'seat-b@doca.local', name: 'B', level: 'member' })).status, 200, 'a suspended person frees a seat');
    const back = await H.api(null, 'PATCH', `/api/auth/users/${a.body.user.id}`, { suspended: false });
    assert.equal(back.status, 409, 'restoring would take a seat back');
    assert.deepEqual(require('../modules/license/limits').status().seats, { used: 2, max: 2 });
  } finally { development(); }
  assert.equal((await H.api(null, 'POST', '/api/auth/users', { email: 'seat-c@doca.local', name: 'C', level: 'member' })).status, 200, 'development holds none');
});

test('devices: a production licence\'s, a pending one counting; a browser\'s record never refused', async () => {
  const devices = require('../modules/api-v1/devices');
  const used = devices.list().filter(d => !d.revokedAt && d.kind !== 'browser').length;
  licence({ codes: ['devices'], maxDevices: used + 1 });
  try {
    const one = devices.create({ name: 'phone', scopes: [], caps: {}, kind: 'device', approval: { state: 'pending' } });
    assert.throws(() => devices.create({ name: 'watch', scopes: [], caps: {}, kind: 'device' }), e => e.code === 'licence_devices' && /waiting for approval counts/.test(e.message));
    assert.throws(() => devices.startPairing({ name: 'watch', scopes: [], kind: 'device' }), /allows/);
    const pair = await H.api(null, 'POST', '/api/devices/pair', { name: 'tablet', preset: 'phone' });
    assert.equal(pair.status, 409, JSON.stringify(pair.body));
    assert.doesNotThrow(() => devices.create({ name: 'a browser', scopes: [], caps: {}, kind: 'browser' }));
    devices.revoke(one.device.id);
    assert.doesNotThrow(() => devices.forget(devices.create({ name: 'watch', scopes: [], caps: {}, kind: 'device' }).device.id), 'a revoked one frees its place');
  } finally { development(); }
});

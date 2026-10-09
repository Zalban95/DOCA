'use strict';

/**
 * Checking in with the licence server (modules/license/checkin.js) against a stub of Keygen's API: the key is
 * validated, this machine is activated the first time, a machine file is checked out and kept only when it verifies
 * here; a revoked licence turns licensed features read-only at once; a server that cannot be reached is said.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: temporary settings, and the test vendor key
const T = require('./licence-trust');
const http = require('http');

const lic = () => require('../modules/license');
const files = () => require('../modules/license/files');
const keys = () => require('../modules/license/keys');

/** Keygen, as much of it as a check-in uses. */
function stubKeygen({ signWith = 'vendor' } = {}) {
  const machines = new Set();
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      const json = body ? JSON.parse(body) : {};
      const send = (status, doc) => { res.writeHead(status, { 'Content-Type': 'application/vnd.api+json' }); res.end(JSON.stringify(doc)); };
      const key = (req.headers.authorization || '').replace(/^License /, '');
      if (req.url === '/v1/accounts/acc/licenses/actions/validate-key') {
        const k = json.meta.key, fp = json.meta.scope?.fingerprint;
        if (k === 'REVOKED') return send(404, { meta: { valid: false, code: 'NOT_FOUND', detail: 'does not exist' }, data: null });
        if (k !== 'GOOD') return send(404, { meta: { valid: false, code: 'NOT_FOUND', detail: 'does not exist' }, data: null });
        return send(200, { meta: machines.has(fp) ? { valid: true, code: 'VALID', detail: 'is valid' } : { valid: false, code: 'NO_MACHINE', detail: 'no machine' }, data: { id: 'lic-1', type: 'licenses' } });
      }
      if (req.method === 'POST' && req.url === '/v1/accounts/acc/machines') {
        if (key !== 'GOOD') return send(401, { errors: [{ detail: 'bad key' }] });
        machines.add(json.data.attributes.fingerprint);
        return send(201, { data: { id: 'm-1', type: 'machines' } });
      }
      const m = /^\/v1\/accounts\/acc\/machines\/([0-9a-f]+)\/actions\/check-out\?/.exec(req.url);
      if (m && key === 'GOOD' && machines.has(m[1])) {
        return send(200, { data: { type: 'machine-files', attributes: { certificate: T.sign({ codes: ['voice', 'home'], machine: m[1], checkInDays: 30 }, { key: 'GOOD', fingerprint: m[1], with: signWith }) } } });
      }
      send(404, { errors: [{ detail: 'not found' }] });
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise(c => { server.closeAllConnections(); server.close(c); }) })));
}

function settings(server) {
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), licence: server ? { server, account: 'acc' } : {} });
}

test.before(() => H.start());
test.after(() => H.stop());
test.afterEach(() => { for (const f of ['LICENCE', 'STATE', 'CONFIG']) files().remove(files()[f]); settings(null); lic().reload(); });

test('a check-in activates this machine, checks out its machine file and keeps it — for the next start', async () => {
  const kg = await stubKeygen();
  try {
    settings(kg.base);
    lic().status();   // the hub has started
    assert.equal((await require('../modules/license/checkin').checkIn()).code, 'no_key', 'no key, no check-in');
    files().writeJson(files().CONFIG, { key: 'GOOD' });
    const r = await require('../modules/license/checkin').checkIn();
    assert.equal(r.ok, true, r.detail);
    assert.deepEqual(kg.seen.map(s => s.split('?')[0]), ['POST /v1/accounts/acc/licenses/actions/validate-key', 'POST /v1/accounts/acc/machines',
      'POST /v1/accounts/acc/licenses/actions/validate-key', `POST /v1/accounts/acc/machines/${require('../modules/license/fingerprint').fingerprint().value}/actions/check-out`]);
    assert.match(files().readText(files().LICENCE), /BEGIN MACHINE FILE/);
    const s = lic().status();
    assert.equal(s.restartNeeded, true, 'what a check-in brings takes effect at the next start');
    assert.deepEqual(s.onDisk.codes, ['home', 'voice']);
    assert.ok(s.lastCheckIn && !s.lastError);
    lic().reload();
    assert.equal(lic().status().source, 'file'); assert.ok(lic().has('home') && !lic().has('machines'));
    assert.equal(lic().status().checkInDays, 30);
    // Through the panel, the same.
    const viaPanel = await H.api(null, 'POST', '/api/licence/check', {});
    assert.equal(viaPanel.status, 200);
  } finally { await kg.close(); }
});

test('a file the server sends is kept only if it verifies here', async () => {
  const kg = await stubKeygen({ signWith: 'rotated' });
  try {
    settings(kg.base); files().writeJson(files().CONFIG, { key: 'GOOD' });
    const r = await require('../modules/license/checkin').checkIn();
    assert.equal(r.ok, false); assert.equal(r.code, 'signature');
    assert.equal(files().readText(files().LICENCE), null, 'nothing kept');
  } finally { await kg.close(); }
});

test('a revoked licence turns licensed features read-only at once; an unreachable server is said, not fatal', async () => {
  const kg = await stubKeygen();
  const was = keys().preloaded.certificate;
  try {
    keys().preloaded.certificate = null;
    files().write(files().LICENCE, T.sign({ codes: ['all'], machine: require('../modules/license/fingerprint').fingerprint().value }));
    lic().reload();
    assert.equal(lic().readOnly(), null);
    settings(kg.base); files().writeJson(files().CONFIG, { key: 'REVOKED' });
    const r = await require('../modules/license/checkin').checkIn();
    assert.equal(r.ok, false); assert.equal(r.code, 'NOT_FOUND');
    assert.match(lic().readOnly(), /this licence is revoked; licensed features are read-only/);
    await kg.close();
    const down = await require('../modules/license/checkin').checkIn();
    assert.equal(down.code, 'unreachable');
    assert.match(lic().status().lastError, /could not be reached/);
  } finally { keys().preloaded.certificate = was; }
});

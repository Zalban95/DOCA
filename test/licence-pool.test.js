'use strict';

/**
 * Licences for test installs in agents' computers (modules/license/pool.js, modules/computers/licence.js) against a
 * stub of Keygen's API and a stand-in for docker: a seat is activated for the inner hive's fingerprint and its machine
 * file copied into the computer; at most `seats` are held, and the refusal names who holds them; removing or archiving
 * a computer frees its seat; an unreachable server and a missing pool are said; the key never comes back in an answer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: temporary settings, and the test vendor key
const T = require('./licence-trust');
const http = require('http');
const fs = require('fs');
const path = require('path');

const KEY = 'POOL-KEY-0123456789-never-shown';
const pool = () => require('../modules/license/pool');
const computers = () => require('../modules/computers');

/** Keygen, as much of it as a seat uses. Its machine file carries the licence, key included, as Keygen's does. */
function stubKeygen() {
  const machines = new Set();
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url.split('?')[0]}`);
      const json = body ? JSON.parse(body) : {};
      const send = (status, doc) => { res.writeHead(status, { 'Content-Type': 'application/vnd.api+json' }); res.end(doc ? JSON.stringify(doc) : ''); };
      const key = (req.headers.authorization || '').replace(/^License /, '');
      if (req.url === '/v1/accounts/acc/licenses/actions/validate-key') {
        if (json.meta.key !== KEY) return send(404, { meta: { valid: false, code: 'NOT_FOUND', detail: 'does not exist' }, data: null });
        const fp = json.meta.scope?.fingerprint;
        return send(200, { meta: machines.has(fp) ? { valid: true, code: 'VALID' } : { valid: false, code: 'NO_MACHINE', detail: 'no machine' }, data: { id: 'lic-pool', type: 'licenses' } });
      }
      if (key !== KEY) return send(401, { errors: [{ detail: 'bad key' }] });
      if (req.method === 'POST' && req.url === '/v1/accounts/acc/machines') { machines.add(json.data.attributes.fingerprint); return send(201, { data: { id: 'm', type: 'machines' } }); }
      const out = /^\/v1\/accounts\/acc\/machines\/([0-9a-f]{64})\/actions\/check-out\?/.exec(req.url);
      if (out && machines.has(out[1])) {
        const p = T.payload({ codes: ['machines', 'agents'], machine: out[1], edition: 'demo', fileExpiry: new Date(Date.now() + 30 * 86400000).toISOString() });
        p.included[0].attributes.key = KEY;   // Keygen's own: the licence, key and all, inside every machine file
        return send(200, { data: { type: 'machine-files', attributes: { certificate: require('../modules/license/certificate').sign(p, T.vendor, { kind: 'machine' }) } } });
      }
      const del = /^\/v1\/accounts\/acc\/machines\/([0-9a-f]{64})$/.exec(req.url);
      if (req.method === 'DELETE' && del) { if (!machines.delete(del[1])) return send(404, { errors: [{ detail: 'not found' }] }); return send(204); }
      send(404, { errors: [{ detail: 'not found' }] });
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${server.address().port}`, seen, machines,
    close: () => new Promise(c => { server.closeAllConnections(); server.close(c); }) })));
}

/** Docker as the computers module calls it: each container a folder; `exec sh` answers the fingerprint script. */
const inside = new Map();   // container → {files: {path: text}, machineId}
function fakeDocker() {
  const was = computers().docker;
  computers().docker = async args => {
    const [verb] = args;
    const box = name => { if (!inside.has(name)) inside.set(name, { files: {}, machineId: `m-${name}` }); return inside.get(name); };
    if (verb === 'exec') {
      const rest = args.slice(1).filter((a, i, l) => !(a === '-u' || l[i - 1] === '-u'));
      const b = box(rest[0]);
      if (rest[1] === 'sh' && /HIVE=/.test(rest[3])) {
        const dir = rest[5], f = `${dir}/keys/hive-id`;
        let made = '';
        if (!b.files[f]) { b.files[f] = `${rest[6]}\n`; made = 'MADE=1\n'; }
        return `${made}HIVE=${b.files[f].trim()}\nMACHINE=${b.machineId}\nHOST=box`;
      }
      return '';
    }
    if (verb === 'cp') { const [name, to] = args[2].split(/:(.*)/s); box(name).files[to] = fs.readFileSync(args[1], 'utf8'); return ''; }
    return '';   // rm, volume rm, stop
  };
  return () => { computers().docker = was; };
}

const fp = name => require('../modules/license/fingerprint').of(inside.get(`doca-computer-${name}`).files['/home/agent/doca/.doca/keys/hive-id'].trim(), `m-doca-computer-${name}`);
const run = (a, ctx = {}) => require('../modules/harness/toolbox/computers').find(t => t.name === 'computer').run(a, ctx);

let kg, undock;
test.before(async () => {
  await H.start();
  kg = await stubKeygen();
  undock = fakeDocker();
  computers().save(['aaaa1111', 'bbbb2222', 'cccc3333'].map((id, i) => ({ id, name: ['alpha', 'beta', 'gamma'][i], token: 't', mcpPort: 1, vncPort: 2 })));
});
test.after(async () => { undock(); await kg.close(); await H.stop(); });

test('no licence for test computers: the agent is told who adds one', async () => {
  const said = await run({ action: 'licence', id: 'aaaa1111' });
  assert.match(said, /^Error: No licence for test computers is set: an admin adds one in Settings → System → Licence/);
});

test('the owner keeps the key; it never comes back, by any route', async () => {
  const bad = await H.api(null, 'POST', '/api/licence/computers', { key: KEY, server: 'not an address', seats: 2 });
  assert.equal(bad.status, 400);
  const r = await H.api(null, 'POST', '/api/licence/computers', { key: KEY, server: kg.base, account: 'acc', seats: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.pool.set, r.body.pool.seats, r.body.pool.inUse.length], [true, 2, 0]);
  for (const [m, p] of [['GET', '/api/licence/computers'], ['GET', '/api/licence']]) assert.ok(!JSON.stringify((await H.api(null, m, p)).body).includes(KEY), `${p} carries no key`);
  assert.ok(!JSON.stringify(r.body).includes(KEY));
  const member = await H.signIn('member', 'pool-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/licence/computers', undefined, { Cookie: member.cookie })).status, 403, 'a host\'s alone');
});

test('a seat: the hub activates the inner hive\'s machine and puts its file in the computer — and the key nowhere else', async () => {
  const said = await run({ action: 'licence', id: 'aaaa1111' });
  assert.match(said, /^A test licence is in \/home\/agent\/doca\/\.doca\/keys\/licence\.lic \(demo: agents, machines; the file is good until/);
  assert.match(said, /its id was made now/);
  assert.match(said, /Seat 1 of 2/);
  assert.ok(!said.includes(KEY), 'the tool\'s answer carries no key');
  assert.ok(kg.machines.has(fp('aaaa1111')), 'activated for the fingerprint read in the computer');
  const box = inside.get('doca-computer-aaaa1111').files;
  const file = box['/home/agent/doca/.doca/keys/licence.lic'];
  assert.match(file, /BEGIN MACHINE FILE/);
  // The inner hive reads it as its own, with no key of its own (a plain machine file bound to its fingerprint).
  const { terms, judge } = require('../modules/license/terms');
  const t = terms(require('../modules/license/certificate').read(file, require('../modules/license/keys').VENDOR_KEYS, { fingerprint: fp('aaaa1111') }).payload);
  assert.equal(judge(t, { fingerprint: fp('aaaa1111') }).valid, true);
  assert.equal(Object.keys(box).filter(f => /licence\.json$/.test(f)).length, 0, 'no key file is written into the computer');
  // The trade-off pool.js states: Keygen's file holds the licence, key included — inside the signed file only.
  assert.ok(Object.entries(box).every(([f, text]) => f.endsWith('licence.lic') || !text.includes(KEY)));
  // Again for the same computer: the same seat, renewed.
  await run({ action: 'licence', id: 'aaaa1111' });
  assert.equal(pool().view().inUse.length, 1);
});

test('at most the seats: the refusal names the computers holding them; removing one frees its seat', async () => {
  assert.match(await run({ action: 'licence', id: 'bbbb2222' }), /Seat 2 of 2/);
  const full = await run({ action: 'licence', id: 'cccc3333' });
  assert.match(full, /^Error: All 2 seats of the licence for test computers are in use: "alpha" \(aaaa1111\), "beta" \(bbbb2222\)\. Remove or archive one/);
  const panel = await H.api(null, 'GET', '/api/licence/computers');
  assert.deepEqual(panel.body.inUse.map(h => h.name), ['alpha', 'beta']);
  const betaFp = fp('bbbb2222');
  await computers().remove('bbbb2222');
  assert.ok(!kg.machines.has(betaFp), 'its machine was deactivated on the licence server');
  assert.ok(kg.seen.includes(`DELETE /v1/accounts/acc/machines/${betaFp}`));
  assert.match(await run({ action: 'licence', id: 'cccc3333' }), /Seat 2 of 2/, 'the freed seat is given again');
  // Archiving frees it too; the agent can give one back itself; the panel frees one with a click.
  await computers().archive('cccc3333');
  assert.deepEqual(pool().view().inUse.map(h => h.computer), ['aaaa1111']);
  assert.match(await run({ action: 'licence', id: 'aaaa1111', release: true }), /is free again/);
  assert.equal(pool().view().inUse.length, 0);
  assert.equal(kg.machines.size, 0);
});

test('a server that does not answer is said, and nothing is taken; removing the pool frees what it held', async () => {
  await run({ action: 'licence', id: 'aaaa1111' });
  assert.equal(pool().view().inUse.length, 1);
  const dead = http.createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r));
  const port = dead.address().port; await new Promise(r => dead.close(r));
  await H.api(null, 'POST', '/api/licence/computers', { server: `http://127.0.0.1:${port}`, account: 'acc', seats: 3 });
  computers().save([...computers().rows(), { id: 'dddd4444', name: 'delta', token: 't', mcpPort: 1, vncPort: 2 }]);
  assert.match(await run({ action: 'licence', id: 'dddd4444' }), /^Error: The licence server for test computers could not be reached .* Nothing was changed\./);
  assert.equal(pool().view().inUse.length, 1);
  await H.api(null, 'POST', '/api/licence/computers', { server: kg.base });
  const gone = await H.api(null, 'DELETE', '/api/licence/computers');
  assert.equal(gone.status, 200); assert.match(gone.body.said, /every seat it held was freed/);
  assert.equal(kg.machines.size, 0);
  assert.equal(pool().view().set, false);
  assert.ok(!fs.existsSync(path.join(require('../modules/license/files').dir(), pool().FILE)));
});

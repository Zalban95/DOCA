'use strict';

// Computer containers no record names (modules/computers/strays.js; self-test 2026-10-08, #25). Docker is stood in for:
// this machine's own containers are never listed, let alone removed, by a test.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let strays, store;
before(async () => { await H.start(); strays = require('../modules/computers/strays'); store = require('../modules/store'); });
after(() => H.stop());

const fmt = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000 UTC`; };

test('Docker\'s CreatedAt is read', () => {
  assert.equal(strays.createdAt('2026-10-07 16:34:24 +0200 CEST'), Date.parse('2026-10-07T14:34:24Z'));
  assert.ok(Number.isNaN(strays.createdAt('')));
});

test('the tidy-up removes what never started and this install\'s stopped strays — never a running one, a known one, or another install\'s', async () => {
  const now = Date.now(), old = fmt(now - 2 * 3600000), fresh = fmt(now - 60000), me = strays.installId();
  store.writeJson('computers', { computers: [{ id: 'kn0wn001', name: 'known' }] });
  const ps = [
    ['doca-computer-kn0wn001', 'exited', old, me],        // has a record
    ['doca-computer-n3v3r001', 'created', old, ''],       // never started, made before the label: goes, volume too
    ['doca-computer-n3v3r002', 'created', fresh, me],     // never started, but still being made, perhaps
    ['doca-computer-0urs0001', 'exited', old, me],        // ours, stopped, no record: goes, volume kept
    ['doca-computer-th31r001', 'exited', old, 'another'], // another install's: theirs
    ['doca-computer-run00001', 'running', old, ''],       // running: never
  ].map(r => r.join('\t')).join('\n');
  const calls = [];
  const docker = async args => { calls.push(args.join(' ')); return args[0] === 'ps' ? ps : ''; };
  const gone = await strays.sweep({ now, docker });
  assert.deepEqual(gone.sort(), ['doca-computer-0urs0001', 'doca-computer-n3v3r001']);
  assert.deepEqual(calls.filter(c => c !== calls[0]).sort(),
    ['rm -f doca-computer-0urs0001', 'rm -f doca-computer-n3v3r001', 'volume rm -f doca-computer-n3v3r001']);
  const lines = require('../modules/activity').list({ limit: 20 }).filter(l => l.from === 'computers');
  assert.ok(lines.some(l => /n3v3r001/.test(l.what) && /never started/.test(l.why)));
  assert.ok(lines.some(l => /0urs0001/.test(l.what) && /files are kept in the volume/.test(l.why)));
});

test('without docker it does nothing and says nothing', async () => {
  assert.deepEqual(await strays.sweep({ docker: async () => { throw new Error('docker: not found'); } }), []);
});

// "Not DOCA's records" in the Computers tab (the owner's answer of 2026-10-08): a person archives or deletes each.
const inspect = name => JSON.stringify([{ Created: '2026-10-06T10:00:00Z', Config: { Env: ['PATH=/usr/bin', 'TOKEN=t0k-x', 'VNC_PASSWORD=v', 'FILL_KEY=fk'] },
  HostConfig: { PortBindings: { '8765/tcp': [{ HostIp: '127.0.0.1', HostPort: '40001' }], '6080/tcp': [{ HostPort: '40002' }], '8080/tcp': [{ HostPort: '40003' }] } }, Name: `/${name}` }]);
function fakeDocker(rows) {
  const calls = [];
  const fn = async args => {
    calls.push(args.join(' '));
    if (args[0] === 'ps') return rows.map(r => r.join('\t')).join('\n');
    if (args[0] === 'inspect') return inspect(args[1]);
    return '';
  };
  return { fn, calls };
}

test('the tab lists containers no record names; Archive adopts one into the Archive, Delete removes it (its volume only when asked)', async () => {
  const fresh = fmt(Date.now() - 60000);
  store.writeJson('computers', { computers: [{ id: 'kn0wn001', name: 'known' }] });
  const d = fakeDocker([['doca-computer-kn0wn001', 'exited', fresh, ''], ['doca-computer-0ld00001', 'exited', fresh, '', 'Exited (0) 2 days ago'],
    ['doca-computer-0ld00002', 'created', fresh, 'another', 'Created'], ['doca-computer-0ld00003', 'exited', fresh, '', 'Exited (0) 1 day ago']]);
  const was = strays.docker;
  strays.docker = d.fn;
  try {
    const l = await H.api(null, 'GET', '/api/computers/strays');
    assert.equal(l.status, 200, JSON.stringify(l.body));
    assert.deepEqual(l.body.strays.map(s => [s.name, s.state, s.install]),
      [['doca-computer-0ld00001', 'exited', 'none'], ['doca-computer-0ld00002', 'created', 'another'], ['doca-computer-0ld00003', 'exited', 'none']]);
    assert.equal(l.body.policy, 'leave', 'leave them, by default');
    assert.equal(l.body.strays[0].status, 'Exited (0) 2 days ago');

    const a = await H.api(null, 'POST', '/api/computers/strays/doca-computer-0ld00001/archive');
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.ok(a.body.archivedAt, 'in the Archive');
    assert.ok(!JSON.stringify(a.body).includes('t0k-x'), 'the token is never shown');
    const rec = require('../modules/computers').get('0ld00001');
    assert.deepEqual([rec.token, rec.mcpPort, rec.vncPort, rec.servePort, rec.test], ['t0k-x', 40001, 40002, 40003, undefined], 'usable when lent again; never a test computer');

    assert.equal((await H.api(null, 'DELETE', '/api/computers/strays/doca-computer-0ld00002')).status, 200);
    assert.ok(d.calls.includes('rm -f doca-computer-0ld00002') && !d.calls.includes('volume rm -f doca-computer-0ld00002'), 'the volume is kept by default');
    assert.equal((await H.api(null, 'DELETE', '/api/computers/strays/doca-computer-0ld00003?volume=1')).status, 200);
    assert.ok(d.calls.includes('volume rm -f doca-computer-0ld00003'));
    assert.equal((await H.api(null, 'DELETE', '/api/computers/strays/doca-computer-kn0wn001')).status, 404, 'a computer with a record is not a stray');
    const member = await H.signIn('member');
    assert.equal((await H.api(null, 'GET', '/api/computers/strays', undefined, { Cookie: member.cookie })).status, 403, 'a host\'s');
  } finally { strays.docker = was; }
});

test('computers.strays: the owner sets it in the tab, the agent never proposes it, and the tidy-up follows it', async () => {
  assert.equal((await H.api(null, 'POST', '/api/computers/strays/policy', { strays: 'burn' })).status, 400);
  assert.equal((await H.api(null, 'POST', '/api/computers/strays/policy', { strays: 'archive' })).status, 200);
  assert.equal(require('../modules/settings-schema').value('computers.strays'), 'archive');
  const settings = require('../modules/harness/settings');
  assert.match(settings.refuse('computers.strays', 'delete'), /owner's alone/);
  assert.match(settings.refuse('computers', { maxRunning: 2, strays: 'delete' }), /owner's alone/, 'nor set whole');
  assert.equal(settings.refuse('computers.maxRunning', 2), null, 'the rest of the section still is');
  assert.ok(!settings.readable().some(r => r.path === 'computers.strays'));

  const old = fmt(Date.now() - 2 * 3600000);
  store.writeJson('computers', { computers: [] });
  const rows = [['doca-computer-n0lab001', 'exited', old, ''], ['doca-computer-run00002', 'running', old, ''], ['doca-computer-th31r002', 'exited', old, 'another']];
  let d = fakeDocker(rows);
  assert.deepEqual(await strays.sweep({ docker: d.fn, choice: 'archive' }), ['doca-computer-n0lab001']);
  assert.ok(require('../modules/computers').get('n0lab001')?.archivedAt, 'archived');
  assert.ok(!d.calls.some(c => /^rm|^stop/.test(c)), 'nothing removed or stopped');
  store.writeJson('computers', { computers: [] });
  d = fakeDocker(rows);
  assert.deepEqual(await strays.sweep({ docker: d.fn, choice: 'delete' }), ['doca-computer-n0lab001']);
  assert.deepEqual(d.calls.filter(c => /^rm|^volume/.test(c)), ['rm -f doca-computer-n0lab001'], 'its volume kept; running and another install\'s untouched');
  d = fakeDocker(rows);
  assert.deepEqual(await strays.sweep({ docker: d.fn, choice: 'leave' }), []);
  await H.api(null, 'POST', '/api/computers/strays/policy', { strays: 'leave' });
});

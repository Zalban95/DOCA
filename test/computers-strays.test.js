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

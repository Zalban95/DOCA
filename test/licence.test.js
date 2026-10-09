'use strict';

/**
 * The licence (modules/license; docs/design/licence.md): a Keygen licence file verified against the vendor keys —
 * signature, binding to this hive, expiry, a rotated key — and what it gates, structurally: an unlicensed feature's
 * routes are not there, its tools are not offered, its tables are not made, its pages and settings are left out, its
 * experiment never turns on. A lapsed licence keeps its features for the grace, then they are read-only; an install
 * from before licensing keeps everything for 30 days with a banner.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder, and trusts the test key
const T = require('./licence-trust');
const http = require('http');

const lic = () => require('../modules/license');
const keys = () => require('../modules/license/keys');
const files = () => require('../modules/license/files');
const fp = () => require('../modules/license/fingerprint').fingerprint().value;
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

/** Run `fn` with this licence file in place (or none), as a restart would read it; the suite's licence comes back after. */
async function withLicence(certificate, fn, { preload = null } = {}) {
  const was = keys().preloaded.certificate;
  keys().preloaded.certificate = preload;
  if (certificate) files().write(files().LICENCE, certificate); else files().remove(files().LICENCE);
  lic().reload();
  try { return await fn(); } finally {
    files().remove(files().LICENCE); files().remove(files().STATE); files().remove(files().GRACE); files().remove(files().CONFIG);
    keys().preloaded.certificate = was;
    lic().reload();
  }
}

/** An app built under the licence in effect now, on a port of its own. */
async function appNow() {
  const server = http.createServer(require('../server').createApp());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body) => fetch(base + p, { method, headers: { Cookie: H.owner.cookie, 'X-Doca-Password': H.owner.password, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { call, close: () => { server.closeAllConnections(); return new Promise(r => server.close(r)); } };
}

test.before(() => H.start());
test.after(() => H.stop());

test('a licence verifies only with a vendor key, unchanged, for this hive, and a rotated key once it is trusted', async () => {
  const machine = fp();
  await withLicence(T.sign({ codes: ['voice'], machine }), () => {
    const s = lic().status();
    assert.equal(s.source, 'file'); assert.equal(s.valid, true);
    assert.deepEqual(s.codes, ['voice']);
    assert.ok(lic().has('voice') && lic().has('core') && !lic().has('machines'));
    assert.equal(lic().featureOn('face'), true); assert.equal(lic().featureOn('computers'), false); assert.equal(lic().featureOn('harness'), true);
  });
  // Changed after signing: one character of its payload.
  const good = T.sign({ codes: ['all'], machine });
  const body = good.split('\n').slice(1, -2).join('');
  const doc = JSON.parse(Buffer.from(body, 'base64').toString());
  doc.enc = Buffer.from(Buffer.from(doc.enc, 'base64').toString().replace('"all"', '"lab"')).toString('base64');
  const tampered = `-----BEGIN MACHINE FILE-----\n${Buffer.from(JSON.stringify(doc)).toString('base64')}\n-----END MACHINE FILE-----\n`;
  await withLicence(tampered, () => {
    const s = lic().status();
    assert.equal(s.source, 'none'); assert.equal(s.problem.code, 'signature'); assert.equal(lic().has('lab'), false);
  });
  await withLicence(T.sign({ codes: ['all'], machine: 'f'.repeat(64) }), () => assert.equal(lic().status().problem.code, 'wrong_machine'));
  await withLicence(T.sign({ codes: ['all'], anyMachine: false }), () => assert.equal(lic().status().problem.code, 'unbound', 'a licence for no machine needs to say so'));
  await withLicence(T.sign({ codes: ['all'], machine, issued: iso(Date.now() + 5 * DAY) }), () => assert.equal(lic().status().problem.code, 'clock'));
  await withLicence(T.sign({ codes: ['all'], machine, status: 'SUSPENDED' }), () => assert.equal(lic().status().problem.code, 'revoked'));
  // A new key: refused until a release trusts it; then accepted beside the old one.
  const rotated = T.sign({ codes: ['home'], machine }, { with: 'rotated' });
  await withLicence(rotated, () => assert.equal(lic().status().problem.code, 'signature'));
  keys().VENDOR_KEYS.push({ id: 'rotated', hex: T.rawHex(T.rotated) });
  try { await withLicence(rotated, () => { assert.equal(lic().status().valid, true); assert.ok(lic().has('home')); }); }
  finally { keys().VENDOR_KEYS.splice(keys().VENDOR_KEYS.findIndex(k => k.id === 'rotated'), 1); }
  // Encrypted with the licence key and this fingerprint, as a check-in's machine file is.
  const enc = T.sign({ codes: ['devices'], machine }, { key: 'KEY-1', fingerprint: machine });
  await withLicence(enc, () => assert.equal(lic().status().problem.code, 'needs_key'));
  await withLicence(enc, () => {
    files().writeJson(files().CONFIG, { key: 'KEY-1' }); lic().reload();
    assert.equal(lic().status().valid, true); assert.ok(lic().has('devices'));
    assert.equal(lic().status().hasKey, true); assert.ok(!JSON.stringify(lic().status()).includes('KEY-1'), 'the key never leaves');
  });
});

test('no licence: the core only — routes, tools, pages, settings and experiments of the rest are not there', async () => {
  await withLicence(null, async () => {
    assert.equal(lic().status().source, 'none');
    const app = await appNow();
    try {
      assert.equal((await app.call('GET', '/api/computers')).status, 404, 'a machines route is not there');
      assert.equal((await app.call('GET', '/api/computers')).body.code, 'not_found');
      assert.equal((await app.call('GET', '/api/channels/telegram')).status, 404);
      assert.equal((await app.call('GET', '/api/harness/sessions')).status, 200, 'the core is');
      const l = (await app.call('GET', '/api/licence')).body;
      assert.equal(l.source, 'none');
      assert.ok(l.off.pages.includes('computers') && l.off.pages.includes('home') && l.off.features.includes('channels'));
      assert.ok(!l.off.pages.includes('harness') && !l.off.pages.includes('settings'));
      const nav = (await app.call('GET', '/api/screen/layout')).body;
      const placed = nav.resolved.groups.flatMap(g => g.tabs);
      assert.ok(!placed.includes('computers') && !placed.includes('home') && placed.includes('harness'), 'the layout never places an unlicensed page');
      assert.ok(!nav.resolved.groups.some(g => g.id === 'machines'), 'a group left with no page is not drawn');
    } finally { await app.close(); }
    const names = require('../modules/harness/tools').schemas().map(t => t.function.name);
    assert.ok(names.includes('read_file') && !names.includes('computer') && !names.includes('ask_device'), 'its tools are not offered');
    assert.match(await require('../modules/harness/tools').call('computer', { action: 'list' }), /no "computer" tool in this hive/);
    const settings = require('../modules/harness/settings');
    assert.ok(!settings.readable().some(r => r.path.startsWith('computers.')), 'its settings are not offered');
    assert.match(settings.refuse('computers.maxRunning', 2), /not licensed/);
    const { loadPrefs, savePrefs } = require('../modules/utils');
    savePrefs({ ...loadPrefs(), developer: { mode: true }, experiments: { toolTiers: true } });
    assert.equal(require('../modules/experiments').on('toolTiers'), false, 'the lab is not licensed: no experiment turns on');
    assert.equal(require('../modules/experiments').list().length, 0);
    const p = loadPrefs(); delete p.experiments; p.developer = { mode: false }; savePrefs(p);
    assert.match(require('../modules/features').describe(require('../modules/features').get('vms')), /Not in this hive's licence/, 'the agents still know it exists');
  });
});

test('tables are made only for licensed features, and later when a licence adds one; never dropped', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const mig = require('../modules/db/migrations');
  const raw = new DatabaseSync(':memory:');
  const tables = () => raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  await withLicence(null, () => {
    mig.migrateSync(raw);
    assert.ok(tables().includes('users') && tables().includes('trace_spans'));
    assert.ok(!tables().includes('sealed_secrets') && !tables().includes('embeddings'), 'devices and the lab are not licensed');
  });
  await withLicence(T.sign({ codes: ['devices'], machine: fp() }), () => {
    mig.migrateSync(raw);
    assert.ok(tables().includes('sealed_secrets') && tables().includes('sealed_uses'), 'made at the start that has the licence');
    assert.deepEqual(raw.prepare('PRAGMA table_info(sealed_secrets)').all().map(c => c.name).includes('person_id'), true, 'every step of it, in order');
  });
  await withLicence(null, () => { mig.migrateSync(raw); assert.ok(tables().includes('sealed_secrets'), 'a licence that goes leaves its tables'); });
  raw.close();
});

test('a lapsed licence keeps its features for the grace, then they are read-only — reading goes on, nothing is removed', async () => {
  const machine = fp();
  const now = Date.now();
  await withLicence(T.sign({ codes: ['all'], machine, expiry: iso(now - 3 * DAY) }), async () => {
    assert.equal(lic().readOnly(), null, 'three days past expiry, inside the 14 days of grace');
    assert.match(require('../modules/license/routes').banner(lic().status()).text, /lapsed: the licence expired/);
  });
  await withLicence(T.sign({ codes: ['all'], machine, expiry: iso(now - 20 * DAY) }), async () => {
    assert.match(lic().readOnly(), /read-only: the licence expired/);
    const app = await appNow();
    try {
      assert.equal((await app.call('GET', '/api/computers')).status, 200, 'still there, still read');
      const w = await app.call('POST', '/api/computers', { name: 'x' });
      assert.equal(w.status, 403); assert.equal(w.body.code, 'licence_read_only');
      assert.equal((await app.call('POST', '/api/harness/sessions', {})).status !== 403, true, 'the core is never read-only');
    } finally { await app.close(); }
    assert.match(await require('../modules/harness/tools').call('computer', { action: 'create', name: 'x' }), /not run — .*read-only/);
  });
  // The owner's grace setting is bounded by what the licence allows.
  await withLicence(T.sign({ codes: ['all'], machine, expiry: iso(now - 20 * DAY), maxGraceDays: 7 }), () => {
    const { loadPrefs, savePrefs } = require('../modules/utils');
    savePrefs({ ...loadPrefs(), licence: { graceDays: 90 } });
    lic().reload();
    assert.equal(lic().status().graceDays, 7);
    savePrefs({ ...loadPrefs(), licence: {} });
  });
  // A check-in missed for longer than the licence asks, and the grace after it.
  await withLicence(T.sign({ codes: ['all'], machine, checkInDays: 7, issued: iso(now - 30 * DAY) }), () => assert.match(lic().readOnly(), /not checked in for 7 days/));
  // The clock set back past a time the hive has seen.
  await withLicence(T.sign({ codes: ['all'], machine, issued: iso(now - DAY) }), () => {
    files().writeJson(files().STATE, { lastSeen: iso(now + 10 * DAY) }); lic().fresh();
    assert.match(lic().readOnly(), /clock was set back/);
  });
});

test('an install from before licensing keeps everything for 30 days with a banner, then turns read-only; a new one gets none', async () => {
  const grace = require('../modules/license/grace');
  const M = require('../modules/migrations');
  assert.ok(M.MIGRATIONS.some(m => m.id === '3.0-licence-grace'), 'a migration gives it');
  assert.ok(M.stamp({ theme: 'x' }).migrations.applied.includes('3.0-licence-grace'), 'a new prefs file is born having had it');
  await withLicence(null, async () => {
    const now = Date.now();
    assert.equal(grace.adopt(now), 'given');
    assert.equal(grace.adopt(now + 5 * DAY), 'kept', 'given once; a second run keeps the first date');
    lic().reload();
    const s = lic().status();
    assert.equal(s.source, 'grace'); assert.ok(lic().has('lab') && lic().has('machines'), 'every feature, the lab too');
    assert.ok(Date.parse(s.grace.until) <= Math.min(now + 30 * DAY + 1000, Date.parse(grace.LAST_DAY)));
    assert.match(require('../modules/license/routes').banner(s).text, /No licence yet — add one before \d{4}-\d{2}-\d{2}/);
    files().writeJson(files().GRACE, { since: iso(now - 31 * DAY), until: iso(now - DAY) });
    lic().fresh();
    assert.match(lic().readOnly(), /grace for adding a licence ended/, 'running past it: read-only at once');
    lic().reload();
    assert.equal(lic().status().source, 'none', 'the next start runs the core');
  });
  files().remove(files().GRACE);
  assert.equal(grace.adopt(Date.parse('2027-03-01')), 'given');
  assert.equal(grace.current().until, new Date(grace.LAST_DAY).toISOString(), 'never past the last day, whenever the install updated');
  files().remove(files().GRACE);
});

test('Settings → System → Licence: upload, key, removal — a change waits for the next start; a member sees only what is left out', async () => {
  await withLicence(null, async () => {
    lic().status();   // the hub has started: what is in effect is read
    const up = await H.api(null, 'POST', '/api/licence/file', { certificate: T.sign({ codes: ['voice', 'home'], machine: fp() }) });
    assert.equal(up.status, 200);
    assert.match(up.body.said, /takes effect when the hub next starts/);
    assert.equal(up.body.licence.restartNeeded, true);
    assert.deepEqual(up.body.licence.onDisk.codes, ['home', 'voice']);
    const bad = await H.api(null, 'POST', '/api/licence/file', { certificate: T.sign({ codes: ['all'], machine: 'a'.repeat(64) }) });
    assert.equal(bad.status, 400); assert.equal(bad.body.code, 'wrong_machine');
    assert.equal((await H.api(null, 'POST', '/api/licence/key', { server: 'not an address' })).status, 400);
    const k = await H.api(null, 'POST', '/api/licence/key', { key: 'SECRET-KEY', server: 'https://licence.example.test', account: 'acc' });
    assert.equal(k.body.licence.hasKey, true); assert.equal(k.body.licence.server, 'https://licence.example.test');
    assert.ok(!JSON.stringify(k.body).includes('SECRET-KEY'));
    const member = await H.signIn('member');
    const m = await H.api(null, 'GET', '/api/licence', undefined, { Cookie: member.cookie });
    assert.equal(m.status, 200); assert.ok(m.body.off && m.body.fingerprint === undefined && m.body.codes === undefined);
    assert.equal((await H.api(null, 'POST', '/api/licence/check', {}, { Cookie: member.cookie })).status, 403);
    const del = await H.api(null, 'DELETE', '/api/licence');
    assert.match(del.body.said, /removed/);
    const { loadPrefs, savePrefs } = require('../modules/utils');
    savePrefs({ ...loadPrefs(), licence: {} });
  });
});

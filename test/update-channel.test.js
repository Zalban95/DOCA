'use strict';

/**
 * The update channel of a production hive (modules/update-channel; docs/design/production.md): releases listed by the
 * licence server with the hive's licence key, each manifest verified against the release keys, the zip fetched through
 * Keygen's artifact redirect and checked against the signed sha256, staged beside the running version, and switched to
 * only once nothing runs — now, in a window, or after an urgent release's date — and a failed switch is not retried.
 * A stub stands in for Keygen's distribution API.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder, and trusts the test keys
const T = require('./licence-trust');
const U = require('./update-trust');
const http = require('http');
const fs = require('fs');
const path = require('path');

const lic = () => require('../modules/license');
const keys = () => require('../modules/license/keys');
const files = () => require('../modules/license/files');
const ch = () => require('../modules/update-channel');
const store = () => require('../modules/store');
const RUNNING = require('../package.json').version;

let stub, base, releases = [], seen = [];
function serve(req, res) {
  seen.push({ url: req.url, auth: req.headers.authorization || null });
  const u = new URL(req.url, 'http://x');
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/vnd.api+json' }); res.end(JSON.stringify(body)); };
  if (u.pathname.startsWith('/storage/')) {
    const r = releases.find(x => `/storage/${x.manifest.file}` === u.pathname);
    if (req.headers.authorization) return json(400, { errors: [{ detail: 'the key never goes to storage' }] });
    res.writeHead(r ? 200 : 404); return res.end(r ? r.buf : '');
  }
  if (req.headers.authorization !== 'License LIC-KEY-1') return json(401, { errors: [{ detail: 'no licence' }] });
  if (u.pathname === '/v1/releases') return json(200, { data: releases.map(r => ({ id: `rel-${r.version}`, type: 'releases',
    attributes: { version: r.version, status: 'PUBLISHED', channel: 'stable', metadata: { manifest: JSON.stringify(r.manifest), signature: r.signature } } })) });
  let m = /^\/v1\/releases\/rel-([\d.]+)\/artifacts$/.exec(u.pathname);
  if (m) { const r = releases.find(x => x.version === m[1]); return json(200, { data: r ? [{ id: `art-${r.version}`, type: 'artifacts', attributes: { filename: r.manifest.file } }] : [] }); }
  m = /^\/v1\/artifacts\/art-([\d.]+)$/.exec(u.pathname);
  if (m) { res.writeHead(303, { Location: `${base}/storage/doca-${m[1]}.zip` }); return res.end(); }
  json(404, { errors: [{ detail: 'not here' }] });
}

/** A production hive: a licence without the lab (the suite's own grants everything, which is development). */
function production() { keys().preloaded.certificate = T.sign({ codes: ['voice'] }); lic().reload(); }
function development() { keys().preloaded.certificate = T.preloadedFull; lic().reload(); }

test.before(async () => {
  await H.start();
  stub = http.createServer(serve);
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${stub.address().port}`;
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), licence: { server: base } });
  files().writeJson(files().CONFIG, { key: 'LIC-KEY-1' });
  ch().hooks.restart = () => { restarts++; };
  ch().hooks.deps = async dir => { fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'), '{}'); };
});
let restarts = 0;
test.after(async () => { development(); files().remove(files().CONFIG); stub.close(); await H.stop(); });

test('a manifest verifies only with a release key, unchanged', () => {
  const m = require('../modules/update-channel/manifest');
  const r = U.release('99.0.0');
  assert.equal(m.verify(r.manifest, r.signature, require('../modules/update-channel/keys').RELEASE_KEYS).keyId, 'test-release');
  assert.throws(() => m.verify(U.release('99.0.0', { tamper: true }).manifest, r.signature, require('../modules/update-channel/keys').RELEASE_KEYS), /not signed|changed after signing/);
  assert.throws(() => m.verify(r.manifest, U.release('99.0.0', { key: U.other() }).signature, require('../modules/update-channel/keys').RELEASE_KEYS), /not signed/);
  assert.throws(() => m.verify(r.manifest, r.signature, []), /trusts no release key/);
});

test('a development hive ignores the channel; its routes say it updates from git', async () => {
  development();
  assert.equal((await ch().check()).development, true);
  assert.equal((await H.api(null, 'GET', '/api/update/channel')).status, 409);
});

test('check: the newest release that verifies, urgent and by when; a tampered one is skipped; the key never reaches storage', async () => {
  production();
  releases = [U.release('99.1.0', { tamper: true }), U.release('99.0.0', { urgent: true, applyBy: '2099-01-01T00:00:00Z' }), U.release('98.0.0'), U.release(RUNNING)];
  const r = await ch().check();
  assert.equal(r.ok, true, r.why);
  assert.equal(r.latest.version, '99.0.0');
  assert.deepEqual(r.urgent.versions, ['99.0.0']);
  assert.equal(r.urgent.applyBy, '2099-01-01T00:00:00Z');
  assert.deepEqual(r.skipped.map(s => s.version), ['99.1.0']);
  assert.ok(seen.every(s => s.url.startsWith('/storage/') ? !s.auth : s.auth === 'License LIC-KEY-1'));
  const view = (await H.api(null, 'GET', '/api/update-check?force=1')).body;
  assert.equal(view.production, true); assert.equal(view.latest, '99.0.0'); assert.equal(view.updateAvailable, true);
});

test('the window: days and hours on the hive\'s clock, past midnight too', () => {
  const at = (d, h, m = 0) => { const x = new Date(2026, 9, 4 + d, h, m); return x; };   // 2026-10-04 is a Sunday
  const w = { days: ['mon'], from: '02:00', to: '05:00' };
  assert.equal(ch().inWindow(w, at(1, 3)), true);
  assert.equal(ch().inWindow(w, at(1, 5)), false);
  assert.equal(ch().inWindow(w, at(2, 3)), false);
  const night = { days: ['sat'], from: '23:00', to: '01:00' };
  assert.equal(ch().inWindow(night, at(6, 23, 30)), true);
  assert.equal(ch().inWindow(night, at(7, 0, 30)), true, 'the night that started on Saturday');
  assert.equal(ch().inWindow(night, at(1, 0, 30)), false, 'a Monday morning: its night started on Sunday, not listed');
  assert.equal(ch().inWindow(night, at(6, 0, 30)), false, 'a Saturday morning: its night started on Friday');
});

test('due: asked, urgent after its date, or inside the window — never a version that failed, unless asked again', () => {
  production();
  const s = { latest: { version: '99.0.0', manifest: {} } };
  assert.equal(ch().dueWhy(s), null);
  assert.match(ch().dueWhy({ ...s, requested: true }), /asked/);
  assert.match(ch().dueWhy({ ...s, urgent: { applyBy: '2020-01-01T00:00:00Z' } }), /urgent/);
  assert.equal(ch().dueWhy({ ...s, urgent: { applyBy: '2099-01-01T00:00:00Z' } }), null);
  assert.equal(ch().dueWhy({ ...s, urgent: { applyBy: '2020-01-01T00:00:00Z' }, failed: { version: '99.0.0' } }), null);
});

test('Update now: staged while a turn runs, switched only once it ends; the switch is the launcher\'s, holding the way back', async () => {
  production();
  const lifecycle = require('../modules/harness/turn/lifecycle');
  lifecycle.running.set('busy-turn', { auto: false });
  try {
    const r = await H.api(null, 'POST', '/api/update/channel/apply', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const dir = path.join(require('../modules/releases').DIR, 'v99.0.0');
    for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, '.doca-release.json')); i++) await new Promise(x => setTimeout(x, 100));
    assert.ok(fs.existsSync(path.join(dir, 'server.js')), 'staged beside the running version');
    assert.ok(require('../modules/update-channel/stage').verified(dir), 'with its signed manifest');
    const st = (await H.api(null, 'GET', '/api/update/channel')).body;
    assert.ok(st.waiting && st.waiting.on.length, 'waits for the running turn');
    await new Promise(x => setTimeout(x, 2500));
    assert.equal(require('../modules/releases').current(), 'checkout', 'nothing switched while the turn runs');
  } finally { lifecycle.running.delete('busy-turn'); }
  for (let i = 0; i < 60 && require('../modules/releases').current() !== 'v99.0.0'; i++) await new Promise(x => setTimeout(x, 100));
  assert.equal(require('../modules/releases').current(), 'v99.0.0', 'switched once nothing ran');
  assert.match(fs.readFileSync(path.join(require('../modules/releases').DIR, 'pending'), 'utf8'), /v99\.0\.0 checkout/, 'the launcher watches it for 90 s');
  await new Promise(x => setTimeout(x, 400));
  assert.equal(restarts, 1, 'and restarts into it');
  // Production lists and switches only signed versions: the staged one and the checkout it was installed as.
  const v = await H.api(null, 'GET', '/api/versions');
  assert.deepEqual(v.body.versions.map(x => x.tag), ['v99.0.0', 'checkout']);
  assert.match(await require('../modules/releases').refusal('v1.0.0'), /not a signed release/);
  assert.equal(await require('../modules/releases').refusal('checkout'), null);
});

test('after the restart: the launcher put the old version back, so it is said, and not tried again by itself', async () => {
  production();
  // The process running is still RUNNING, so a switch to 99.0.0 that is "applying" did not hold.
  fs.rmSync(path.join(require('../modules/releases').DIR, 'pending'), { force: true });
  fs.rmSync(path.join(require('../modules/releases').DIR, 'current'), { force: true });
  const o = ch().outcome();
  assert.deepEqual(o, { ok: false, version: '99.0.0' });
  const s = ch().status();
  assert.equal(s.failed.version, '99.0.0');
  assert.equal(ch().dueWhy(store().readJson('update-channel/state', {})), null, 'not due again: urgent, but failed');
  const notes = require('../modules/notices').list(null, true).map(n => n.title);
  assert.ok(notes.some(t => /did not start/.test(t)), notes.join(' | '));
});

test('a window that closes before the hive is idle calls the wait off; nothing is cut', async () => {
  production();
  store().writeJson('update-channel/state', { ...store().readJson('update-channel/state', {}), failed: null, lastCheck: new Date().toISOString() });
  const now = new Date(), hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  await H.api(null, 'POST', '/api/update/channel', { auto: 'window', days: require('../modules/update-channel').DAYS, from: hhmm(new Date(now - 60e3)), to: hhmm(new Date(+now + 3600e3)) });
  const lifecycle = require('../modules/harness/turn/lifecycle');
  lifecycle.running.set('long-turn', { auto: false });
  try {
    await ch().tick();
    assert.match(require('../modules/harness/drain').pending()?.label || '', /^update to v99\.0\.0/);
    await H.api(null, 'POST', '/api/update/channel', { auto: 'notify' });   // as if the window had closed
    await ch().tick();
    assert.equal(require('../modules/harness/drain').pending(), null, 'the wait is called off until the next window');
  } finally { lifecycle.running.delete('long-turn'); }
});

test('an image hive holds its work for its host: asked by a file, ready once nothing runs', async () => {
  const hold = require('../modules/update-channel/hold');
  const lifecycle = require('../modules/harness/turn/lifecycle');
  fs.mkdirSync(path.dirname(hold.REQ()), { recursive: true });
  fs.writeFileSync(hold.REQ(), JSON.stringify({ at: new Date().toISOString(), by: 'test' }));
  let exited = null;
  lifecycle.running.set('a-turn', { auto: false });
  try {
    hold.look({ exit: c => { exited = c; } });
    assert.equal(JSON.parse(fs.readFileSync(hold.STATE(), 'utf8')).state, 'waiting');
    await new Promise(x => setTimeout(x, 2300));
    assert.equal(exited, null, 'not while a turn runs');
  } finally { lifecycle.running.delete('a-turn'); }
  for (let i = 0; i < 40 && exited === null; i++) await new Promise(x => setTimeout(x, 100));
  assert.equal(exited, 0);
  assert.equal(JSON.parse(fs.readFileSync(hold.STATE(), 'utf8')).state, 'ready');
  fs.rmSync(hold.REQ(), { force: true }); hold.look({ exit: () => {} }); hold.stop();
});

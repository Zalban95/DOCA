'use strict';

/**
 * Hub → Admin (modules/admin): one host-only read that answers "is everything fine, and what needs me?" — five cards,
 * each built from the owning modules' own reads and worded by fixed templates, every line linking to where it is
 * handled; nothing secret in the payload; a production or hosted hive says so.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: temporary settings, the test licence
const T = require('./licence-trust');

const admin = () => require('../modules/admin');
const DAY = 864e5;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const ago = ms => new Date(NOW - ms).toISOString();
const byId = (sec, id) => sec.lines.find(l => l.id === id);

test.before(() => H.start());
test.after(() => H.stop());

test('the overview is a host\'s: a member and nobody are refused', async () => {
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/admin/overview', undefined, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'GET', '/api/admin/overview', undefined, { Cookie: '' })).status, 401);
  const { status, body } = await H.api(null, 'GET', '/api/admin/overview');
  assert.equal(status, 200);
  assert.deepEqual(body.sections.map(s => s.id), ['needs', 'health', 'people', 'security', 'spending']);
  for (const s of body.sections) {
    assert.ok(!s.error, `${s.id}: ${s.error}`);
    for (const l of s.lines) {
      assert.ok(['ok', 'info', 'ask', 'err'].includes(l.state), `${s.id}/${l.id}: state`);
      assert.ok(!l.go || /^(settings\/[a-z-]+|[a-z]+)$/.test(l.go), `${s.id}/${l.id}: a page or a Settings section`);
    }
  }
  assert.equal(byId(body.sections[1], 'version').value, require('../package.json').version);
});

test('nothing secret reaches the page: no token, hash, licence key, fingerprint or password', async () => {
  const { token } = H.mkDevice('Kitchen phone', 'phone', H.PHONE_CAPS);
  admin()._reset();
  const { body } = await H.api(null, 'GET', '/api/admin/overview?fresh=1');
  const text = JSON.stringify(body);
  assert.ok(!text.includes(token), 'a device token');
  assert.doesNotMatch(text, /tokenHash|passwordHash|fingerprint|"key"|test-password/);
  const people = body.sections.find(s => s.id === 'people');
  assert.match(byId(people, 'devices').sub, /1 phone/);
});

test('a guarded switch is recorded by name and shown with who and when — never its value', async () => {
  const r = await H.api(null, 'POST', '/api/prefs', { developer: { mode: true } });
  assert.equal(r.status, 200);
  await H.sleep(200);   // the audit is written after the answer
  admin()._reset();
  const { body } = await H.api(null, 'GET', '/api/admin/overview');
  const sec = body.sections.find(s => s.id === 'security');
  const sw = sec.lines.find(l => /^switch-/.test(l.id));
  assert.ok(sw, JSON.stringify(sec.lines));
  assert.equal(sw.label, 'Changed: developer mode and releasing');
  assert.match(sw.value, /owner, /);
});

test('each card is assembled from its inputs (stubs): health', () => {
  const h = require('../modules/admin/health').build({
    version: '9.9.9', mode: { mode: 'production', why: 'a hosted hive is always production' }, hosted: true,
    update: { via: 'channel', latest: '9.9.10', available: true, urgent: true },
    licence: { source: 'file', valid: true, edition: 'Team', customer: 'Acme', expiry: ago(-5 * DAY), online: true, lastCheckIn: ago(3 * 3600e3) },
    backup: { last: { name: 'a.dBac', at: ago(10 * DAY) }, every: 'off', mirror: { dir: '/mnt/nas', lastError: 'ENOSPC' } },
    disk: { free: 1e9, total: 100e9 }, gpus: [{ name: 'RTX', memUsed: 15000, memTotal: 15500 }],
    trouble: [{ kind: 'container', name: 'doca-kokoro', detail: 'restarting' }], uptime: { hub: 3 * 3600e3, machine: 5 * DAY },
  }, NOW);
  assert.equal(byId(h, 'version').value, '9.9.9');
  assert.equal(byId(h, 'update').state, 'err');
  assert.match(byId(h, 'update').value, /9\.9\.10 is waiting \(urgent\)/);
  assert.equal(byId(h, 'mode').value, 'production · hosted');
  assert.equal(byId(h, 'licence').value, 'Team · Acme');
  assert.equal(byId(h, 'licence-expiry').state, 'ask');
  assert.equal(byId(h, 'licence-checkin').value, '3 h ago');
  assert.equal(byId(h, 'backup').state, 'ask');
  assert.equal(byId(h, 'mirror').state, 'err');
  assert.equal(byId(h, 'disk').state, 'err');
  assert.equal(byId(h, 'gpu-0').state, 'ask');
  assert.equal(byId(h, 'trouble').value, '1 machine');
  assert.match(byId(h, 'trouble').sub, /doca-kokoro/);
  assert.equal(byId(h, 'uptime').value, '3 h');
  assert.equal(byId(h, 'backup').go, 'settings/backups');
});

test('each card is assembled from its inputs (stubs): needs you, nothing and something', () => {
  const needs = require('../modules/admin/needs');
  assert.deepEqual(needs.build({ devicesPending: { n: 0 }, locked: { accounts: [], addresses: 0 }, failedSignIns: { n: 0 }, grace: {}, teams: {} }, NOW).lines, []);
  const n = needs.build({
    devicesPending: { n: 2, oldest: ago(2 * 3600e3) }, unowned: 1, settingsProposals: 1, installProposals: 2, approvals: 1, heldAsks: 1,
    missionsFailed: 1, missionsPaused: 0, teams: { failed: 0, stopped: 1 }, stoppedWork: 1,
    locked: { accounts: ['Ada'], addresses: 1 }, failedSignIns: { n: 7, accounts: 1 },
    grace: { source: 'grace', until: ago(-3 * DAY) },
  }, NOW);
  assert.equal(byId(n, 'devices-pending').value, '2 devices');
  assert.equal(byId(n, 'devices-pending').go, 'apikeys');
  assert.equal(byId(n, 'proposals').sub, '1 setting, 2 installs');
  assert.match(byId(n, 'approvals').sub, /1 mission held/);
  assert.equal(byId(n, 'missions-failed').state, 'err');
  assert.match(byId(n, 'teams').sub, /1 stopped/);
  assert.match(byId(n, 'locked').sub, /Ada/);
  assert.equal(byId(n, 'failed-signins').value, '7 tries');
  assert.equal(byId(n, 'grace').value, 'in 3 days');
  assert.equal(byId(n, 'unowned').value, '1 device');
});

test('each card is assembled from its inputs (stubs): people, security, spending', () => {
  const p = require('../modules/admin/people').build({ since: ago(DAY), people: [
    { levelName: 'Admin', seen: ago(3600e3) }, { levelName: 'Member', seen: ago(3 * DAY) }, { levelName: 'Member', seen: null }, { levelName: 'Member', suspended: true }],
  devices: [{ kind: 'device', form: 'watch' }, { kind: 'device', form: 'phone', unowned: true }, { kind: 'browser' }, { kind: 'browser', archived: true }] });
  assert.equal(byId(p, 'people').value, '3 people');
  assert.equal(byId(p, 'people').sub, '2 Member · 1 Admin');
  assert.equal(byId(p, 'active').value, '1 person');
  assert.equal(byId(p, 'devices').value, '3 devices');
  assert.equal(byId(p, 'devices-other').value, '1 · 1 · 0');
  const s = require('../modules/admin/security').build({ switches: [{ what: 'the approval mode', who: 'Ada', at: ago(2 * 3600e3) }],
    fresh: [{ who: 'Ada', from: '100.64.0.9', at: ago(3600e3) }], passwords: [{ who: 'Ada', whose: 'Bob', at: ago(DAY) }] }, NOW);
  assert.equal(byId(s, 'switch-0').label, 'Changed: the approval mode');
  assert.equal(byId(s, 'switch-0').value, 'Ada, 2 h ago');
  assert.match(byId(s, 'new-0').value, /Ada from 100\.64\.0\.9/);
  assert.equal(byId(s, 'password-0').value, 'Bob\'s, by Ada, 24 h ago');
  const sp = require('../modules/admin/spending').build({ currency: 'EUR', today: { calls: 4, tokens: 120000, money: 0.5, unpriced: 1 }, month: { tokens: 2e6, money: 9 },
    people: [{ name: 'Ada', tokens: 900000, money: 0, tokenLimit: 1e6, moneyLimit: null }] });
  assert.equal(byId(sp, 'today').value, '120k tokens · 0.50 EUR');
  assert.match(byId(sp, 'today').sub, /1 without a price/);
  assert.equal(byId(sp, 'person-0').state, 'ask');
  assert.deepEqual(byId(sp, 'person-0').meter, { used: 900000, max: 1e6, unit: 'tokens' });
});

test('a production, hosted hive shows its mode', async () => {
  const hosted = require('../modules/hosted');
  const keys = require('../modules/license/keys'), lic = require('../modules/license');
  const was = hosted.on;
  try {
    hosted.on = () => true;
    keys.preloaded.certificate = T.sign({ codes: ['voice'] }); lic.reload();
    admin()._reset();
    const { body } = await H.api(null, 'GET', '/api/admin/overview');
    assert.equal(body.mode, 'production');
    assert.equal(body.hosted, true);
    assert.equal(byId(body.sections.find(s => s.id === 'health'), 'mode').value, 'production · hosted');
  } finally {
    hosted.on = was;
    keys.preloaded.certificate = T.preloadedFull; lic.reload();
    admin()._reset();
  }
});

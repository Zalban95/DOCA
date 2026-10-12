'use strict';

// Focused and Extended (modules/screens/panel-mode.js, public/js/focused/*): which face a screen shows is the screen
// setting `panelMode` — this screen's, its person's, the hive's, else by role (a host starts in Extended, everyone
// else in Focused); screens that existed before keep Extended (migration); the agent can never propose it; and
// Extended loses nothing (Focused only hides pages).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const call = async (cookie, method, p, body) => {
  const res = await fetch(H.base + p, { method, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

test('a new screen starts by its person\'s role: a host in Extended, a member in Focused', async () => {
  const owner = await call(H.owner.cookie, 'GET', '/api/screen');
  assert.deepEqual(owner.body.panelMode, { mode: 'extended', from: 'role' });
  const admin = await H.signIn('admin', 'mode-admin@test.local');
  assert.equal((await call(admin.cookie, 'GET', '/api/screen')).body.panelMode.mode, 'extended');
  const member = await H.signIn('member', 'mode-member@test.local');
  assert.deepEqual((await call(member.cookie, 'GET', '/api/screen')).body.panelMode, { mode: 'focused', from: 'role' });
  const viewer = await H.signIn('viewer', 'mode-viewer@test.local');
  assert.equal((await call(viewer.cookie, 'GET', '/api/screen')).body.panelMode.mode, 'focused');
});

test('a screen switches in one call either way; a person\'s choice follows them to their other screens', async () => {
  const m = await H.signIn('member', 'mode-two@test.local');
  const a = await call(m.cookie, 'GET', '/api/screen');
  const jarA = `${m.cookie}; ${a.cookie}`;
  const ext = await call(jarA, 'POST', '/api/screen/settings', { panelMode: 'extended' });
  assert.equal(ext.status, 200);
  assert.deepEqual(ext.body.panelMode, { mode: 'extended', from: 'device' });
  assert.deepEqual((await call(jarA, 'POST', '/api/screen/settings', { panelMode: 'focused' })).body.panelMode, { mode: 'focused', from: 'device' });
  assert.equal((await call(jarA, 'POST', '/api/screen/settings', { panelMode: 'everything' })).status, 400, 'only the two faces');
  // "On all my screens": the person's layer. A second browser of theirs, never set, follows it.
  const all = await call(jarA, 'POST', '/api/screen/settings?layer=person', { panelMode: 'extended' });
  assert.equal(all.status, 200);
  const credentials = require('../modules/auth/credentials');
  const other = `${credentials.COOKIE}=${credentials.startSession({ user: m.user, orgId: m.orgId })}`;
  const b = await call(other, 'GET', '/api/screen');
  assert.notEqual(b.body.id, a.body.id);
  assert.deepEqual(b.body.panelMode, { mode: 'extended', from: 'person' });
  assert.equal((await call(jarA, 'GET', '/api/screen')).body.panelMode.from, 'device', 'a screen that chose for itself keeps its own');
});

test('the hive\'s default wins over the role, and an edition can set it', async () => {
  const u = require('../modules/utils'); const p = u.loadPrefs(); p.panelMode = 'focused'; u.savePrefs(p);
  try {
    const admin = await H.signIn('admin', 'mode-hive@test.local');
    assert.deepEqual((await call(admin.cookie, 'GET', '/api/screen')).body.panelMode, { mode: 'focused', from: 'hive' });
  } finally { const q = u.loadPrefs(); delete q.panelMode; u.savePrefs(q); }
});

test('the agent can never propose it: not settable, not a screen proposal', () => {
  const schema = require('../modules/settings-schema');
  assert.ok(schema.SCHEMA.panelMode, 'declared');
  assert.equal(schema.SCHEMA.panelMode.on, 'screen');
  assert.ok(!schema.SCHEMA.panelMode.propose && !schema.SCHEMA.panelMode.screenPropose);
  assert.ok(!schema.settable().some(s => s.prefix.startsWith('panelMode')), 'not in SETTABLE');
  const settings = require('../modules/harness/settings');
  assert.ok(settings.refuse('panelMode', 'extended'), 'a proposal for the hive is refused');
  assert.ok(settings.refuse('panelMode', 'extended', { screen: 'this' }), 'and for one screen');
});

test('the migration keeps an admin\'s existing screens on Extended, once; a member\'s go by role', async () => {
  const devices = require('../modules/api-v1/devices'), screens = require('../modules/screens');
  const admin = await H.signIn('admin', 'mig-admin@test.local'), member = await H.signIn('member', 'mig-member@test.local');
  const mk = (name, userId) => { const d = devices.create({ name, kind: 'browser', scopes: [] }).device; if (userId) devices.update(d.id, { userId }); return d; };
  const theirs = mk('admin browser', admin.user.id), old = mk('before accounts'), mine = mk('member browser', member.user.id);
  const chose = mk('chose', admin.user.id);
  screens.set(chose.id, { panelMode: 'focused' });
  const n = require('../modules/screens/panel-mode').markExisting();
  assert.ok(n >= 2);
  assert.equal(screens.layer(theirs.id).panelMode, 'extended', 'an admin keeps the panel they used');
  assert.equal(screens.layer(old.id).panelMode, 'extended', 'a screen from before accounts was the owner\'s');
  assert.equal(screens.layer(mine.id).panelMode, undefined, 'a member\'s goes by role');
  assert.equal(require('../modules/screens/panel-mode').resolve(mine.id, member.user, 'member').mode, 'focused');
  assert.equal(screens.layer(chose.id).panelMode, 'focused', 'a choice already made is kept');
  assert.equal(require('../modules/screens/panel-mode').markExisting(), 0, 'nothing left to mark');
  const row = require('../modules/migrations').MIGRATIONS.find(m => m.id === '3.38-panel-mode-existing');
  assert.ok(row, 'the migration is listed');
  // A new prefs file is born having had it: a new install's screens start by role.
  assert.ok(require('../modules/migrations').stamp({}).migrations.applied.includes('3.38-panel-mode-existing'));
});

test('Extended still has every page: Focused only hides the panel while it shows', () => {
  const js = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  const ctx = { localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(`${js('nav.js')}\n${js('nav-groups.js')}\nthis.out = { NAV_TABS, NAV_GROUPS };`, ctx);
  const { NAV_TABS, NAV_GROUPS } = JSON.parse(JSON.stringify(ctx.out));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.deepEqual([...NAV_GROUPS.flatMap(g => g.tabs)].sort(), [...NAV_TABS].sort());
  // Nothing in the Focused view changes the panel's pages, groups, hidden tabs or layout.
  const dir = path.join(__dirname, '..', 'public', 'js', 'focused');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /NAV_(TABS|GROUPS|LABELS)\s*(=|\.(push|splice))|hiddenTabs|panelLayout(Save|Set)|\bpanel:\s*\{/, `${f} leaves the panel's pages alone`);
  }
  // Every rule that hides the Extended panel is scoped to Focused showing.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'focused.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.match(/[^{}]+\{[^}]*display:\s*none\s*!important[^}]*\}/g) || [])
    assert.match(rule.split('{')[0].trim(), /^(html\[data-mode="focused"\][^,]*,?\s*)+$|\.fc|fc-/, `scoped to Focused: ${rule.split('{')[0].trim().slice(0, 80)}`);
  // The way back is always drawn in Extended, and every Focused script is loaded.
  assert.match(js('focused/boot.js'), /focused-pill/);
  for (const f of fs.readdirSync(dir)) assert.ok(html.includes(`js/focused/${f}`), `${f} is loaded`);
});

test('the week from today: the calendars this person may see, or why there are none', async () => {
  const member = await H.signIn('member', 'mode-week@test.local');
  const r = await call(member.cookie, 'GET', '/api/ambient/week?days=7');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.events, []);
  assert.match(r.body.none, /Connect/);
});

test('a paired app reads the resolved face from /api/v1 (additive): by role, or as set', async () => {
  const devices = require('../modules/api-v1/devices');
  const member = await H.signIn('member', 'mode-app@test.local');
  const phone = H.mkDevice('their phone', 'phone', H.PHONE_CAPS);
  devices.update(phone.device.id, { userId: member.user.id, orgId: member.orgId });
  let r = await H.api(phone.token, 'GET', '/api/v1/settings/effective');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.panelModeResolved, { mode: 'focused', source: 'role' });
  devices.update(phone.device.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
  r = await H.api(phone.token, 'GET', '/api/v1/settings/effective');
  assert.deepEqual(r.body.panelModeResolved, { mode: 'extended', source: 'role' });
  require('../modules/screens').set(phone.device.id, { panelMode: 'focused' });
  r = await H.api(phone.token, 'GET', '/api/v1/settings/effective');
  assert.deepEqual(r.body.panelModeResolved, { mode: 'focused', source: 'device' });
  assert.equal(r.body.settings.panelMode, 'focused');
});

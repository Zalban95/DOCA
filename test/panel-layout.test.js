'use strict';

// The panel's structure as data (modules/panel-layout; TODO P1.2; CONSTITUTION §0, S1, S13): a person's layout is
// layered install → person → screen, every read can only name what exists, every page stays placed, the agent changes
// a person's own layer when they ask (and proposes otherwise), and nothing of it is code.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const H       = require('./helpers');
const L       = require('../modules/panel-layout/layout');
const D       = require('../modules/panel-layout/defaults');
const layout  = require('../modules/panel-layout');
const devices = require('../modules/api-v1/devices');
const tools   = require('../modules/harness/tools');
const { loadPrefs } = require('../modules/utils');

let member, memberPhone, ownerTablet;
test.before(async () => {
  await H.start();
  member = await H.signIn('member', 'layout-member@test.local');
  memberPhone = H.mkDevice('Member phone', 'phone', H.PHONE_CAPS);
  devices.update(memberPhone.device.id, { userId: member.user.id, orgId: member.orgId });
  ownerTablet = H.mkDevice('Owner tablet', 'phone', H.PHONE_CAPS);
  devices.update(ownerTablet.device.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
});
test.after(() => H.stop());

const asMember = (method, p, body) => H.api(null, method, p, body, { Cookie: member.cookie });
const memberPerson = () => ({ ...member.user, role: 'member' });
const allTabs = groups => groups.flatMap(g => g.tabs);

test('the browser\'s own copy of the panel is the hub\'s defaults, so a screen with no layout is today\'s panel exactly', () => {
  const src = ['nav.js', 'nav-groups.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n');
  const box = { localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => null } };
  vm.createContext(box);
  vm.runInContext(`${src}\nthis.out = { NAV_TABS, HOST_TABS, NAV_GROUPS, NAV_LABELS };`, box);
  const o = JSON.parse(JSON.stringify(box.out));
  assert.deepEqual(o.NAV_TABS, D.PAGES);
  assert.deepEqual(o.HOST_TABS, D.HOST_PAGES);
  assert.deepEqual(o.NAV_GROUPS, D.GROUPS);
  assert.deepEqual(o.NAV_LABELS, D.LABELS);
  const r = L.resolve({});
  assert.deepEqual(r.groups, D.GROUPS);
  assert.deepEqual(r.hidden, []);
});

test('a layer can only name what exists: unknown pages, markup in names and CSS that is not a plain value are dropped', () => {
  const problems = [];
  const n = L.normalize({
    groups: [{ id: 'agents', tabs: ['workstream', 'nope', 'harness'] }, { id: 'Bad Id!', tabs: ['models'] }],
    hidden: ['models', 'settings', 'ghost'],
    rename: { workstream: '<img src=x onerror=alert(1)>Work', ghost: 'x' },
    views: [{ label: 'Desk', parts: ['workstream', 'settings', 'harness', 'ghost'] }, { label: 'Empty', parts: ['ghost'] }],
    style: { fontScale: 9, density: 'huge', vars: { '--accent': '#4a9de8', '--bg': 'red;}body{display:none', '--x': '#fff', '--text': 'url(http://evil)' } },
    junk: { a: 1 },
  }, problems);
  assert.deepEqual(n.groups, [{ id: 'agents', tabs: ['workstream', 'harness'] }]);
  assert.deepEqual(n.hidden, ['models'], 'Settings is never hidden: it is the way back');
  assert.equal(n.rename.workstream, 'img srcx onerroralert(1)Work');
  assert.ok(!/[<>=]/.test(n.rename.workstream));
  assert.deepEqual(n.views, [{ id: 'view-desk', label: 'Desk', parts: [{ page: 'workstream' }, { page: 'harness' }], columns: 2 }]);
  assert.deepEqual(n.style, { vars: { '--accent': '#4a9de8' } });
  assert.equal(n.junk, undefined);
  assert.ok(problems.length >= 4);
});

test('layers merge field by field, and every page stays placed — one an update adds lands in its own group', () => {
  const install = { rename: { harness: 'Agent' }, style: { density: 'compact' } };
  const person = { groups: [{ id: 'agents', tabs: ['workstream', 'harness'] }, { id: 'intelligence', tabs: ['mcp'] }], hidden: ['vms'],
    views: [{ label: 'Desk', parts: ['workstream', 'logs'] }], style: { vars: { '--accent': '#ff0000' } } };
  const screen = { style: { fontScale: 1.3, vars: { '--bg': '#000000' } } };
  const m = L.merge([install, person, screen]);
  assert.deepEqual(m.style, { density: 'compact', vars: { '--accent': '#ff0000', '--bg': '#000000' }, fontScale: 1.3 });
  const r = L.resolve(m);
  assert.deepEqual(r.groups.slice(0, 2).map(g => g.id), ['agents', 'intelligence'], 'the person\'s order first');
  assert.deepEqual(r.groups[0].tabs, ['workstream', 'harness', 'projects', 'archive', 'chronicle'], 'pages the layout did not list stay in their group');
  assert.deepEqual(r.groups[1].tabs, ['mcp', 'models', 'connectors', 'apikeys']);
  assert.equal(r.labels.harness, 'Agent');
  assert.deepEqual(r.groups.find(g => g.id === 'yours').tabs, ['view-desk']);
  assert.equal(r.groups.at(-1).id, 'settings');
  assert.deepEqual(new Set(allTabs(r.groups)), new Set([...D.PAGES, 'view-desk']), 'every page is somewhere, once');
  assert.equal(allTabs(r.groups).length, D.PAGES.length + 1);
  const member = L.resolve(m, { host: false });
  assert.ok(!allTabs(member.groups).some(t => D.HOST_PAGES.includes(t)), 'the machine\'s pages are not a member\'s');
  assert.deepEqual(member.views[0].parts, [{ page: 'workstream' }], 'not inside a view either');
});

test('a person\'s layout follows them to every screen; a screen keeps its own on top; ten users, ten panels', async () => {
  const r = await asMember('POST', '/api/screen/layout', { scope: 'person', ops: [
    { op: 'move', page: 'workstream', group: 'controls', index: 0 },
    { op: 'group', group: 'controls', index: 1 },
    { op: 'hide', page: 'Models' },
    { op: 'rename', page: 'harness', label: 'Chat' },
    { op: 'view', label: 'Desk', pages: ['workstream', 'harness'] },
    { op: 'style', fontScale: 1.15 },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.resolved.groups[0].id, 'agents');
  assert.equal(r.body.resolved.groups[1].tabs[0], 'workstream');
  assert.deepEqual(r.body.resolved.hidden, ['models']);
  assert.equal(r.body.resolved.labels.harness, 'Chat');
  assert.ok(r.body.resolved.views.some(v => v.id === 'view-desk'));
  assert.equal(r.body.resolved.style.fontScale, 1.15);
  assert.equal(loadPrefs().panel, undefined, 'the install\'s prefs are untouched');

  // The same person on their phone sees it; the phone enlarges its own text only.
  const e = layout.effective({ userId: member.user.id, deviceId: memberPhone.device.id });
  assert.equal(e.resolved.labels.harness, 'Chat');
  layout.change('screen', { userId: member.user.id, deviceId: memberPhone.device.id }, [{ op: 'style', fontScale: 1.5 }]);
  const phone = require('../modules/screens').effective(memberPhone.device.id, member.user.id).settings.panel;
  assert.equal(phone.style.fontScale, 1.5);
  assert.deepEqual(phone.hidden, ['models'], 'the screen layer keeps the person\'s');
  assert.equal((await asMember('GET', '/api/screen/layout')).body.resolved.style.fontScale, 1.15, 'the other screen is unchanged');

  // The owner's panel is theirs.
  const own = await H.api(null, 'GET', '/api/screen/layout');
  assert.deepEqual(own.body.resolved.groups, D.GROUPS);
  assert.equal(own.body.resolved.labels.harness, 'Harness');
});

test('undo puts back what a change replaced, reset is the default in one click, and the install\'s default is an admin\'s', async () => {
  const before = (await asMember('GET', '/api/screen/layout')).body;
  assert.ok(before.undo.person >= 1);
  assert.equal(before.undo.install, undefined, 'a member is not offered the install\'s');
  assert.equal((await asMember('POST', '/api/screen/layout', { scope: 'person', ops: [{ op: 'reset' }] })).body.resolved.labels.harness, 'Harness');
  const back = await asMember('POST', '/api/screen/layout/undo', { scope: 'person' });
  assert.equal(back.body.resolved.labels.harness, 'Chat');
  assert.equal((await asMember('POST', '/api/screen/layout', { scope: 'install', ops: [{ op: 'hide', page: 'docker' }] })).status, 403);
  const bad = await asMember('POST', '/api/screen/layout', { scope: 'person', ops: [{ op: 'move', page: 'nowhere' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /No page "nowhere"\. Pages: controls \(Overview\)/, 'a refusal lists what exists');
  assert.match((await asMember('POST', '/api/screen/layout', { scope: 'person', ops: [{ op: 'hide', page: 'settings' }] })).body.error, /way back/);

  const inst = await H.api(null, 'POST', '/api/screen/layout', { scope: 'install', ops: [{ op: 'rename', group: 'machines', label: 'Boxes' }] });
  assert.equal(inst.status, 200, JSON.stringify(inst.body));
  assert.deepEqual(loadPrefs().panel, { rename: { machines: 'Boxes' } });
  assert.equal((await asMember('GET', '/api/screen/layout')).body.resolved.groups.find(g => g.id === 'machines').label, 'Boxes', 'everyone starts from it');
  await H.api(null, 'POST', '/api/screen/layout/undo', { scope: 'install' });
  assert.equal(loadPrefs().panel, undefined);
});

test('the agent: done at once when the person asked on their own turn, a card they decide otherwise, refused to a specialist', async () => {
  const ctx = { user: memberPerson(), screen: memberPhone.device.id, byPerson: true, sessionId: null };
  const shown = await tools.call('panel_layout', { action: 'show' }, [], ctx);
  assert.match(shown, /Workstream/);
  assert.match(shown, /Steps: /);
  assert.doesNotMatch(shown, /Terminal/, 'a member is not shown the machine\'s pages');

  const done = await tools.call('panel_layout', { action: 'change', asked: true, steps: [{ op: 'show', page: 'models' }, { op: 'style', density: 'roomy' }] }, [], ctx);
  assert.match(done, /^Done, as they asked \(theirs, on every device\)/);
  assert.deepEqual(layout.layers({ userId: member.user.id }).person.hidden, []);
  assert.equal(layout.layers({ userId: member.user.id }).person.style.density, 'roomy');

  const idea = await tools.call('panel_layout', { action: 'change', reason: 'You open Logs most', steps: [{ op: 'rename', page: 'archive', label: 'Old' }] }, [], { ...ctx, byPerson: false });
  assert.match(idea, /^Proposed \(p_/);
  assert.equal(layout.layers({ userId: member.user.id }).person.rename.archive, undefined, 'a suggestion writes nothing');
  const p = (await asMember('GET', '/api/harness/proposals')).body.pending.find(x => x.screen?.id === `person:${member.user.id}`);
  assert.ok(p, 'the member sees the card for their own layer');
  assert.equal((await asMember('POST', `/api/harness/proposals/${p.id}/apply`, {})).status, 200);
  assert.equal(layout.layers({ userId: member.user.id }).person.rename.archive, 'Old');

  assert.match(await tools.call('panel_layout', { action: 'change', asked: true, scope: 'install', steps: [{ op: 'hide', page: 'vms' }] }, [], ctx), /an admin's/);
  assert.match(await tools.call('panel_layout', { action: 'change', asked: true, scope: 'screen', steps: [] }, [], { ...ctx, screen: ownerTablet.device.id }), /someone else's/);
  assert.match(await tools.call('panel_layout', { action: 'show' }, [], {}), /no person on this turn/);
  assert.ok(require('../modules/agents/registry').NEVER.includes('panel_layout'), 'specialists report; they do not change a person\'s panel');
});

test('an edition carries a layout as everyone\'s default, checked like any other', () => {
  const edition = require('../modules/packs/edition');
  const it = edition.item({ format: 'doca-edition', look: { panel: { hidden: ['docker', 'ghost'], rename: { live: 'Screens' } } } });
  assert.match(edition.describe(it), /a layout: hidden: Docker; renamed: live → "Screens"/);
  edition.apply(it);
  assert.deepEqual(loadPrefs().panel, { hidden: ['docker'], rename: { live: 'Screens' } });
  layout.write('install', {}, {});
  assert.equal(loadPrefs().panel, undefined);
});

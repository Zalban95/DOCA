'use strict';

/**
 * Flow, the experience beside the looks (modules/experience, public/js/flow/*; docs/design/flow-experience.md): a
 * screen setting the agent may never propose, made whole on the way in and kept the same rule in the browser; the
 * pages it warms are warmed with the very functions nav() calls for them; its suggested groups keep every page, and
 * applying them is the person's own layout, undoable.
 */
const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const exp = require('../modules/experience');
const schema = require('../modules/settings-schema');
const D = require('../modules/panel-layout/defaults');

const js = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');

/** flow.js, warm.js and settings/experience.js in a sandbox with just enough of a page. */
function sandbox() {
  const store = {};
  const root = { dataset: {}, style: { setProperty() {} } };
  const ctx = { localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, document: { documentElement: root, getElementById: () => null }, performance, matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(`${js('nav.js')}\n${js('nav-groups.js')}\n${js('flow/flow.js')}\n${js('flow/warm.js')}\n${js('settings/experience.js')}\n
    flowWarmStart = () => {};
    this.out = { flowNormalize, FLOW_WARM, FLOW_SUGGESTED_GROUPS, flowSuggestedOps, NAV_TABS, root: document.documentElement, flowApply };`, ctx);
  return ctx.out;
}

before(() => H.start());
after(() => H.stop());

test('experience is a screen setting, standard by default, never proposable', () => {
  const d = schema.SCHEMA.experience;
  assert.equal(d.home, 'device'); assert.equal(d.on, 'screen');
  assert.ok(!d.propose && !d.screenPropose, 'a look is the person\'s');
  assert.ok(!schema.settable().some(s => s.prefix.startsWith('experience')));
  assert.ok(!schema.screenSettable().includes('experience'));
  for (const k of Object.keys(d.keys)) assert.equal(schema.unproposable(`experience.${k}`), `experience.${k}`);
  assert.deepEqual(exp.DEFAULTS, { mode: 'standard', warm: 'all', motion: 'gentle', groups: 'rail' });
});

test('a value is made whole: unknown choices and stray fields fall back, the browser keeps the same rule', () => {
  const { flowNormalize } = sandbox();
  const cases = [undefined, null, 'flow', [], {}, { mode: 'flow' }, { mode: 'FLOW', motion: 'fast' }, { mode: 'flow', warm: 'used', motion: 'none', groups: 'top', extra: 1 },
    { motion: 'quick', groups: 'rail', warm: 'all', mode: 'standard' }, { mode: { a: 1 } }];
  for (const c of cases) assert.deepEqual(JSON.parse(JSON.stringify(flowNormalize(c))), exp.normalize(c), JSON.stringify(c));
  assert.deepEqual(exp.normalize({ mode: 'flow', motion: 'fast', x: 1 }), { mode: 'flow', warm: 'all', motion: 'gentle', groups: 'rail' });
});

test('a screen saves it made whole, and reads it back', async () => {
  const r = await H.api(null, 'POST', '/api/screen/settings', { experience: { mode: 'flow', motion: 'warp', evil: '<x>' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = (await H.api(null, 'GET', '/api/screen')).body;
  assert.deepEqual(s.settings.experience, { mode: 'flow', warm: 'all', motion: 'gentle', groups: 'rail' });
  await H.api(null, 'POST', '/api/screen/settings', { experience: null });
  assert.equal((await H.api(null, 'GET', '/api/screen')).body.settings.experience, undefined, 'null puts it back: Standard');
});

test('Standard leaves no mark on the page; Flow marks it', () => {
  const s = sandbox();
  assert.deepEqual({ ...s.root.dataset }, {}, 'nothing for css/flow.css to match');
  s.flowApply({ mode: 'flow', motion: 'quick', groups: 'top' });
  assert.equal(s.root.dataset.experience, 'flow'); assert.equal(s.root.dataset.flowMotion, 'quick'); assert.equal(s.root.dataset.flowGroups, 'top');
  s.flowApply({ mode: 'standard' });
  assert.deepEqual({ ...s.root.dataset }, {});
});

test('every page warmed is warmed with the functions nav() calls for it, and none that opens a stream or a hold', () => {
  const { FLOW_WARM } = sandbox();
  const nav = js('nav.js');
  const NEVER = ['workstream', 'home', 'live', 'terminal', 'logs', 'files', 'projects', 'teams', 'chronicle', 'people', 'admin', 'ambient', 'meetings', 'vnc', 'map', 'nearby', 'computers'];
  for (const page of Object.keys(FLOW_WARM)) {
    assert.ok(!NEVER.includes(page), `${page} opens something only while shown`);
    const calls = [...String(FLOW_WARM[page]).matchAll(/\b([a-zA-Z_]+(?:Init|Tab|Card|Show))\(/g)].map(m => m[1]).filter(f => f !== 'harnessLoad');
    assert.ok(calls.length, `${page} names what it calls`);
    for (const f of calls) assert.match(nav, new RegExp(`on\\('${page}'\\)[^\\n]*\\b${f}\\(|FIELD_PAGES[^\\n]*${f}\\(`), `${f} is what nav() calls for ${page}`);
  }
});

test('the suggested groups keep every page once; applying them is the person\'s layout, and undo puts it back', async () => {
  const sb = sandbox(), FLOW_SUGGESTED_GROUPS = JSON.parse(JSON.stringify(sb.FLOW_SUGGESTED_GROUPS));
  const pages = FLOW_SUGGESTED_GROUPS.flatMap(g => g.tabs);
  assert.deepEqual([...pages].sort(), D.PAGES.filter(p => p !== 'settings').sort(), 'every page but Settings, which keeps its own group');
  assert.equal(new Set(pages).size, pages.length);
  for (const g of FLOW_SUGGESTED_GROUPS) assert.ok(D.GROUPS.some(d => d.id === g.id), `${g.id} is a group people's layouts already know`);
  const ops = JSON.parse(JSON.stringify(sb.flowSuggestedOps(D.PAGES)));
  assert.ok(ops.length <= 30, 'one change (panel-layout/ops.js takes 30 steps)');
  const r = await H.api(null, 'POST', '/api/screen/layout', { scope: 'person', ops });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = r.body.resolved.groups;
  for (const g of FLOW_SUGGESTED_GROUPS) assert.deepEqual(got.find(x => x.id === g.id).tabs, g.tabs, g.id);
  assert.equal(got.find(x => x.id === 'controls').label, 'Home');
  assert.deepEqual(got.find(x => x.id === 'settings').tabs, ['settings']);
  const back = await H.api(null, 'POST', '/api/screen/layout/undo', { scope: 'person' });
  assert.equal(back.status, 200);
  assert.deepEqual(back.body.resolved.groups.map(g => g.tabs), D.GROUPS.map(g => g.tabs), 'as shipped again');
});

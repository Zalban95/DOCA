'use strict';

// Every capability lands in /api/v1 too (modules/api-v1/coverage.js; TODO H11.3): each group of the panel's routes
// says where a device finds it, or why it is the panel's alone — and the device routes for what a person has in the
// hive (api-v1/yours.js: recipes, schedules, the face) answer as the device's person.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { COVERAGE } = require('../modules/api-v1/coverage');

let phone, viewer, agentDev;
before(async () => {
  await H.start();
  phone = H.mkDevice('Phone', 'phone', H.PHONE_CAPS);
  viewer = H.mkDevice('Viewer', 'viewer', {});
  agentDev = H.mkDevice('Bot', 'agent', {});
  // Devices are someone's: these are the owner's, as pairing from the panel makes them.
  for (const d of [phone, viewer, agentDev]) require('../modules/api-v1/devices').update(d.device.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
});
after(() => H.stop());

test('every group of the panel\'s routes says where its /api/v1 is, or why there is none', () => {
  const app = require('../server').createApp();
  const groups = new Set();
  for (const layer of app._router.stack) {
    const m = layer.route && typeof layer.route.path === 'string' && /^\/api\/([^/:(]+)/.exec(layer.route.path);
    if (m && m[1] !== 'v1') groups.add(m[1]);
  }
  assert.ok(groups.size > 30, 'the walk found the routes');
  const missing = [...groups].filter(g => !COVERAGE[g]);
  assert.deepEqual(missing, [], 'a new group of routes: say in api-v1/coverage.js where a device gets it (v1) or why it is the panel\'s (panel)');
  assert.deepEqual(Object.keys(COVERAGE).filter(g => !groups.has(g)), [], 'a row for routes that are gone');
  const paths = Object.keys(require('../docs/api/openapi.json').paths);
  for (const [g, row] of Object.entries(COVERAGE)) {
    assert.ok(row.v1 || row.panel, `${g}: v1 or panel`);
    for (const p of row.v1 || []) assert.ok(paths.some(x => x === p || x.startsWith(`${p}/`)), `${g}: ${p} is not in /api/v1`);
  }
});

const v1 = (token, method, p, body) => fetch(`${H.base}/api/v1${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

test('recipes: listed and run by a device as its person', async () => {
  const store = require('../modules/recipes/store');
  store.save({ id: 'say-hi', title: 'Say hi', params: [{ name: 'who' }], steps: [{ tool: 'memory_list', args: {} }] });
  const list = await v1(phone.token, 'GET', '/recipes');
  assert.equal(list.status, 200);
  assert.ok(list.body.recipes.some(r => r.id === 'say-hi'));
  const run = await v1(phone.token, 'POST', '/recipes/say-hi/run', { values: { who: 'Al' } });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(typeof run.body.ok, 'boolean');
  assert.equal((await v1(phone.token, 'POST', '/recipes/nope/run', {})).status, 404);
  assert.equal((await v1(viewer.token, 'GET', '/recipes')).status, 403);
});

test('schedules: the person\'s own; switching one on is a person\'s, an agent may only pause', async () => {
  const sch = require('../modules/schedules');
  const owner = require('../modules/harness/turn/client').deviceOwner(require('../modules/api-v1/devices').get(phone.device.id));
  const s = sch.create({ title: 'Morning', every: 60, message: 'Good morning' }, { person: owner, madeBy: 'agent' });
  assert.equal(s.state, 'proposed');
  const list = await v1(phone.token, 'GET', '/schedules');
  assert.ok(list.body.schedules.some(x => x.id === s.id));
  assert.equal((await v1(agentDev.token, 'POST', `/schedules/${s.id}/state`, { state: 'on' })).status, 403);
  const on = await v1(phone.token, 'POST', `/schedules/${s.id}/state`, { state: 'on' });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.state, 'on');
  assert.equal((await v1(phone.token, 'POST', `/schedules/${s.id}/state`, { state: 'sideways' })).status, 400);
  assert.equal((await v1(phone.token, 'POST', '/schedules/sch_nope/state', { state: 'on' })).status, 404);
});

test('the face: its state now, and as a stream', async () => {
  const now = await v1(phone.token, 'GET', '/face');
  assert.equal(now.status, 200);
  assert.ok(['idle', 'thinking', 'working', 'speaking', 'asking', 'error'].includes(now.body.state));
  const ctrl = new AbortController();
  const r = await fetch(`${H.base}/api/v1/face/stream`, { headers: { Authorization: `Bearer ${phone.token}` }, signal: ctrl.signal });
  assert.equal(r.headers.get('content-type'), 'text/event-stream');
  const first = new TextDecoder().decode((await r.body.getReader().read()).value);
  ctrl.abort();
  assert.match(first, /^data: \{"state":/);
  assert.equal((await v1(viewer.token, 'GET', '/face')).status, 403);
});

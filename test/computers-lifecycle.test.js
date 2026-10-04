'use strict';

// How long an agent's computer lives (modules/computers/lifecycle.js, TODO H13.2), and which computers' tools a
// conversation holds (turn/prompt.js othersComputers, H7.2d). No Docker: the container calls are stubbed.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let computers, lifecycle, store, utils, calls, states;
const row = (id, extra = {}) => ({ id, name: id, purpose: '', token: `tok-${id}`, vncPassword: 'pw', mcpPort: 1, vncPort: 2, createdAt: new Date().toISOString(), ...extra });

before(async () => {
  await H.start();
  computers = require('../modules/computers');
  lifecycle = require('../modules/computers/lifecycle');
  store = require('../modules/store');
  utils = require('../modules/utils');
  computers.list = async () => store.readJson('computers', { computers: [] }).computers.map(c => ({ id: c.id, state: states[c.id] || 'exited' }));
  computers.stop = async id => { calls.push(['stop', id]); };
  computers.remove = async id => { calls.push(['remove', id]); };
});
after(() => H.stop());
beforeEach(() => { calls = []; states = {}; store.writeJson('computers', { computers: [] }); const p = utils.loadPrefs(); delete p.computers; utils.savePrefs(p); });

const setLimits = v => { const p = utils.loadPrefs(); p.computers = v; utils.savePrefs(p); };

test('past computers.maxRunning a new computer is refused, naming the setting and what is running', async () => {
  store.writeJson('computers', { computers: [row('aa01'), row('aa02')] });
  states = { aa01: 'running', aa02: 'running' };
  setLimits({ maxRunning: 2 });
  await assert.rejects(lifecycle.roomForOne(), e => e.status === 409 && /computers\.maxRunning is 2/.test(e.message) && /aa01, aa02/.test(e.message));
  setLimits({ maxRunning: 3 });
  await lifecycle.roomForOne();
});

test('a computer stops after its mission ends — unless pinned or lent again', async () => {
  setLimits({ idleStopMinutes: 0 });
  store.writeJson('computers', { computers: [row('bb01', { missionId: 'msn_a' }), row('bb02', { missionId: 'msn_a', pinned: true }), row('bb03', { missionId: 'msn_b' })] });
  lifecycle.missionEnded('msn_a');
  lifecycle.missionEnded('msn_b');
  store.writeJson('computers', { computers: [row('bb01', { missionId: 'msn_a' }), row('bb02', { missionId: 'msn_a', pinned: true }), row('bb03', { missionId: 'msn_c' })] });   // bb03 lent again
  await H.sleep(30);
  assert.deepEqual(calls, [['stop', 'bb01']]);
});

test('what an agent made and nobody pinned is removed retainHours after it stopped; a person\'s is kept', async () => {
  setLimits({ retainHours: 1 });
  const old = new Date(Date.now() - 2 * 3600000).toISOString();
  store.writeJson('computers', { computers: [
    row('cc01', { auto: true, stoppedAt: old }),
    row('cc02', { auto: true, stoppedAt: old, pinned: true }),
    row('cc03', { auto: false, stoppedAt: old }),
    row('cc04', { auto: true, stoppedAt: new Date().toISOString() }),
    row('cc05', { auto: true, stoppedAt: old }),
  ] });
  states = { cc05: 'running' };
  assert.deepEqual(await lifecycle.sweep(), ['cc01']);
});

test('a person pins a computer from the panel; the agent sees its limits as settings it can propose', async () => {
  store.writeJson('computers', { computers: [row('dd01', { auto: true })] });
  const r = await H.api(null, 'POST', '/api/computers/dd01/pin', { pinned: true });
  assert.equal(r.status, 200);
  assert.equal(computers.get('dd01').pinned, true);
  await H.api(null, 'POST', '/api/computers/dd01/pin', { pinned: false });
  assert.equal(computers.get('dd01').pinned, false);
  const paths = require('../modules/harness/settings').readable().map(x => x.path);
  for (const k of ['maxRunning', 'idleStopMinutes', 'retainHours']) assert.ok(paths.includes(`computers.${k}`), k);
  assert.equal(require('../modules/harness/settings').refuse('computers.maxRunning', 6), null);
});

test('a conversation holds only its own computers\' tools: a work chat what it made, the Orchestrator none', () => {
  store.writeJson('computers', { computers: [row('ee01', { by: 'ses_work' }), row('ee02', { by: 'ses_other' })] });
  const { disabledFor } = require('../modules/harness/turn/prompt');
  const t = require('../modules/harness/tools');
  const real = t.describe;
  const names = ['mcp__computer-ee01__shell', 'mcp__computer-ee02__shell'];
  t.describe = () => [...real(), ...names.map(name => ({ name }))];
  try {
    const p = require('../modules/harness/agent').params();
    const work = disabledFor(null, p, 'ses_work');
    assert.ok(!work.includes(names[0]) && work.includes(names[1]), 'a work chat: the one it made');
    const orch = disabledFor({ level: 'orchestrator', kits: '*' }, p, 'ses_work');
    assert.ok(orch.includes(names[0]) && orch.includes(names[1]), 'the Orchestrator hands the work on');
    assert.ok(disabledFor(null, p).includes(names[0]), 'no conversation named: none');
  } finally { t.describe = real; }
});

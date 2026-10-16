'use strict';

// mini-swe-agent as a harness (asked 2026-10-16): its catalog row, that DOCA never runs it on the hub, that it is off
// until switched on, the Orchestrator's rule for offering it, and its trajectory read mechanically. Needs no Docker,
// no Python and no mini: the computer side is harness-teams.test.js's.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./helpers');

let catalog, harnesses;
const row = () => catalog.KNOWN.find(r => r.id === 'mini');
const setAllow = allow => { const u = require('../modules/utils'); const p = u.loadPrefs(); u.savePrefs({ ...p, teams: { ...(p.teams || {}), outside: { allow } } }); };

before(async () => {
  await H.start();
  catalog = require('../modules/harness/catalog');
  harnesses = require('../modules/harness-teams/harnesses');
});
after(() => H.stop());

test('its catalog row: found by `mini`, installed with uv on a click and undone the same way, a worker\'s argv as its --help says', async () => {
  const r = row();
  assert.equal(r.kind, 'cli');
  assert.equal(r.cmd, 'mini');
  assert.equal(r.installCmd, 'uv tool install mini-swe-agent');
  assert.equal(require('../modules/harness/harness-life').uninstallCmd(r), 'uv tool uninstall mini-swe-agent');
  assert.equal(r.sandbox, true);
  assert.equal(catalog.configFor('mini').launchCmd, 'mini', 'the Terminal launches it as a person would, where it asks before each command');
  assert.equal(catalog.defaultId(), 'doca', 'not a new default');
  assert.deepEqual(harnesses.argv(r, { task: 'fix it', output: '/home/agent/teams/w.traj.json' }),
    ['-y', '--exit-immediately', '-l', '0', '-o', '/home/agent/teams/w.traj.json', '-m', 'openai/default', '-t', 'fix it']);
  assert.deepEqual(harnesses.argv(r, { task: 't', model: 'deepseek/deepseek-chat' }),
    ['-y', '--exit-immediately', '-l', '0', '-m', 'openai/deepseek/deepseek-chat', '-t', 't'], 'no trajectory asked: no -o; a relay model through litellm\'s openai/');
  assert.equal(r.team.relay, true, 'its model is the hub\'s, through the relay');
  assert.ok(!r.team.key, 'no provider key is ever copied in for it');
  assert.equal(harnesses.npmPackage(r), null);
  assert.equal(r.team.uv, 'mini-swe-agent');
});

test('DOCA never runs it on the hub: no one-question road, and a stray adapter is refused', async () => {
  const shot = require('../modules/harness/one-shot');
  assert.equal(shot.adapterFor(row()), null);
  assert.match(shot.whyNot(row()), /only inside an agents' computer/);
  const r = await shot.ask({ kind: 'argv', cmd: 'mini', args: ['-y', '-t', '{message}'] }, { message: 'rm -rf ~' });
  assert.equal(r.code, 126);
  assert.match(r.error, /never on the hub/);
});

test('off until a person switches it on: installed here, or named in the allow list', () => {
  harnesses._found.clear();
  const saved = process.env.PATH;
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-nomini-'));
  try {
    assert.ok(!harnesses.offered().some(r => r.id === 'mini'), 'not offered by default');
    assert.throws(() => harnesses.find('mini'), e => e.status === 403 && /is off here/.test(e.message));
    assert.doesNotMatch(require('../modules/harness/coordinator').routing({ held: new Set(['team', 'work_chats']) }), /harness:mini/);
    setAllow(['mini']);
    assert.deepEqual(harnesses.offered().map(r => r.id), ['mini']);
    setAllow([]);
    const bin = path.join(process.env.PATH, process.platform === 'win32' ? 'mini.exe' : 'mini');
    fs.writeFileSync(bin, '#!/bin/sh\n'); fs.chmodSync(bin, 0o755);
    harnesses._found.clear();
    assert.ok(harnesses.offered().some(r => r.id === 'mini'), 'installed on the Harness tab: on');
    assert.equal(harnesses.find('mini-swe-agent').id, 'mini', 'found by its label too');
  } finally { fs.rmSync(process.env.PATH, { recursive: true, force: true }); process.env.PATH = saved; harnesses._found.clear(); setAllow([]); }
});

test('the Orchestrator\'s rule: when to offer it, before a work chat takes the job, and only on the person\'s yes', () => {
  setAllow(['mini']);
  try {
    const table = require('../modules/harness/coordinator').routing({ held: new Set(['team', 'work_chats']) });
    const at = table.indexOf('mini-swe-agent —');
    assert.ok(at > 0 && at < table.indexOf('A work chat'), 'offered before a work chat would take the coding job');
    assert.match(table, /self-contained coding task in a git project with a command that shows it works/);
    assert.match(table, /several tries at once/);
    assert.match(table, /offer it in one line, naming it/);
    assert.match(table, /`harness:mini`.*asked: true/);
    assert.match(table, /Not for work that needs DOCA's tools/);
    assert.match(table, /runs every command without asking/);
    // The gate is the teams' own: asked by the person, a host, a project — whatever the table said.
    const outside = require('../modules/teams/outside');
    const tasks = [{ id: 't1', agent: 'harness:mini', task: 'make the test pass', count: 3 }];
    assert.throws(() => outside.gate(tasks, { asked: false, project: { id: 'p' } }), e => e.status === 403);
    assert.throws(() => outside.gate(tasks, { asked: true, person: { id: 'u', role: 'member' }, project: { id: 'p' } }), /does not hold host/);
    const s = require('../modules/teams').shape({ title: 'Tries', tasks }, { workChats: true });
    assert.deepEqual(s.tasks.map(t => t.id), ['t1-1', 't1-2', 't1-3'], 'parallel tries are count');
  } finally { setAllow([]); }
  assert.match(require('../modules/harness/toolbox/teams').find(t => t.name === 'team').parameters.properties.asked.description, /said yes, on this turn, to your offer/);
});

test('its trajectory is read mechanically: commands, results by return code, its words, and how it ended', () => {
  const tr = require('../modules/harness-teams/trajectory');
  const msgs = [
    { role: 'system', content: 'You are…' }, { role: 'user', content: 'Please solve this issue: fix add' },
    { role: 'assistant', content: 'Run the tests first.', extra: { actions: [{ command: 'python -m pytest -q', tool_call_id: 'a' }] } },
    { role: 'tool', content: '<returncode>1</returncode>\n<output>\nF\nFAILED test_add.py::test_add\n</output>' },
    { role: 'assistant', content: 'Fixed the sign.', extra: { actions: [{ command: 'sed -i s/-/+/ add.py' }] } },
    { role: 'tool', content: '<returncode>0</returncode>\n<output>\n</output>' },
  ];
  const one = tr.read(JSON.stringify({ messages: msgs }), 0);
  assert.deepEqual(one.events.map(e => e.type), ['text', 'command', 'result', 'text', 'command', 'result']);
  assert.deepEqual(one.events[1], { type: 'command', text: 'python -m pytest -q' });
  assert.deepEqual(one.events[2], { type: 'result', ok: false, text: 'F' });
  assert.equal(one.events[5].ok, true);
  assert.equal(one.final, null);
  const done = [...msgs, { role: 'exit', content: '', extra: { exit_status: 'Submitted', submission: '' } }];
  const two = tr.read(JSON.stringify({ messages: done }), one.seen);
  assert.deepEqual(two.events, [], 'what was said is not said again');
  assert.deepEqual(two.final, { type: 'final', ok: true, text: 'Fixed the sign.' });
  const cut = tr.read(JSON.stringify({ messages: [...msgs, { role: 'exit', content: 'LimitsExceeded', extra: { exit_status: 'LimitsExceeded' } }] }), 0).final;
  assert.equal(cut.ok, false);
  assert.match(cut.text, /ended without finishing: LimitsExceeded/);
  assert.deepEqual(tr.read('{"messages": [', 3), { events: [], seen: 3, final: null }, 'caught half-written: nothing new yet');
});

test('its model is the relay\'s or nothing: refused, with where to switch it on, while the relay is off', async () => {
  const tr = require('../modules/harness-teams/trajectory');
  await assert.rejects(tr.relayEnv({ id: 'x' }, row()), e => e.status === 409 && /model relay, which is off/.test(e.message) && /Field → API keys → Model relay/.test(e.message));
  assert.deepEqual(await tr.relayEnv({ id: 'x' }, catalog.KNOWN.find(r => r.id === 'claude')), {}, 'a harness with its own key needs none');
});

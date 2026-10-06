'use strict';

/**
 * Real frames for the apps' parser tests (audit 2026-10-06, cl 21; TODO D2). DocaMobile's fixtures dated from hub
 * 2.10.1 and DocaWear's were written by hand, so a field the hub added (archivedAt, quiet, kind) was parsed by
 * neither. `npm run fixtures` (DOCA_WRITE_FIXTURES=1) drives the hub's own code — a mission running, finished and put
 * away, a work chat a person stopped, a question asked and withdrawn, a notice — and writes each frame a phone receives
 * to docs/api/fixtures/<name>.json. Without the variable this checks the files there: present, and every payload
 * field one the OpenAPI event schema declares, so a fixture cannot describe a field the contract does not.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H   = require('./helpers');
const bus = require('../modules/api-v1/bus');

const DIR = path.join(__dirname, '..', 'docs', 'api', 'fixtures');
const WRITE = process.env.DOCA_WRITE_FIXTURES === '1';
const NAMES = ['agent.mission-running', 'agent.mission-done', 'agent.mission-archived', 'agent.mission-work-stopped',
  'prompt.new', 'prompt.closed', 'alert'];

test.before(() => H.start());
test.after(() => H.stop());

async function frames() {
  const phone = H.mkDevice('Fixture phone', 'phone', H.PHONE_CAPS).device;
  const last = type => bus.drain(phone.id, 0).events.filter(e => e.type === type).at(-1);
  const out = {};
  const missions = require('../modules/agents/missions');
  const row = { id: 'msn_fixture', agentId: 'researcher', label: 'Researcher', task: 'Find the release notes of llama.cpp b6000',
    state: 'running', steps: 2, tokens: 8400, startedAt: '2026-10-06T18:00:00.000Z', plan: [{ title: 'Search', state: 'done' }, { title: 'Read the notes', state: 'running' }] };
  missions.announce(row); out['agent.mission-running'] = last('agent.mission');
  const done = { ...row, state: 'done', steps: 5, tokens: 21000, endedAt: '2026-10-06T18:04:00.000Z', result: 'b6000 adds the router mode.', plan: row.plan.map(p => ({ ...p, state: 'done' })) };
  missions.announce(done); out['agent.mission-done'] = last('agent.mission');
  missions.announce({ ...done, archivedAt: '2026-10-06T19:00:00.000Z' }, { quiet: true }); out['agent.mission-archived'] = last('agent.mission');

  const memory = require('../modules/harness/memory');
  const w = memory.createSession('Laya MCP server', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  memory.updateSession(w.id, { state: 'idle', job: { state: 'stopped', stoppedWhy: 'Stopped from the missions bar' } });
  require('../modules/harness/workview').announce(w.id); out['agent.mission-work-stopped'] = last('agent.mission');

  const reach = require('../modules/harness/reach');
  const ctrl = new AbortController();
  const asked = reach.ask({ to: phone.id, question: 'Restart the speech service?', choices: ['Restart', 'Leave it'], timeoutSec: 30, signal: ctrl.signal }).catch(() => null);
  await new Promise(r => setTimeout(r, 50));
  out['prompt.new'] = last('prompt.new');
  ctrl.abort(); await asked;
  out['prompt.closed'] = last('prompt.closed');
  reach.tell({ to: phone.id, title: 'The render finished', text: 'turbine-front.png is in the chat.' });
  out.alert = last('alert');
  return out;
}

test(WRITE ? 'writes the fixtures from real frames' : 'the fixtures are present and every field is in the contract', async () => {
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true });
    const f = await frames();
    for (const n of NAMES) {
      assert.ok(f[n], `no ${n} frame was published`);
      fs.writeFileSync(path.join(DIR, `${n}.json`), `${JSON.stringify({ type: f[n].type, class: f[n].class, payload: f[n].payload }, null, 2)}\n`);
    }
    return;
  }
  const doc = require('../modules/api-v1/openapi').document();
  const find = (o, k) => (o && typeof o === 'object' ? (o[k] || Object.values(o).map(v => find(v, k)).find(Boolean)) : null);
  for (const n of NAMES) {
    const file = path.join(DIR, `${n}.json`);
    assert.ok(fs.existsSync(file), `${n}.json missing: npm run fixtures`);
    const frame = JSON.parse(fs.readFileSync(file, 'utf8'));
    const schema = find(doc, frame.type);
    const props = Object.keys(schema?.payload?.properties || {});
    assert.ok(props.length, `${frame.type} has an event schema`);
    assert.deepEqual(Object.keys(frame.payload).filter(k => !props.includes(k)), [], `${n}: fields the contract does not declare`);
  }
});

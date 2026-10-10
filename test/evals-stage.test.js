'use strict';

// An evaluation set's stage (modules/evals, evals/stages): a set may name a shipped stage that puts stubs in the
// sandbox before its cases — the `frameworks` stage stands up the hi3d service at a local stand-in, Home Assistant and
// Blender MCP servers that only say "done", paired devices, a recipe and memories — and takes them down after. A stage
// never runs outside a sandbox. A case's `client` (a phone or a watch asking) is kept by validation.

const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

before(async () => { await H.start(); });
after(async () => { await H.stop(); });

test('validation keeps a case\'s client and a set\'s stage, and refuses a stage that is not shipped', () => {
  const store = require('../modules/evals/store');
  assert.ok(store.STAGES.includes('frameworks'));
  assert.ok(!store.STAGES.includes('mcp-stub'), 'a stub is not a stage');
  const v = store.validate({ id: 'x', stage: 'frameworks', cases: [{ id: 'a', prompt: 'p', client: 'phone', checks: [{ tool: 'remind' }] }] });
  assert.equal(v.stage, 'frameworks');
  assert.equal(v.cases[0].client, 'phone');
  assert.throws(() => store.validate({ id: 'x', stage: '../../x', cases: [{ id: 'a', prompt: 'p', checks: [{ tool: 'remind' }] }] }), /Stage is one of/);
  assert.equal(store.validate(store.get('reaches-frameworks')).cases.length >= 30, true);
});

test('a set with a stage refuses to run outside a sandbox', async () => {
  const was = process.env.DOCA_SANDBOX;
  delete process.env.DOCA_SANDBOX;
  try {
    await assert.rejects(require('../modules/evals/run').runSet({ id: 's', stage: 'frameworks', cases: [] }), /on a copy of the settings/);
  } finally { if (was !== undefined) process.env.DOCA_SANDBOX = was; }
});

test('the frameworks stage stands its stubs up and takes them down', async () => {
  process.env.DOCA_SANDBOX = H.tmp || require('../modules/store').DATA_DIR;
  try {
    const stage = await require('../evals/stages/frameworks').setup();
    const tools = require('../modules/harness/tools');
    assert.ok(require('../modules/api-services/store').list().some(s => s.name === 'hi3d'));
    const names = tools.schemas([]).map(s => s.function?.name || s.name);
    for (const n of ['service', 'mcp__home-assistant__HassTurnOff', 'mcp__blender__execute_blender_code', 'library_search']) assert.ok(names.includes(n), n);
    // A framework's call answers from its stand-in.
    assert.match(await tools.call('mcp__home-assistant__HassTurnOff', { area: 'living room' }, [], {}), /stand-in/);
    assert.match(await tools.call('service', { action: 'call', service: 'hi3d', operation: 'getBalance' }, [], {}), /totalBalance/);
    assert.match(await tools.call('hub_command', { action: 'run', id: 'services.restart', params: { id: 'whisper' } }, [], {}), /stand-in/);
    assert.ok(require('../modules/recipes/store').get('disk-space-report'));
    await stage.teardown();
    assert.doesNotMatch(String(await tools.call('hub_command', { action: 'run', id: '' }, [], {})), /stand-in/);
    assert.notEqual(require('../modules/mcp/registry').client('home-assistant')?.state, 'running');
  } finally { delete process.env.DOCA_SANDBOX; }
});

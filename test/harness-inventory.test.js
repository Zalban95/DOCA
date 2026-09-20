'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const tools = require('../modules/harness/tools');
const settings = require('../modules/harness/settings');
const memory = require('../modules/harness/memory');
const registry = require('../modules/agents/registry');
const mcp = require('../modules/mcp/registry');
const store = require('../modules/store');
const { loadPrefs } = require('../modules/utils');

before(H.start);
after(H.stop);

test('MCP inventory reports the owning machine without credentials or starting a connection', async () => {
  const { device } = H.mkDevice('Desktop upstairs', 'admin', { ...H.PHONE_CAPS, formFactor: 'other' });
  mcp.upsert({ label: 'Portal', transport: 'http', url: 'https://example.invalid/private-url-secret',
    headers: { Authorization: 'Bearer header-secret' }, origin: { kind: 'client', deviceId: device.id } });
  mcp.upsert({ label: 'Host tools', command: 'not-a-real-program', args: ['--token', 'arg-secret'],
    env: { TOKEN: 'env-secret' } });
  const before = loadPrefs();
  const out = await tools.call('mcp_status', {});
  assert.match(out, /Desktop upstairs/);
  assert.match(out, /DOCA host/);
  assert.match(out, /"state": "stopped"/);
  assert.match(out, /"backend": "unknown"/);
  assert.doesNotMatch(out, /header-secret|arg-secret|env-secret|private-url-secret|not-a-real-program/);
  assert.equal(mcp.client('portal'), null);
  assert.equal(mcp.client('host-tools'), null);
  assert.deepEqual(loadPrefs(), before);
  assert.ok(tools.schemas().some(t => t.function.name === 'mcp_status'));
  assert.match(await tools.call('mcp_status', {}, ['mcp_status']), /switched off/);
});

test('memory inventory filters and pages keys without touching their values or usage counters', async () => {
  memory.memWrite({ key: 'gpu', value: 'GPU first line\nHidden second line', category: 'Machine', pinned: true, locked: true });
  memory.memDispute('gpu', { note: 'Hardware changed' });
  memory.memWrite({ key: 'port', value: 'Connection port', category: 'machine' });
  memory.memWrite({ key: 'name', value: 'User name', category: 'user' });
  memory.memWrite({ key: 'legacy', value: 'Uncategorized fact' });
  const before = memory.memList();
  const out = await tools.call('memory_list', { category: ' MACHINE ', limit: 1 });
  assert.match(out, /1 of 2 memory entries/);
  assert.match(out, /"gpu" \[Machine; pinned, locked, disputed\]: GPU first line/);
  assert.match(out, /offset 1 and the same category/);
  assert.doesNotMatch(out, /Hidden second line|User name|Uncategorized fact/);
  assert.match(await tools.call('memory_list', { category: 'machine', offset: 1 }), /"port"/);
  assert.match(await tools.call('memory_list', { category: '' }), /"legacy" \[uncategorized\]/);
  assert.match(await tools.call('memory_list', { category: 'missing' }), /0 of 0/);
  assert.match(await tools.call('memory_list', { limit: 101 }), /Error: limit/);
  assert.match(await tools.call('memory_list', { offset: -1 }), /Error: offset/);
  assert.deepEqual(memory.memList(), before);

  memory.memWrite({ key: 'long', value: 'x'.repeat(4000) });
  const bounded = await tools.call('memory_list', {});
  assert.ok(bounded.length < 1000);
  assert.match(bounded, /x{200}…/);
  assert.ok(tools.schemas().some(t => t.function.name === 'memory_list'));
});

test('specialists are visible but stay off until a boolean proposal is accepted in the dashboard', async () => {
  assert.match(await tools.call('settings_read', { filter: 'agents' }), /agents\.enabled = false/);
  assert.equal(loadPrefs().agents?.enabled, undefined);
  const names = () => tools.schemas().map(t => t.function.name);
  assert.equal(names().includes('agent_dispatch'), false);
  for (const value of [null, 1, 'true', {}, []])
    assert.match(settings.refuse('agents.enabled', value), /boolean/);
  for (const path of ['agents', 'agents.enabled.command', 'agents.custom', 'mcpServers', 'harness.custom'])
    assert.match(settings.refuse(path, {}), /not a setting/);

  assert.match(await tools.call('settings_propose', {
    reason: 'Enable specialist help', changes: [{ path: 'agents.enabled', value: true }],
  }), /waiting for the user/);
  const proposal = settings.list().pending.at(-1);
  assert.equal(proposal.changes[0].from, false);
  assert.equal(registry.enabled(), false);
  const bare = await H.api(null, 'POST', `/api/harness/proposals/${proposal.id}/apply`, undefined,
    { 'Sec-Fetch-Site': '' });
  assert.equal(bare.status, 403);
  assert.equal(registry.enabled(), false);
  assert.equal((await H.api(null, 'POST', `/api/harness/proposals/${proposal.id}/apply`)).status, 200);
  assert.equal(registry.enabled(), true);
  assert.equal(names().includes('agent_dispatch'), true);

  const decline = settings.propose({ changes: [{ path: 'agents.enabled', value: false }] });
  settings.reject(decline.id, 'Keep specialists available');
  assert.equal(registry.enabled(), true);
  assert.match(settings.block(), /REJECTED: agents\.enabled.*Keep specialists available/);

  const tampered = settings.propose({ changes: [{ path: 'agents.enabled', value: false }] });
  const doc = store.readJson('harness/proposals');
  doc.proposals.find(p => p.id === tampered.id).changes[0].to = 'false';
  store.writeJson('harness/proposals', doc);
  assert.throws(() => settings.apply(tampered.id), /boolean/);
  assert.equal(registry.enabled(), true);
});

test('settings explain the lower compaction trigger without changing the configuration', async () => {
  const catalog = require('../modules/harness/catalog');
  catalog.saveConfig(catalog.BUILTIN_ID, { contextWindow: 1000000, compactTokens: 500000, compactAt: 60 });
  const before = loadPrefs();
  const out = await tools.call('settings_read', { filter: 'compact' });
  assert.match(out, /Effective token trigger: 500000 \(harness\.config\.doca\.compactTokens\)/);
  assert.deepEqual(loadPrefs(), before);
  catalog.saveConfig(catalog.BUILTIN_ID, { compactTokens: 800000 });
  assert.match(await tools.call('settings_read', { filter: 'compact' }),
    /Effective token trigger: 600000 \(harness\.config\.doca\.compactAt\)/);
});

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

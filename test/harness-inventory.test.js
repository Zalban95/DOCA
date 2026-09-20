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

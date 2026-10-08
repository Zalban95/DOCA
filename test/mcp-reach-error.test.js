'use strict';

/** An HTTP MCP server that cannot be reached is said as which server, where and why — not Node's bare "fetch failed". */
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { McpClient } = require('../modules/mcp/client');
const reachError = require('../modules/mcp/reach-error');

test('a refused connection names the server, the address and what to check, and keeps Node\'s words', async () => {
  const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const url = `http://127.0.0.1:${port}/mcp`;
  const c = new McpClient({ id: 'desk', transport: 'http', url });
  await c.start().catch(() => {});
  assert.match(c.error, new RegExp(`Could not reach "desk" at ${url.replace(/[.]/g, '\\.')}: nothing is listening there`));
  assert.match(c.error, /server is running on that machine/);
  assert.match(c.error, /\(fetch failed: ECONNREFUSED\)$/);
});

test('anything that is not a failed fetch passes through unchanged', () => {
  const e = new Error('HTTP 500 boom');
  assert.equal(reachError(e, 'x', 'http://x'), e);
  const t = Object.assign(new TypeError('fetch failed'), { cause: { code: 'SOMETHING_NEW' } });
  assert.match(reachError(t, 'x', 'http://x').message, /it did not answer.*\(fetch failed: SOMETHING_NEW\)/);
});

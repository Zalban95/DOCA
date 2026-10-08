'use strict';

/**
 * An HTTP MCP call waits as long as its own setting says (self-test round two, B2): fetch's undici cut every wait for
 * headers at 300 s, so an agents' computer given 600 s was dropped at half that and the error blamed the computer.
 * The transport is node:http now, with the caller's deadline the only one; a timeout says it timed out, which setting
 * governs it and that the work goes on — never "check that its server is running".
 */
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { McpClient } = require('../modules/mcp/client');

let server, url;
test.before(async () => {
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      const m = JSON.parse(b);
      const answer = result => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result })); };
      if (m.params?.slow) return setTimeout(() => answer({ waited: true }), 700);   // headers only after the work
      answer({ echo: m.method });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/mcp`;
});
test.after(() => { server.closeAllConnections?.(); server.close(); });

test('the call is not made through fetch, so undici\'s own header limit cannot cut it short', async () => {
  const real = global.fetch;
  global.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }); };
  try {
    const c = new McpClient({ id: 'computer-ab12', transport: 'http', url });
    assert.deepEqual(await c.request('tools/call', { slow: true }, 5000), { waited: true }, 'it waits for headers as long as it was told');
  } finally { global.fetch = real; }
});

test('a timeout says it timed out, names its setting, and that the work goes on', async () => {
  const c = new McpClient({ id: 'computer-ab12', transport: 'http', url });
  const t = await c.request('tools/call', { slow: true }, 200).then(() => null, x => x);
  assert.ok(t, 'it stopped waiting at its deadline');
  assert.match(t.message, /^tools\/call timed out after 0s waiting for "computer-ab12"/);
  assert.match(t.message, /computers\.callTimeoutMs/, 'a computer\'s call names the computers\' setting');
  assert.match(t.message, /stopped the waiting, not the work/);
  assert.doesNotMatch(t.message, /server is running|Could not reach/);
  assert.deepEqual(await c.request('tools/list', {}, 1000), { echo: 'tools/list' }, 'and the next call is answered');
});

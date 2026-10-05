'use strict';

// What the agent can reach without a person doing it for it (2026-10-05): a stopped MCP server a person set up is
// named in the prompt with what it last offered, and `mcp_connect` starts it — never adds or changes one; missions
// do not get it.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./helpers');

const STUB = path.join(__dirname, 'fixtures', 'mcp-stub-server.js');
before(async () => {
  await H.start();
  const r = await H.api(null, 'POST', '/api/mcp', { id: 'otherbox', label: 'Other box', transport: 'stdio', command: process.execPath, args: [STUB] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
after(async () => { require('../modules/mcp/registry').stop('otherbox'); await H.stop(); });

const env = () => require('../modules/harness/environment').block();

test('the agent connects a server a person set up, and is told what a stopped one would give it', async () => {
  const tools = require('../modules/harness/tools');
  assert.match(env(), /- otherbox: stopped, on this host[^\n]*— `mcp_connect` starts it/);
  assert.match(await tools.call('mcp_connect', { server: 'nope', action: 'start' }), /no MCP server "nope"/);
  const out = await tools.call('mcp_connect', { server: 'otherbox', action: 'start' });
  assert.match(out, /Connected to otherbox: \d+ tools/);
  assert.ok(tools.schemas().some(t => t.function.name === 'mcp__otherbox__echo'), 'its tools are there on the next step');
  assert.match(await tools.call('mcp_connect', { server: 'otherbox', action: 'stop' }), /Disconnected/);
  require('../modules/harness/environment').invalidate?.();
  assert.match(env(), /- otherbox: stopped[^\n]*when connected it offered [^\n]*echo[^\n]*— `mcp_connect` starts it/);
});

test('connecting is something a mission never does, and Manual mode asks about it', () => {
  assert.ok(require('../modules/agents/registry').NEVER.includes('mcp_connect'));
  assert.ok(!require('../modules/harness/approval').FREE.has('mcp_connect'), 'not free: it reaches another machine');
});

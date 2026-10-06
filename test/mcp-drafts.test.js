'use strict';

/** MCP servers the agent prepared (modules/mcp/drafts.js): a draft a person opens in the form, never a server. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const tools = require('../modules/harness/tools');

test.before(() => H.start());
test.after(() => H.stop());

test('the agent drafts any server; nothing is added or run; secrets are names only; a person dismisses it', async () => {
  const before = (await H.api(null, 'GET', '/api/mcp')).body.servers.length;
  const out = await tools.call('mcp_draft', { name: 'fusion360', transport: 'http', url: 'http://127.0.0.1:27182/mcp', headers: ['Authorization'],
    env: { FUSION_TOKEN: 'leaked-value', PORT: 27182 }, where: 'the design PC', why: 'Lets the agents model parts in Fusion 360.' }, [], { sessionId: 's1' });
  assert.match(out, /Drafted "fusion360".*fills FUSION_TOKEN, Authorization/s);
  const d = (await H.api(null, 'GET', '/api/mcp/drafts')).body.drafts;
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].env, { FUSION_TOKEN: '', PORT: '27182' }, 'a secret\'s value is never kept, a setting\'s is');
  assert.equal((await H.api(null, 'GET', '/api/mcp')).body.servers.length, before, 'no server was added');
  assert.match(await tools.call('mcp_draft', { name: 'x', transport: 'stdio', why: 'y' }, [], {}), /needs its command/);
  assert.ok(require('../modules/agents/registry').NEVER.includes('mcp_draft'), 'a mission reports, it does not propose');
  assert.equal((await H.api(null, 'DELETE', `/api/mcp/drafts/${d[0].id}`)).body.removed, true);
  assert.equal((await H.api(null, 'GET', '/api/mcp/drafts')).body.drafts.length, 0);
  const member = await H.signIn('member', 'draft-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/mcp/drafts', undefined, { Cookie: member.cookie })).status, 403);
});

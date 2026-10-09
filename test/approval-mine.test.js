'use strict';

/**
 * Every question waiting for a person is listed for them (deep test A, 2026-10-08): a member's own level card ("the
 * level of the person this turn acts for asks before every tool call") and their own budget card were answerable by id
 * but absent from GET /api/harness/approval, which gave anyone without host only a mission's machine questions — so a
 * member who reloaded, or whose turn came from another device, had a turn waiting on a question they could not see.
 * Now `mine` (and, without host, `pending`) carries them; the Approvals window and the questions dock draw them.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const approval = require('../modules/harness/approval');

let member;
test.before(async () => { await H.start(); member = await H.signIn('member', 'approval-mine@test.local'); });
test.after(() => H.stop());

test('a member sees their own level and budget cards, never someone else\'s, and answers them', async () => {
  const level = approval.ask({ tool: 'list_dir', keys: ['list_dir'], level: true, summary: 'list_dir ~ — the level asks', personId: member.user.id }, {});
  const budget = approval.ask({ tool: 'going over your budget', keys: null, forced: true, budget: true, summary: 'over it', personId: member.user.id }, {});
  const owners = approval.ask({ tool: 'shell', keys: ['shell:ls'], summary: 'ls', personId: H.owner.user.id }, {});
  const as = (method, path, body) => H.api(null, method, path, body, { Cookie: member.cookie });

  const r = await as('GET', '/api/harness/approval');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.mine.map(p => p.id).sort(), [level.id, budget.id].sort());
  assert.deepEqual(r.body.pending.map(p => p.id).sort(), [level.id, budget.id].sort(), 'the Approvals window lists them');
  assert.ok(!r.body.always, 'the mode\'s lists stay an admin\'s');

  const host = await H.api(null, 'GET', '/api/harness/approval');
  assert.deepEqual(host.body.mine.map(p => p.id), [owners.id], 'a host\'s own waiting questions too');
  assert.equal(host.body.pending.length, 3, 'a host still sees every one');

  assert.equal((await as('POST', `/api/harness/approvals/${budget.id}`, { decision: 'once' })).status, 200);
  assert.equal(await budget.answer, 'once');
  assert.equal((await as('POST', `/api/harness/approvals/${owners.id}`, { decision: 'once' })).status, 403);
  for (const x of [level, owners]) approval.decide(x.id, 'deny');
});

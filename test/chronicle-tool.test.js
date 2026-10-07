'use strict';

/**
 * Chronicle for the agent (toolbox/chronicle.js; TODO B6b, audit aw 10): what happened — runs, the story of a piece of
 * work, the harness log — read through Chronicle's own functions, so each person's agent sees only what that person
 * may see, and the harness log only a host's.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H      = require('./helpers');   // first: it points the settings at a temporary folder
const tools  = require('../modules/harness/tools');
const memory = require('../modules/harness/memory');
const runs   = require('../modules/harness/runs');

let member, mine, theirs;
test.before(async () => {
  await H.start();
  member = await H.signIn('member', 'chronicle-tool-member@test.local');
  mine = memory.createSession('Fix the garden lights', { activate: false });
  memory.updateSession(mine.id, { person: { id: member.user.id, orgId: member.orgId } });
  theirs = memory.createSession('Owner\'s tax return', { activate: false });
  memory.updateSession(theirs.id, { person: { id: H.owner.user.id, orgId: H.owner.orgId } });
  const a = runs.begin({ sessionId: mine.id, personId: member.user.id });
  runs.end(a, { state: 'failed', outcome: 'The relay did not answer.', steps: 3, tokens: 1200 });
  const b = runs.begin({ sessionId: theirs.id, personId: H.owner.user.id });
  runs.end(b, { state: 'done', outcome: 'Filed.', steps: 1, tokens: 300 });
});
test.after(() => H.stop());

const owner = () => ({ ...H.owner.user, role: 'owner', orgId: H.owner.orgId });
const mem = () => ({ ...member.user, role: 'member', orgId: member.orgId });
const call = (args, user) => tools.call('chronicle', args, [], { user, sessionId: null });

test('find: a host sees every run; a member only their own conversations\' runs', async () => {
  const all = await call({ action: 'find', since: '1h' }, owner());
  assert.match(all, /failed — Work chat: Fix the garden lights · member · 1,200 tokens · 3 steps/);
  assert.match(all, /Owner's tax return/);
  const theirsOnly = await call({ action: 'find' }, mem());
  assert.match(theirsOnly, /Fix the garden lights[\s\S]*The relay did not answer\./);
  assert.doesNotMatch(theirsOnly, /tax return/);
  assert.match(await call({ action: 'find', q: 'nothing-like-this' }, owner()), /^Nothing in the chronicle for "nothing-like-this"/);
});

test('story: one conversation told from its runs; another person\'s is absent; the harness log is a host\'s', async () => {
  const s = await call({ action: 'story', conversation: mine.id }, mem());
  assert.match(s, /^Fix the garden lights/);
  assert.match(s, /1 run · 3 steps/);
  assert.match(await call({ action: 'story', conversation: theirs.id }, mem()), /^Error: Nothing like that in the chronicle/);
  assert.match(await call({ action: 'story' }, mem()), /needs run, conversation or mission/);
  assert.match(await call({ action: 'find', source: 'log' }, mem()), /The harness log is an admin's/);
});

test('it only reads: not a mission\'s refusal, not work for the hand-off, in the memory kit', () => {
  assert.ok(!require('../modules/agents/registry').NEVER.includes('chronicle'));
  assert.equal(require('../modules/harness/kits').kitOf('chronicle'), 'memory');
  assert.equal(require('../modules/harness/turn/handoff').isWork({ function: { name: 'chronicle', arguments: '{"action":"find"}' } }), false);
});

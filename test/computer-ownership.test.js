'use strict';

// Whose computer is it (security review 2026-10-07; modules/computers/whose.js; CONSTITUTION S13): a member's agents
// act only on a computer their person made, or one lent to their mission — never on an admin's (a kept specialist's
// computer holds its browser profile and sign-ins). Fake rows stand in for the containers: every refusal comes first.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let user, own, other;
before(async () => {
  await H.start();
  const m = await H.signIn('member', 'computers-member@test.local');
  user = { ...m.user, role: 'member' };
  const memory = require('../modules/harness/memory'), access = require('../modules/harness/session-access');
  own = memory.createSession('member work', { activate: false });
  access.claim(user, own.id);
  other = memory.createSession('owner work', { activate: false });
  access.claim({ ...H.owner.user, role: 'owner' }, other.id);
  const row = (id, extra) => ({ id, name: id, token: 'tok', mcpPort: 1, vncPort: 2, servePort: 3, createdAt: new Date().toISOString(), ...extra });
  require('../modules/store').writeJson('computers', { computers: [
    row('kept01', { agentType: 'tester' }), row('owner01', { by: other.id }), row('mine01', { by: own.id })] });
});
after(() => H.stop());

const tool = name => [...require('../modules/harness/toolbox/computers'), ...require('../modules/harness/toolbox/agents')].find(t => t.name === name);

test('the computer tool: a member lists and acts on their own computer only', async () => {
  const run = a => tool('computer').run(a, { user, sessionId: own.id });
  for (const action of ['start', 'stop', 'remove', 'put', 'get'])
    for (const id of ['kept01', 'owner01'])
      assert.match(await run({ action, id, path: 'x', attachment: 'x' }), /^Error: Computer \w+ "\w+" is not .*'s/, `${action} ${id}`);
  const whose = require('../modules/computers/whose');
  assert.equal(whose.refuse(user, 'mine01'), null, 'made by their conversation');
  assert.equal(whose.refuse({ ...H.owner.user, role: 'owner' }, 'kept01'), null, 'an admin acts on any');
  assert.equal(whose.refuse(null, 'kept01'), null, 'no person on the turn is not narrowed');
});

test('looking, signing in, previewing and lending refuse another person\'s computer', async () => {
  const ctx = { user, sessionId: own.id };
  await assert.rejects(tool('computer_look').run({ computer: 'kept01', question: 'what?' }, ctx), e => e.status === 403);
  await assert.rejects(tool('computer_login').run({ computer: 'kept01', login: 'x', passRef: 1 }, ctx), e => e.status === 403);
  assert.throws(() => require('../modules/canvas/previews').create({ computer: 'owner01', person: user }), e => e.status === 403);
  assert.equal(require('../modules/canvas/previews').create({ computer: 'mine01', person: user }).port, 3, 'their own computer\'s page');
  assert.match(await tool('agent_dispatch').run({ agent: 'tester', task: 'look around', computer: 'kept01' }, ctx), /^Error: Computer kept01/);
});

test('a computer lent to their mission is theirs to act on while it is lent', async () => {
  const missions = require('../modules/agents/missions');
  const orig = missions.get;
  missions.get = id => (id === 'mis_member' ? { id, sessionId: own.id, by: own.id } : orig(id));
  try {
    const store = require('../modules/store');
    const rows = store.readJson('computers', { computers: [] }).computers.map(c => (c.id === 'kept01' ? { ...c, missionId: 'mis_member' } : c));
    store.writeJson('computers', { computers: rows });
    assert.equal(require('../modules/computers/whose').refuse(user, 'kept01'), null);
  } finally { missions.get = orig; }
});

'use strict';

/**
 * A person's own turn (CONSTITUTION S1; turn/tool-calls.js byPerson): the main chat counts — the Orchestrator's profile
 * is the conversation a person writes in — while a paired agent, a mission or specialist and an automatic turn do not.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('the Orchestrator\'s chat is a person\'s own turn; agents, missions, specialists and automatic turns are not', () => {
  const { byPerson } = require('../modules/harness/turn/tool-calls');
  const person = { user: { id: 'u1' }, kind: 'browser' };
  const orch = { level: 'orchestrator' };
  assert.equal(byPerson({ client: person, profile: orch, sessionId: 's1' }), true, 'the main chat');
  assert.equal(byPerson({ client: person, profile: null, sessionId: 's1' }), true, 'a work chat a person writes in');
  assert.equal(byPerson({ client: { ...person, kind: 'agent' }, profile: orch, sessionId: 's1' }), false);
  assert.equal(byPerson({ client: person, isMission: true, profile: { id: 'coder' }, sessionId: 's1' }), false);
  assert.equal(byPerson({ client: person, profile: { id: 'coder' }, sessionId: 's1' }), false, 'a specialist');
  assert.equal(byPerson({ client: { kind: 'browser' }, profile: orch, sessionId: 's1' }), false, 'no person');
  const lifecycle = require('../modules/harness/turn/lifecycle');
  lifecycle.running.set('s-auto', { auto: true });
  try { assert.equal(byPerson({ client: person, profile: orch, sessionId: 's-auto' }), false, 'an automatic turn'); }
  finally { lifecycle.running.delete('s-auto'); }
});

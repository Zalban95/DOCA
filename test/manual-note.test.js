'use strict';

/**
 * Long work in Manual says what Manual costs and offers Auto (modules/harness/manual-note.js), and a job handed on
 * from the main chat carries who asked, so the worker's turn reading their own words acts for them on what they asked
 * (turn/tool-calls.js askerOf; the owner, 2026-10-12).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('in Manual a job\'s acknowledgement offers Auto and says the price; in Auto it says nothing more', () => {
  const approval = require('../modules/harness/approval');
  const note = require('../modules/harness/manual-note');
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('manual note');
  assert.equal(note.note(s.id), '', 'Auto: nothing added');
  approval.setMode('manual');
  try {
    assert.match(note.note(s.id), /Manual.*stop for your yes.*takes longer.*Auto/s);
    assert.match(note.note(s.id, { spoken: true }), /Want Auto for this\?/);
  } finally { approval.setMode('auto'); }
});

test('a handed-on job\'s turn acts for the person who asked; a supervisor\'s wake does not', () => {
  const { askerOf } = require('../modules/harness/turn/tool-calls');
  const person = { id: 'usr_x', name: 'Ann', role: 'owner' };
  const work = { level: 'work' };
  assert.equal(askerOf([], { client: { name: 'Delegated by Orchestrator', kind: 'agent', askedBy: person }, profile: work }), person, 'the first turn reads their request');
  assert.equal(askerOf([{ client: { kind: 'agent', askedBy: person } }], { client: { name: 'Panel', kind: 'agent' }, profile: work }), person, 'their added step, read by a running turn');
  assert.equal(askerOf([], { client: { name: 'Panel', kind: 'agent' }, profile: work }), null, 'a wake carries nobody');
  assert.equal(askerOf([], { client: { kind: 'agent', askedBy: person }, profile: { level: 'specialist' } }), null, 'never a specialist');
  assert.equal(askerOf([], { client: { kind: 'agent', askedBy: person }, profile: work, isMission: true }), null, 'never a mission');
});

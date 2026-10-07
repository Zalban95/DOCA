'use strict';

/**
 * The agent is told its limits by name and path (budget.block, charter rule 12), in the prompt it is actually sent —
 * the Orchestrator's, a work chat's and a specialist's. H-9 (2.x) moved the running ledger after the history and took
 * the static block out of every prompt with it; only the prompt-breakdown screen still measured it.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('every kind of turn is told "# Your limits", once, ahead of the history', () => {
  const agent = require('../modules/harness/agent');
  const memory = require('../modules/harness/memory');
  const main = memory.mainSession();
  const work = memory.createSession('A job', { activate: false, kind: 'work', parentId: main.id });
  for (const [who, id] of [['the Orchestrator', main.id], ['a work chat', work.id]]) {
    const prompt = agent.preview({ message: 'hi', sessionId: id });
    assert.equal(prompt.split('# Your limits').length - 1, 1, `${who} is told its limits once`);
    assert.match(prompt, /tool steps: \d+ per turn \(harness\.config\.doca\.maxSteps\)/);
  }
});

'use strict';

/**
 * Experiment toolTiers (turn/tool-tiers.js; TODO B2): core tools sent in full, the rest named and loaded when needed —
 * what is held never changes.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H           = require('./helpers');
const agent       = require('../modules/harness/agent');
const memory      = require('../modules/harness/memory');
const tools       = require('../modules/harness/tools');
const experiments = require('../modules/experiments');
const tiers       = require('../modules/harness/turn/tool-tiers');
const { disabledFor } = require('../modules/harness/turn/prompt');

test.before(() => H.start());
test.after(() => H.stop());

const held = id => tools.schemas(disabledFor(null, {}, id));

test('off: everything is sent, and tools_more does not exist', () => {
  const w = require('../modules/harness/organization').create({ title: 'tiers off' });
  const { offered, named } = tiers.split(held(w.id), { sessionId: w.id });
  assert.equal(named.length, 0);
  assert.ok(!offered.some(s => s.function.name === 'tools_more'));
});

test('on: core in full, the rest named; a message, a call or tools_more loads one for the conversation', async () => {
  experiments.setDeveloper(true);
  experiments.set('toolTiers', true);
  try {
    const w = require('../modules/harness/organization').create({ title: 'tiers on' });
    let { offered, named } = tiers.split(held(w.id), { sessionId: w.id });
    const sent = offered.map(s => s.function.name);
    assert.ok(sent.includes('read_file') && sent.includes('tools_more') && !sent.includes('memory_rules_write'));
    assert.ok(named.some(s => s.function.name === 'memory_rules_write'));
    assert.match(agent.preview({ message: 'x', sessionId: w.id }), /More tools you hold, not loaded yet — tools_more .*memory_rules_write/);

    tiers.split(held(w.id), { sessionId: w.id, text: 'please use canvas for this' });
    assert.ok(tiers.attached(w.id).has('canvas'), 'named in the message');

    assert.match(await tools.call('tools_more', { names: ['schedule', 'nonsense'] }, [], { sessionId: w.id }), /Loaded from your next step: schedule\. Not tools you hold: nonsense/);
    ({ offered } = tiers.split(held(w.id), { sessionId: w.id }));
    assert.ok(offered.some(s => s.function.name === 'schedule'));

    assert.equal(tiers.heldNotSent('memory_list', []), true, 'held but not sent still runs when called');
    tiers.afterCall(w.id, null, 'memory_list', 'ok', []);
    assert.ok(tiers.attached(w.id).has('memory_list'), 'and stays loaded');
    tiers.afterCall(w.id, null, 'skill', 'Step 2: keep it with `pack` {save}.', []);
    assert.ok(tiers.attached(w.id).has('pack'), 'a skill that names a tool loads it');

    const specialist = { id: 'x', level: 'specialist', tools: ['read_file'] };
    assert.equal(tiers.split(held(w.id), { sessionId: w.id, profile: specialist }).named.length, 0, 'specialists keep their own lists');
  } finally { experiments.set('toolTiers', false); }
});

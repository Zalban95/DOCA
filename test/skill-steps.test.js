'use strict';

/**
 * A skill read is a skill followed (TODO B7c (2); turn/skill-steps.js): the steps of a skill this turn read come back
 * in its readings as a checklist, with how to depart from one — taken from the turn's own rows, never stored.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('the steps of a skill this turn read are its checklist; other rows give none', () => {
  const steps = require('../modules/harness/turn/skill-steps');
  const read = require('../modules/harness/tools').call('skill', { action: 'read', name: 'android-app' });
  return read.then(content => {
    const rows = [{ role: 'user', content: 'build my app' }, { role: 'tool', name: 'skill', content }];
    const b = steps.block(rows);
    assert.match(b, /^# Following the skill android-app: 1\. Check the machine · 2\. Build/);
    assert.match(b, /say which step and why/);
    assert.equal(steps.block([{ role: 'tool', name: 'read_file', content: '# x\n1. **A** step' }]), '');
    assert.equal(steps.block([{ role: 'tool', name: 'skill', content: 'No skills yet.' }]), '', 'a list is not a read');
    assert.deepEqual(steps.stepsOf('1. **One** first.\n2. Two: then\n  3. Three.\nnot a step'), ['One', 'Two', 'Three']);
    const fits = require('../modules/harness/turn/fits').block({ message: 'build my app', schemas: [{ function: { name: 'skill' } }], rows });
    assert.match(fits, /# Following the skill android-app/);
  });
});

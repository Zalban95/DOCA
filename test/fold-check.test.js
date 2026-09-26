'use strict';

/**
 * A config whose token folding cannot fire is said so (harness/fold-check.js).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H      = require('./helpers');
const check  = require('../modules/harness/fold-check');
const budget = require('../modules/harness/budget');

test.before(() => H.start());
test.after(() => H.stop());

test('the rules: past the window, far too late, or fine', () => {
  assert.match(check.warning({ contextWindow: 1000000, compactTokens: 500000, compactAt: 60 }), /starts only at 500000 tokens .*compactTokens/);
  assert.match(check.warning({ contextWindow: 32000, compactTokens: 0, compactAt: 100 }), /can never fire: it starts at 32000 tokens .*compactAt/);
  assert.equal(check.warning({ contextWindow: 1000000, compactTokens: 40000, compactAt: 60 }), null);
  assert.equal(check.warning({ contextWindow: 0, compactTokens: 0 }), null, 'no token trigger: message count only, nothing to warn about');
  assert.match(budget.block({ contextWindow: 1000000, compactTokens: 500000, compactAt: 60, maxSteps: 8, historyTurns: 20, summarizeAfter: 40, memoryLimit: 20 }),
    /Warning: Token folding starts only at 500000/, 'the agent is told, so it can propose the fix');
});

test('saving such a config answers with the warning, and the harness list carries it', async () => {
  const saved = await H.api(null, 'POST', '/api/harness/doca/config', { contextWindow: 1000000, compactTokens: 500000 });
  assert.match(saved.body.foldWarning, /starts only at 500000/);
  const list = await H.api(null, 'GET', '/api/harness');
  assert.match(list.body.harnesses.find(h => h.id === 'doca').foldWarning, /500000/);
  const fixed = await H.api(null, 'POST', '/api/harness/doca/config', { contextWindow: 0, compactTokens: 40000 });
  assert.equal(fixed.body.foldWarning, null);
});

'use strict';

// Submits, payments and logins in a computer's browser are a person's (TODO H5.4): the computer classifies the
// control (clients/computer/tools.js sensitive()) and refuses a decision without confirm and a secret field outright;
// the hub asks about a confirmed call in every mode (harness/approval.js gate).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { sensitive } = require('../clients/computer/tools');

before(() => H.start());
after(() => H.stop());

const el = (o = {}) => ({ tagName: 'INPUT', getAttribute: k => o.attrs?.[k] ?? null, ...o });
const formWith = secret => ({ querySelector: () => (secret ? {} : null) });

test('a password or card field is a secret; a pay, sign-in or secret-holding submit is a decision; the rest is neither', () => {
  assert.deepEqual(sensitive(el({ type: 'password' })), { kind: 'secret' });
  assert.deepEqual(sensitive(el({ type: 'text', attrs: { autocomplete: 'cc-number' } })), { kind: 'secret' });
  assert.deepEqual(sensitive(el({ tagName: 'BUTTON', innerText: 'Pay now' })), { kind: 'decision', label: 'Pay now' });
  assert.deepEqual(sensitive(el({ tagName: 'A', innerText: 'Sign in' })), { kind: 'decision', label: 'Sign in' });
  assert.deepEqual(sensitive(el({ tagName: 'BUTTON', innerText: 'Continue', form: formWith(true) })), { kind: 'decision', label: 'Continue' });
  assert.equal(sensitive(el({ tagName: 'BUTTON', innerText: 'Continue', form: formWith(false) })), null);
  assert.equal(sensitive(el({ tagName: 'A', innerText: 'Pricing' })), null, 'reading about payment is not paying');
  assert.equal(sensitive(el({ type: 'search', attrs: { autocomplete: 'off' } })), null);
});

test('a confirmed decision in a computer\'s browser is asked in every mode, never "always"', async () => {
  const approval = require('../modules/harness/approval');
  for (const mode of ['auto', 'unattended']) {
    await H.api(null, 'POST', '/api/harness/approval', { mode, confirmUnattended: true });
    const g = approval.gate('mcp__computer-ab12cd34__browser_click', { ref: 7, confirm: true });
    assert.equal(g?.forced, true, mode);
    assert.equal(g.keys, null, 'no "always" for it');
    assert.equal(approval.gate('mcp__computer-ab12cd34__browser_click', { ref: 7 }), null, `${mode}: an ordinary click runs`);
  }
  await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' });
});

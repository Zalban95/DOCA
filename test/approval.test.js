'use strict';

/**
 * Manual approval: what may run, what must be asked, and what cannot be
 * reduced to a rule at all.
 *
 * The interesting cases are the ones where a naive gate says yes: a chained
 * command whose first word is allowed and whose second is not, a command
 * assembled by substitution, and an agent trying to grant itself the mode.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const approval = require('../modules/harness/approval');
const settings = require('../modules/harness/settings');

before(H.start);
after(H.stop);
beforeEach(() => { approval.setMode('auto'); approval.settings().always.forEach(approval.forget); });

test('auto is the default, so nothing changes for anyone until they ask for it', () => {
  assert.equal(approval.settings().mode, 'auto');
  assert.equal(approval.gate('shell', { command: 'rm -rf /' }), null,
    'in auto mode the gate is not a gate — that is the mode');
});

test('manual asks about work, and never about reading this panel\'s own state', () => {
  approval.setMode('manual');
  assert.ok(approval.gate('shell', { command: 'git status' }), 'a command is asked about');
  assert.ok(approval.gate('write_file', { path: 'x' }),        'so is a write');
  assert.ok(approval.gate('http_fetch', { url: 'https://x' }), 'and so is leaving the machine');

  // Gating these buys nothing and costs a question every few seconds, which is
  // how a person learns to click Allow without reading.
  for (const free of ['system_status', 'memory_list', 'settings_read', 'doca_clients'])
    assert.equal(approval.gate(free, {}), null, `${free} reads this app and nothing else`);
});

test('a remembered verb allows that verb, and only that verb', () => {
  approval.setMode('manual');
  approval.remember(['shell:git']);

  assert.equal(approval.gate('shell', { command: 'git status' }), null, 'git was allowed');
  assert.ok(approval.gate('shell', { command: 'rm -rf ~' }), 'rm was not');
  assert.ok(approval.gate('write_file', { path: 'x' }), 'and allowing a verb is not allowing a tool');

  // Allowing the whole tool is a bigger decision, and a separate one.
  approval.remember('shell');
  assert.equal(approval.gate('shell', { command: 'rm -rf ~' }), null, 'the whole tool was allowed');
});

test('a chained command is every verb in it, not the first one', () => {
  // The bug this exists to prevent: `git status && rm -rf ~` leads with `git`,
  // and a gate reading one word waves it through on an allowlist that says
  // nothing whatever about `rm`.
  approval.setMode('manual');
  approval.remember(['shell:git']);

  for (const command of [
    'git status && rm -rf ~',
    'git status; rm -rf ~',
    'git status || rm -rf ~',
    'git log | rm -rf ~',
    'git status\nrm -rf ~',
  ]) {
    assert.ok(approval.gate('shell', { command }), `still asked about: ${command}`);
  }

  approval.remember(['shell:rm']);
  assert.equal(approval.gate('shell', { command: 'git status && rm -rf ~' }), null,
    'once every verb in it is allowed, it runs');
});

test('a command that writes itself at run time can never be allowed by type', () => {
  approval.setMode('manual');
  approval.remember(['shell:git', 'shell:echo', 'shell:rm']);

  for (const command of ['echo $(rm -rf ~)', 'git `rm -rf ~`']) {
    const gate = approval.gate('shell', { command });
    assert.ok(gate, `asked about: ${command}`);
    assert.equal(gate.keys, null,
      'and the card cannot offer "always allow", because there is no type to remember');
  }
  assert.equal(approval.verbsOf('echo $(whoami)'), null, 'substitution is unsummarisable, not empty');
});

test('the verb is the command, not the thing standing in front of it', () => {
  assert.deepEqual(approval.verbsOf('FOO=bar git status'), ['git'], 'env assignments are not the verb');
  assert.deepEqual(approval.verbsOf('  git   status  '), ['git']);
  assert.deepEqual(approval.verbsOf('"git" status'), ['git']);
  // `sudo` is kept deliberately: "always allow sudo anything" should be a
  // decision somebody makes on purpose, not one that hides behind the verb.
  assert.deepEqual(approval.verbsOf('sudo rm -rf /'), ['sudo']);
  assert.deepEqual(approval.verbsOf(''), []);
});

test('answering once does not remember; answering always does', async () => {
  approval.setMode('manual');
  const gate = approval.gate('shell', { command: 'git status' });

  const a = approval.ask(gate, {});
  assert.equal(approval.decide(a.id, 'once'), true);
  assert.equal(await a.answer, 'once');
  assert.deepEqual(approval.settings().always, [], 'once is once');

  const b = approval.ask(gate, {});
  approval.decide(b.id, 'always');
  assert.equal(await b.answer, 'always');
  assert.deepEqual(approval.settings().always, ['shell:git'], 'always is kept, by type');

  // And taking it back works, or the allowlist is a one-way door.
  approval.forget('shell:git');
  assert.deepEqual(approval.settings().always, []);
});

test('a question withdraws itself when the turn is stopped, and answers late are refused', async () => {
  approval.setMode('manual');
  const ctrl = new AbortController();
  const { id, answer } = approval.ask(approval.gate('shell', { command: 'sleep 999' }), { signal: ctrl.signal });
  assert.equal(approval.pending().length, 1, 'it is waiting');

  ctrl.abort();
  assert.equal(await answer, 'cancelled');
  assert.equal(approval.pending().length, 0, 'and gone, not left on screen offering choices');
  assert.equal(approval.decide(id, 'once'), false, 'a click landing afterwards finds nothing');
});

test('the refusal tells the model it was the action, not the wording', () => {
  const gate = { tool: 'shell', keys: ['shell:rm'], summary: 'rm -rf ~' };
  assert.match(approval.refusal('deny', gate), /not about the wording|another route/i);
  assert.match(approval.refusal('timeout', gate), /nobody answered/i);
  // A mission runs unwatched, so there is no one to ask — and it is told to
  // report that rather than to keep trying.
  assert.match(approval.missionRefusal(gate), /nobody to ask/i);
  assert.match(approval.missionRefusal(gate), /shell:rm/);
});

test('the agent cannot grant itself the mode, or add to its own allowlist', () => {
  // The whole point of the setting is to constrain the thing doing the
  // proposing. `harness.config` is proposable and sits one dot away.
  for (const key of ['harness.approval.mode', 'harness.approval.always', 'harness.approval']) {
    const why = settings.refuse(key, 'auto');
    assert.ok(why, `${key} is refused`);
    assert.match(why, /only the user changes it/i);
  }
  assert.equal(settings.refuse('harness.config.temperature', 0.5), null,
    'while the ordinary harness parameters stay proposable');

  // And it is not even listed as readable, so it is never a key the agent
  // learns exists and then asks about.
  assert.equal(settings.readable().some(r => r.path.startsWith('harness.approval')), false);
});

test('the prompt says the leash is on, and what is already allowed', () => {
  approval.setMode('auto');
  assert.equal(approval.block(), '', 'nothing to say when nothing is gated');

  approval.setMode('manual');
  assert.match(approval.block(), /Manual approval is on/);
  assert.match(approval.block(), /Nothing is on the standing allowlist yet/);

  approval.remember(['shell:git']);
  assert.match(approval.block(), /shell:git/);
});

test('the routes answer, and refuse a decision nobody is waiting on', async () => {
  const got = await H.api(null, 'GET', '/api/harness/approval');
  assert.equal(got.status, 200);
  assert.ok(Array.isArray(got.body.always));
  assert.ok(got.body.free.includes('system_status'));

  const bad = await H.api(null, 'POST', '/api/harness/approval', { mode: 'whatever' });
  assert.equal(bad.status, 400);

  const set = await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' });
  assert.equal(set.status, 200);
  assert.equal(set.body.mode, 'manual');

  const late = await H.api(null, 'POST', '/api/harness/approvals/apr_nope', { decision: 'once' });
  assert.equal(late.status, 409, 'answering a question that is gone is not an error to shout about');

  // Applying a change expects a click, the same as accepting a proposal.
  const noClick = await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' }, { 'Sec-Fetch-Site': '' });
  assert.equal(noClick.status, 403);

  await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' });
});

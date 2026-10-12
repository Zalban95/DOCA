'use strict';

// A harness switched off or deleted (modules/harness/harness-life.js, asked 2026-10-12): DOCA's own is neither; a
// switched-off one is installed but never chosen (not the default, not in teams); deleting removes one added by hand
// or uninstalls with the exact reverse of its installer, and refuses what the panel cannot undo.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

const life = () => require('../modules/harness/harness-life');
const catalog = () => require('../modules/harness/catalog');

test('DOCA\'s own harness can be neither switched off nor deleted', async () => {
  const off = await H.api(null, 'POST', '/api/harness/doca/enabled', { on: false });
  assert.equal(off.status, 400);
  assert.match(off.body.error, /cannot be switched off/);
  assert.equal((await H.api(null, 'GET', '/api/harness/doca/delete')).body.can, false);
  assert.equal((await H.api(null, 'POST', '/api/harness/doca/delete', {})).status, 409);
});

test('switched off: not the default (it falls back to DOCA\'s own), cannot be chosen, not summoned to a team; on again undoes it', async () => {
  catalog().addCustom({ label: 'My Agent', cmd: 'my-agent' });
  assert.equal((await H.api(null, 'POST', '/api/harness/default', { id: 'my-agent' })).status, 200);
  const r = await H.api(null, 'POST', '/api/harness/my-agent/enabled', { on: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.defaultNow, 'doca');
  assert.equal(catalog().defaultId(), 'doca');
  assert.equal((await H.api(null, 'GET', '/api/harness')).body.harnesses.find(h => h.id === 'my-agent').disabled, true);
  assert.equal((await H.api(null, 'POST', '/api/harness/default', { id: 'my-agent' })).status, 409);

  const teams = require('../modules/harness-teams/harnesses');
  const someone = teams.all()[0];
  if (someone) {
    life().setDisabled(someone.id, true);
    assert.ok(!teams.offered().some(x => x.id === someone.id), 'not offered to a team');
    life().setDisabled(someone.id, false);
    assert.ok(teams.offered().some(x => x.id === someone.id));
  }
  assert.equal((await H.api(null, 'POST', '/api/harness/my-agent/enabled', { on: true })).status, 200);
  assert.equal((await H.api(null, 'POST', '/api/harness/default', { id: 'my-agent' })).status, 200);
  await H.api(null, 'POST', '/api/harness/default', { id: 'doca' });
});

test('deleting: one added by hand is removed; an installed one is undone only by its installer\'s exact reverse', async () => {
  const L = life();
  assert.equal(L.uninstallCmd({ installCmd: 'npm install -g @openai/codex' }), 'npm uninstall -g @openai/codex');
  assert.equal(L.uninstallCmd({ installCmd: 'pipx install aider-chat' }), 'pipx uninstall aider-chat');
  assert.equal(L.uninstallCmd({ installCmd: 'uv tool install x' }), 'uv tool uninstall x');
  assert.equal(L.uninstallCmd({ installCmd: 'curl -fsSL https://x.example/install.sh | bash' }), null);
  assert.equal(L.uninstallCmd({ installCmd: 'npm install -g a && rm -rf ~' }), null, 'never a command it cannot read whole');
  assert.match(L.plan('codex').cmd, /^npm uninstall -g /);
  assert.equal(L.plan('opencode').can, false, 'an installer script the panel cannot undo exactly');
  assert.equal(L.plan('openclaw').can, false, 'a stack is removed in its own settings');

  life().setDisabled('my-agent', true);
  const r = await H.api(null, 'POST', '/api/harness/my-agent/delete', {});
  assert.equal(r.status, 200);
  assert.equal(catalog().get('my-agent'), null);
  assert.ok(!(catalog().loadHarnessPrefs().disabled || []).includes('my-agent'), 'no stale entry left in the switched-off list');
});

test('a member cannot switch a harness off or delete one', async () => {
  const m = await H.signIn('member');
  assert.equal((await H.api(null, 'POST', '/api/harness/codex/enabled', { on: false }, { Cookie: m.cookie })).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/harness/codex/delete', {}, { Cookie: m.cookie })).status, 403);
});

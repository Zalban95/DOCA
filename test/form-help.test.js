'use strict';

// Asking the agent about a form (agent-ui/form-help.js, the form_fill tool) and settings checkpoints
// (modules/checkpoints.js): the agent fills a form on screen as a draft, never a secret; every saved change keeps
// the version it replaced, to be put back.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(async () => { await H.start(); });
after(async () => { await H.stop(); });

test('form_fill sends the values to the screen as a draft, and refuses a secret field', async () => {
  const tools = require('../modules/harness/tools');
  const sent = [];
  const out = await tools.call('form_fill', { form: 'form3', fields: { 'mcp-url': 'http://ha.local:8123/api/mcp', 'mcp-headers': 'Authorization: Bearer x', apiKey: 'k' } }, [], { emit: e => sent.push(e) });
  assert.match(out, /Filled 1 field\(s\) of form3 as a draft/);
  assert.match(out, /Not filled: mcp-headers, apiKey/);
  assert.deepEqual(sent, [{ type: 'form_fill', form: 'form3', fields: { 'mcp-url': 'http://ha.local:8123/api/mcp' } }]);
  assert.match(await tools.call('form_fill', { form: 'form3', fields: { a: 'b' } }, [], {}), /no form on a screen/);
  assert.match(await tools.call('form_fill', { form: '../x', fields: {} }, [], { emit() {} }), /form is the id/);
});

test('every saved change keeps what it replaced; a restore puts it back and is itself undoable', async () => {
  const u = require('../modules/utils'), cp = require('../modules/checkpoints');
  u.savePrefs({ ...u.loadPrefs(), theme: 'sunset' });
  u.savePrefs({ ...u.loadPrefs(), theme: 'night' });
  const r = await H.api(null, 'GET', '/api/settings/checkpoints');
  assert.equal(r.status, 200);
  const last = r.body.checkpoints[0];
  assert.deepEqual(last.changed, ['theme']);
  const before = cp.list().length;
  u.savePrefs(u.loadPrefs());
  assert.equal(cp.list().length, before, 'a save that changes nothing keeps no checkpoint');
  const back = await H.api(null, 'POST', `/api/settings/checkpoints/${last.id}/restore`, {});
  assert.deepEqual(back.body, { restored: last.id, changed: ['theme'] });
  assert.equal(u.loadPrefs().theme, 'sunset');
  assert.equal(cp.list()[0].changed[0], 'theme', 'the restore made a checkpoint of its own');
  const member = await H.signIn('member', 'cp-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/settings/checkpoints', undefined, { Cookie: member.cookie })).status, 403);
});

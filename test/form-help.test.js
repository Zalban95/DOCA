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

test('✨ Ask the agent opens the chat with a short message of the person\'s, not sent, the form attached as context', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const mk = (tag, props = {}) => {
    const el = { tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, className: '', textContent: '',
      appendChild(c) { this.children.push(c); return c; }, append(...cs) { cs.forEach(c => this.children.push(c)); },
      remove() { this.removed = true; }, closest: () => null, getAttribute: () => null, focus() { this.focused = true; },
      querySelector: () => null, querySelectorAll: () => [], ...props };
    return el;
  };
  const field = mk('input', { type: 'text', id: 'hc-cmd', value: 'claude', labels: [{ textContent: 'Launch command' }] });
  const secret = mk('input', { type: 'password', id: 'hc-key', value: 'sk-real', labels: [{ textContent: 'API key' }] });
  const box = mk('div', { querySelectorAll: () => [field, secret], querySelector: s => (s === '.card-title' ? { firstChild: { textContent: 'Agent Harnesses' } } : null) });
  const input = mk('textarea', { value: '' });
  const chips = mk('div', { querySelector: () => null });
  const msgs = mk('div');
  let sent = 0, opened = 0;
  const ctx = {
    document: { getElementById: id => ({ 'chat-input': input, 'chat-attachments': chips, 'chat-messages': msgs })[id] || null, querySelector: () => null, createElement: mk },
    chatOpen: false, toggleChat: () => { opened++; }, chatSend: () => { sent++; },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'agent-ui', 'form-help.js'), 'utf8'), ctx);
  vm.runInContext('_formHelpForms.set("form1", box)', Object.assign(ctx, { box }));
  vm.runInContext('formHelpAsk("form1")', ctx);
  assert.equal(input.value, 'Help with: Agent Harnesses', 'a short message, theirs to change');
  assert.equal(sent, 0, 'nothing is sent by itself');
  assert.equal(opened, 1);
  assert.ok(input.focused, 'the box is focused');
  assert.match(chips.children[0].children[0]?.textContent || '', /Agent Harnesses · its fields go with your message/, 'a chip says the form goes with it');
  const out = vm.runInContext('formHelpAttach("Help with: Agent Harnesses")', ctx);
  assert.match(out, /^Help with: Agent Harnesses\n\n\[Form details attached by the panel — not the person's words\]\n/);
  assert.match(out, /Launch command \[hc-cmd\]: "claude"/);
  assert.match(out, /API key \[hc-key\]: \(filled — not shown\)/);
  assert.doesNotMatch(out, /sk-real/, 'never a secret\'s value');
  assert.equal(vm.runInContext('formHelpAttach("next")', ctx), 'next', 'once: the next message goes alone');
  const bubble = mk('div');
  vm.runInContext('formHelpTextInto(bubble, out)', Object.assign(ctx, { bubble, out }));
  assert.equal(bubble.textContent, 'Help with: Agent Harnesses', 'the person reads their own words');
  assert.equal(bubble.children[0].className, 'form-help-context', 'and the form folded under them');
});

'use strict';

/**
 * A person's queued request stays theirs when an automatic turn reads it (deep test B, r15): "Chronicle first, bigger
 * text" was queued while the conversation worked, read by a supervisor-woken turn with no person on it, and became a
 * proposal although the person asked for exactly that. The queued message carries its author, so what they asked for
 * (`asked: true`) is decided as on their own turn — within their level, and never for a mission.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { loadPrefs } = require('../modules/utils');

before(() => H.start());
after(() => H.stop());

const call = (path, value) => ({ tool_calls: [{ id: `c${Math.random().toString(36).slice(2, 7)}`, type: 'function',
  function: { name: 'settings_propose', arguments: JSON.stringify({ reason: 'they asked', asked: true, changes: [{ path, value }] }) } }] });

async function run({ read, profile = { level: 'orchestrator' }, isMission = false, path, value }) {
  const memory = require('../modules/harness/memory');
  const { runToolCalls } = require('../modules/harness/turn/tool-calls');
  const s = memory.createSession('queued', { activate: false });
  const said = [];
  await runToolCalls({ reply: call(path, value), schemas: require('../modules/harness/tools').schemas([]), stepDisabled: [], session: s, signal: null,
    client: { name: 'Panel', kind: 'agent' }, profile, isMission, step: 1, say: e => said.push(e), announced: new Set(), read });
  return said.find(e => e.type === 'tool_result')?.result || '';
}

test('an automatic turn that read the person\'s queued request applies what they asked for', async () => {
  const owner = { ...H.owner.user, role: 'owner' };
  const out = await run({ read: [{ message: 'use the system session', client: { name: 'Panel', kind: 'dashboard', user: owner } }], path: 'vms.libvirtUri', value: 'qemu:///system' });
  assert.match(out, /^Applied, as they asked/, out);
  assert.equal(loadPrefs().vms?.libvirtUri, 'qemu:///system');
});

test('with no person\'s message read, or in a mission, it stays a proposal', async () => {
  assert.doesNotMatch(await run({ read: [], path: 'vms.libvirtUri', value: 'qemu:///session' }), /^Applied/);
  const owner = { ...H.owner.user, role: 'owner' };
  const read = [{ message: 'x', client: { name: 'Panel', kind: 'dashboard', user: owner } }];
  assert.doesNotMatch(await run({ read, isMission: true, profile: { level: 'specialist', id: 'researcher' }, path: 'vms.libvirtUri', value: 'qemu:///session' }), /^Applied/);
  assert.doesNotMatch(await run({ read: [{ message: 'x', client: { name: 'bot', kind: 'agent', user: owner } }], path: 'vms.libvirtUri', value: 'qemu:///session' }), /^Applied/, 'a paired agent is not a person');
  assert.equal(loadPrefs().vms?.libvirtUri, 'qemu:///system');
});

test('the person\'s level still bounds it', async () => {
  const member = await H.signIn('member', 'queued-member@test.local');
  const out = await run({ read: [{ message: 'x', client: { name: 'Panel', kind: 'dashboard', user: { ...member.user, role: 'member' } } }], path: 'vms.libvirtUri', value: 'qemu:///elsewhere' });
  assert.doesNotMatch(out, /^Applied/, out);
  assert.equal(loadPrefs().vms?.libvirtUri, 'qemu:///system');
});

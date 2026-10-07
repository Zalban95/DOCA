'use strict';

/** How far a person's agents reach follows their level (auth/reach.js; CONSTITUTION S2; TODO P1.9). */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

let member, mine, theirs;
test.before(async () => {
  await H.start();
  member = await H.signIn('member', 'reach-member@test.local');
  const devices = require('../modules/api-v1/devices'), registry = require('../modules/mcp/registry');
  mine = H.mkDevice('Member phone', 'phone', H.PHONE_CAPS).device; devices.update(mine.id, { userId: member.user.id });
  theirs = H.mkDevice('Owner desk', 'phone', H.PHONE_CAPS).device; devices.update(theirs.id, { userId: H.owner.user.id });
  registry.upsert({ id: 'member-phone', label: 'Member phone', transport: 'http', url: 'http://100.64.0.9:1/mcp', origin: { kind: 'client', deviceId: mine.id } });
  registry.upsert({ id: 'owner-desk', label: 'Owner desk', transport: 'http', url: 'http://100.64.0.8:1/mcp', origin: { kind: 'client', deviceId: theirs.id } });
  registry.upsert({ id: 'hub-blender', label: 'Blender', transport: 'stdio', command: 'blender-mcp' });
});
test.after(() => H.stop());

const tool = (person, name) => require('../modules/auth/permits').tool({ person, name, args: {} });

test('a member reaches their own devices and the agents\' computers — not the hub\'s command line, a hub server or another\'s device', () => {
  const p = { ...member.user, role: 'member' };
  assert.equal(tool(p, 'write_file').allowed, true, 'creating');
  assert.equal(tool(p, 'mcp__computer-abc__shell').allowed, true, 'an agent\'s computer is isolated');
  assert.equal(tool(p, 'mcp__member-phone__screen_capture').allowed, true, 'their own phone');
  assert.match(tool(p, 'shell').why, /hub machine's own command line/);
  assert.match(tool(p, 'mcp__hub-blender__render').why, /runs on the hub machine/);
  assert.match(tool(p, 'mcp__owner-desk__files_read').why, /someone else's device/);
});

test('an admin reaches anything; a grant allots one thing past a member\'s rung', () => {
  assert.equal(tool({ ...H.owner.user, role: 'owner' }, 'shell').allowed, true);
  const grants = require('../modules/auth/grants');
  const p = { ...member.user, role: 'member' };
  assert.equal(tool(p, 'mcp__hub-blender__render').allowed, false);
  grants.create({ subject: { kind: 'user', id: member.user.id }, permission: 'tool:mcp__hub-blender__render', by: { kind: 'user', id: H.owner.user.id } });
  assert.equal(tool(p, 'mcp__hub-blender__render').allowed, true, 'allotted by an admin');
  assert.equal(tool(p, 'mcp__hub-blender__other').allowed, false, 'only what was allotted');
});

test('a level\'s reach is chosen when it is made, never further than its maker\'s', () => {
  const levels = require('../modules/auth/levels');
  assert.throws(() => levels.create({ name: 'Too far', rights: ['read', 'chat'], reach: 'anything' }, { actorLevel: 'member' }), /reaches further than you do/);
  assert.throws(() => levels.create({ name: 'Odd', rights: ['read'], reach: 'everything' }, { actorLevel: 'owner' }), /Reach is one of/);
});

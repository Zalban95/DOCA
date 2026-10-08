'use strict';

// A conversation a person starts is a conversation, not a work chat (self-test 2026-10-08: POST /api/harness/sessions {}
// made a "Work chat", kind work). The panel's ＋ Work and ＋ Plan ask for a work chat by name; a device's new
// conversation and a member's first one are conversations.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(H.start);
after(() => H.stop());

test('a bare new conversation is a conversation; a work chat is asked for', async () => {
  const bare = (await H.api(null, 'POST', '/api/harness/sessions', {})).body.session;
  assert.equal(bare.kind, 'chat');
  assert.equal(bare.title, 'New conversation');
  const work = (await H.api(null, 'POST', '/api/harness/sessions', { title: 'Build it', kind: 'work' })).body.session;
  assert.equal(work.kind, 'work');
  const plan = (await H.api(null, 'POST', '/api/harness/sessions', { planning: true })).body.session;
  assert.equal(plan.kind, 'work', 'a planning chat is a work chat');
  const org = require('../modules/harness/organization');
  assert.match(org.block(bare.id), /a conversation a person started/);
  assert.doesNotMatch(org.block(bare.id), /You lead this work chat/);
  assert.ok(org.canManage(bare.id, bare.id));
});

test('a device\'s new conversation is a conversation too', async () => {
  const { token } = H.mkDevice('Phone', 'phone', H.PHONE_CAPS);
  const r = await H.api(token, 'POST', '/api/v1/harness/sessions', { title: 'From the phone' });
  assert.equal(r.status, 201);
  assert.equal(require('../modules/harness/memory').getSession(r.body.session.id).kind, 'chat');
});

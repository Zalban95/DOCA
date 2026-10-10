'use strict';

// Hive-chat notifications end to end (asked 2026-10-10: "notifications for messages from the chat — just checking", and
// "make the Telegram passthrough a setting"): a direct message and a mention reach the person's phone, watch and linked
// chat as an alert; an ordinary channel message does not by default; a muted space never does; quiet hours hold, on the
// person's own clock; and each person chooses, per kind of device and per device, every message / mentions / nothing,
// and the words or only "New message from …" (people/forward.js).

const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let member, other, phone, watch, chat, others;
const as = (who, method, p, body) => H.api(null, method, p, body, { Cookie: who.cookie, 'X-Doca-Password': who.password });
const alertsOf = (s, spaceId) => s.events.filter(e => e.type === 'alert' && e.payload.ext?.people?.spaceId === spaceId);
const flagOf = (s, text) => s.events.find(e => e.type === 'people.message' && e.payload.message.text === text)?.payload.notify;

function device(name, preset, caps, kind = 'device') {
  const devices = require('../modules/api-v1/devices');
  const made = kind === 'channel' ? devices.create({ name, kind: 'channel', scopes: ['interact', 'harness:chat', 'harness:sessions'], caps: {} }) : H.mkDevice(name, preset, caps);
  devices.update(made.device.id, { userId: other.user.id, orgId: other.orgId });
  const s = H.sse(made.token);
  return { id: made.device.id, token: made.token, s };
}

/** Send `text` as Ada into `space`, then wait until every device has the message event. */
async function send(space, text) {
  const r = await as(member, 'POST', `/api/people/spaces/${space}/messages`, { text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const d of [phone, watch, chat]) await d.s.waitFor(e => e.type === 'people.message' && e.payload.message.text === text);
  await H.sleep(80);   // the alerts are published in the same pass; a little time for the stream
  return r.body;
}

before(async () => {
  await H.start();
  member = await H.signIn('member', 'ada@notify.local');
  other = await H.signIn('member', 'bo@notify.local');
  const store = require('../modules/auth/store');
  store.updateUser(member.user.id, { name: 'Ada' });
  store.updateUser(other.user.id, { name: 'Bo' });
  phone = device('Bo phone', 'phone', H.PHONE_CAPS);
  watch = device('Bo watch', 'watch', H.WATCH_CAPS);
  chat = device('Telegram · Bo', null, null, 'channel');
  await Promise.all([phone.s.ready, watch.s.ready, chat.s.ready]);
  others = (await as(H.owner, 'POST', '/api/people/spaces', { kind: 'group', name: 'Ops', members: [member.user.id, other.user.id] })).body;
});
after(async () => { for (const d of [phone, watch, chat]) d?.s.close(); await H.stop(); });

test('by default a DM and a mention reach the phone, the watch and the linked chat; an ordinary message does not', async () => {
  const dm = (await as(member, 'POST', '/api/people/dm', { person: other.user.id })).body;
  await send(dm.id, 'lunch at one?');
  for (const d of [phone, watch, chat]) {
    const a = alertsOf(d.s, dm.id);
    assert.equal(a.length, 1, `a DM alerts ${d.id}`);
    assert.equal(a[0].payload.title, 'Ada');
    assert.equal(a[0].payload.body[0].text, 'lunch at one?');
    assert.equal(flagOf(d.s, 'lunch at one?'), true);
  }
  await send(others.id, 'the build is green');
  for (const d of [phone, watch, chat]) {
    assert.equal(alertsOf(d.s, others.id).length, 0, 'a message to the group that names nobody notifies nobody');
    assert.equal(flagOf(d.s, 'the build is green'), false);
  }
  await send(others.id, '@bo can you look at the deploy?');
  for (const d of [phone, watch, chat]) {
    const a = alertsOf(d.s, others.id);
    assert.equal(a.length, 1, 'a mention notifies');
    assert.match(a[0].payload.title, /Ada in Ops/);
  }
  // Ada's own devices would never be told of her own message: she is the author (levelFor → null).
  const deliver = require('../modules/people/deliver');
  assert.equal(deliver.levelFor({ kind: 'dm' }, { authorId: member.user.id }, { userId: member.user.id }), null);
});

test('a muted space notifies nobody, a mention included; unmuted it does again', async () => {
  assert.equal((await as(other, 'POST', `/api/people/spaces/${others.id}/mine`, { muted: true })).status, 200);
  const before = alertsOf(phone.s, others.id).length;
  await send(others.id, '@bo muted mention');
  for (const d of [phone, watch, chat]) assert.equal(flagOf(d.s, '@bo muted mention'), false);
  assert.equal(alertsOf(phone.s, others.id).length, before, 'muted: no alert');
  await as(other, 'POST', `/api/people/spaces/${others.id}/mine`, { muted: false });
  await send(others.id, '@bo unmuted mention');
  assert.equal(alertsOf(phone.s, others.id).length, before + 1);
});

test('quiet hours hold, on the person\'s own clock', async () => {
  const profiles = require('../modules/api-v1/profiles');
  const tz = require('../modules/timezones');
  // Bo lives at UTC+14: quiet hours around *his* now, which the hub's own clock would read as some other hour.
  tz.report(other.user.id, 'Pacific/Kiritimati');
  const wall = tz.toWall(new Date(), 'Pacific/Kiritimati');
  const hh = h => `${String((h + 24) % 24).padStart(2, '0')}:00`;
  profiles.put(phone.id, { ...profiles.get(phone.id), quietHours: { from: hh(wall.getUTCHours() - 1), to: hh(wall.getUTCHours() + 1) } }, 'test');
  const forward = require('../modules/people/forward');
  assert.equal(forward.quiet(require('../modules/api-v1/devices').get(phone.id)), true, 'quiet now on his clock');
  const dm = (await as(member, 'POST', '/api/people/dm', { person: other.user.id })).body;
  const n = { phone: alertsOf(phone.s, dm.id).length, watch: alertsOf(watch.s, dm.id).length };
  await send(dm.id, 'are you awake?');
  assert.equal(alertsOf(phone.s, dm.id).length, n.phone, 'the phone in its quiet hours is left alone');
  assert.equal(flagOf(phone.s, 'are you awake?'), false);
  assert.equal(alertsOf(watch.s, dm.id).length, n.watch + 1, 'the watch, with none set, is told');
  profiles.put(phone.id, { ...profiles.get(phone.id), quietHours: null }, 'test');
});

test('each person chooses: everything, nothing, per device, and a content-free notice for a linked chat', async () => {
  const mine = await as(other, 'GET', '/api/people/notify');
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.devices, 'mentions');
  assert.equal(mine.body.chats, 'mentions');
  assert.deepEqual(mine.body.list.map(d => d.id).sort(), [phone.id, watch.id, chat.id].sort(), 'my devices that show notices');

  // Another person's device is not theirs to set.
  assert.equal((await as(member, 'POST', '/api/people/notify', { each: { [phone.id]: { when: 'off' } } })).status, 404);
  assert.equal((await as(other, 'POST', '/api/people/notify', { devices: 'loud' })).status, 400);

  // Linked chats: everything, but only "something came through"; phone and watch: nothing; the watch alone: mentions.
  const set = await as(other, 'POST', '/api/people/notify', { chats: 'all', devices: 'off', each: { [chat.id]: { content: 'notice' }, [watch.id]: { when: 'mentions' } } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.list.find(d => d.id === chat.id).content, 'notice');
  assert.equal(set.body.list.find(d => d.id === phone.id).effective, 'off');
  assert.equal(set.body.list.find(d => d.id === watch.id).effective, 'mentions');

  const counts = () => [phone, watch, chat].map(d => alertsOf(d.s, others.id).length);
  const [p0, w0, c0] = counts();
  await send(others.id, 'deploy window moved to 3pm');
  let [p1, w1, c1] = counts();
  assert.deepEqual([p1 - p0, w1 - w0, c1 - c0], [0, 0, 1], 'only the linked chat hears an ordinary message');
  const bare = alertsOf(chat.s, others.id).at(-1).payload;
  assert.equal(bare.title, 'New message from Ada in Ops');
  assert.deepEqual(bare.body, [], 'no words in a content-free notice');
  assert.equal(bare.ext.people.bare, true);

  await send(others.id, '@bo please confirm');
  const [p2, w2, c2] = counts();
  assert.deepEqual([p2 - p1, w2 - w1, c2 - c1], [0, 1, 1], 'a mention: the watch (its own choice) and the chat; the phone is off');
  assert.ok(!JSON.stringify(alertsOf(chat.s, others.id).at(-1).payload).includes('please confirm'), 'still no words');

  // A device reads and changes the same setting as its person.
  const v1 = await H.api(phone.token, 'GET', '/api/v1/people/notify');
  assert.equal(v1.status, 200, JSON.stringify(v1.body));
  assert.equal(v1.body.chats, 'all');
  const back = await H.api(phone.token, 'POST', '/api/v1/people/notify', { devices: 'mentions', chats: 'mentions', each: { [chat.id]: null, [watch.id]: null } });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.ok(back.body.list.every(d => !d.when && d.content === 'full'));
});

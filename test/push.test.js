'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const bus = require('../modules/api-v1/bus');
const L = require('../modules/api-v1/limits');

let agent, watch;

before(async () => {
  await H.start();
  agent = H.mkDevice('agent', 'agent');
  watch = H.mkDevice('watch', 'watch', H.WATCH_CAPS);
});
after(H.stop);

test('durable events queue while offline and replay on connect via since', async () => {
  const d = H.mkDevice('offline', 'watch', H.WATCH_CAPS);
  const a1 = await H.api(agent.token, 'POST', '/api/v1/agent/alerts', { title: 'first', targets: [d.device.id] });
  const a2 = await H.api(agent.token, 'POST', '/api/v1/agent/alerts', { title: 'second', targets: [d.device.id] });
  assert.equal(a1.status, 202); assert.equal(a2.status, 202);
  assert.equal(bus.pendingCount(d.device.id), 2);

  // Ephemeral events are dropped when nobody is listening.
  assert.equal(bus.publish(d.device.id, 'surface.update', { x: 1 }), null);
  assert.equal(bus.pendingCount(d.device.id), 2);

  // Poll variant
  const poll = await H.api(d.token, 'GET', '/api/v1/events?since=0');
  assert.equal(poll.status, 200);
  assert.deepEqual(poll.body.events.map(e => e.payload.title), ['first', 'second']);
  assert.equal(poll.body.events[0].class, 'durable');
  assert.equal(poll.body.events[0].ack, true);
  assert.ok(poll.body.events[1].seq > poll.body.events[0].seq, 'seq is monotonic');
  assert.equal(poll.body.resync, false);

  // Stream replay from the middle: the since cursor implicitly acks up to it.
  const s = H.sse(d.token, poll.body.events[0].seq);
  await s.ready;
  const ev = await s.waitFor('alert');
  assert.equal(ev.payload.title, 'second');
  assert.equal(s.hello.replay, 1);
  assert.equal(bus.pendingCount(d.device.id), 1, 'first was acked by the cursor');
  s.close();
});

test('explicit ack releases durable events', async () => {
  const d = H.mkDevice('acker', 'watch', H.WATCH_CAPS);
  await H.api(agent.token, 'POST', '/api/v1/agent/alerts', { title: 'a', targets: [d.device.id] });
  await H.api(agent.token, 'POST', '/api/v1/agent/alerts', { title: 'b', targets: [d.device.id] });
  const poll = await H.api(d.token, 'GET', '/api/v1/events');
  const ack = await H.api(d.token, 'POST', '/api/v1/events/ack', { seq: poll.body.nextSince });
  assert.equal(ack.body.acked, 2);
  assert.equal(ack.body.pending, 0);
  const again = await H.api(d.token, 'GET', '/api/v1/events?since=0');
  assert.equal(again.body.events.length, 0);
});

test('live stream delivers durable and ephemeral events in order with heartbeat metadata', async () => {
  const s = H.sse(watch.token);
  await s.ready;
  assert.equal(s.hello.heartbeatSec, L.HEARTBEAT_SEC);
  await H.api(agent.token, 'POST', '/api/v1/agent/messages', { type: 'ping', payload: { n: 1 }, targets: [watch.device.id] });
  bus.publish(watch.device.id, 'surface.update', { surface: { id: 'x' } });
  await H.api(agent.token, 'POST', '/api/v1/agent/messages', { type: 'ping', payload: { n: 2 }, targets: [watch.device.id] });
  await s.waitFor(e => e.type === 'agent.message' && e.payload.payload.n === 2);
  const types = s.events.map(e => e.type);
  assert.deepEqual(types, ['agent.message', 'surface.update', 'agent.message']);
  assert.ok(s.events[1].seq > s.events[0].seq && s.events[2].seq > s.events[1].seq);
  assert.equal(s.events[1].class, 'ephemeral');
  assert.equal(s.events[1].ack, false);
  s.close();
});

test('resync is signalled when the cursor predates retained history', async () => {
  const d = H.mkDevice('laggard', 'watch', H.WATCH_CAPS);
  const first = bus.publish(d.device.id, 'alert', { title: 'oldest' });
  for (let i = 0; i < L.OUTBOX_MAX_EVENTS + 5; i++) bus.publish(d.device.id, 'alert', { title: `n${i}` });
  const r = bus.drain(d.device.id, first.seq);
  assert.equal(r.resync, true);
  assert.equal(r.events.length, L.OUTBOX_MAX_EVENTS);
  const fresh = bus.drain(d.device.id, r.nextSince);
  assert.equal(fresh.resync, false);
  assert.equal(fresh.events.length, 0);
});

test('outbox survives a process restart (persisted on disk)', async () => {
  const d = H.mkDevice('persist', 'watch', H.WATCH_CAPS);
  await H.api(agent.token, 'POST', '/api/v1/agent/alerts', { title: 'keep me', targets: [d.device.id] });
  bus._reset();                                     // simulate restart: drop in-memory state
  const poll = await H.api(d.token, 'GET', '/api/v1/events');
  assert.equal(poll.body.events.length, 1);
  assert.equal(poll.body.events[0].payload.title, 'keep me');
});

test('oversized events are refused rather than truncated silently', () => {
  assert.throws(() => bus.publish(watch.device.id, 'alert', { blob: 'x'.repeat(L.EVENT_BYTES) }), /event_too_large|bytes/);
});

test('quiet hours suppress non-urgent prompts and alerts', async () => {
  const d = H.mkDevice('sleeper', 'watch', H.WATCH_CAPS);
  const now = new Date();
  const hh = n => String(n).padStart(2, '0');
  const from = `${hh((now.getHours() + 23) % 24)}:00`, to = `${hh((now.getHours() + 1) % 24)}:59`;
  await H.api(d.token, 'PUT', '/api/v1/devices/me/profile', { quietHours: { from, to, allowUrgent: true }, pages: [] });
  const p1 = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', { title: 'quiet', targets: [d.device.id], choices: [{ type: 'dismiss', label: 'ok' }] });
  assert.equal(p1.body.prompt.delivered.length, 0);
  const p2 = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', { title: 'loud', priority: 'urgent', targets: [d.device.id], choices: [{ type: 'dismiss', label: 'ok' }] });
  assert.equal(p2.body.prompt.delivered.length, 1);
});

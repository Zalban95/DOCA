'use strict';

/**
 * Waking a watch through its phone (PROTOCOL §11.4 `device.wake`).
 *
 * A watch cannot hold a stream: it has no Tailscale, every request crosses the
 * phone as one request and one response, and it polls only while its screen is
 * on. So a question or an alert for a watch whose app is shut sat in its outbox
 * until the owner happened to open the app. The phone *does* hold a stream, so
 * when a durable event lands for a watch that is not listening, the phone that
 * paired it gets a small `device.wake { deviceId, type }` and passes it over the
 * Data Layer; the watch wakes, polls once with its own token, and notifies.
 *
 * The wake carries no payload of the event and no token: the phone learns only
 * that its watch has something, never what, and never acts as the watch.
 *
 * Which phone: the device that minted the watch's pairing code (`pairedBy`, set
 * at pairing since 2.114). A watch paired before that has none, and falls back
 * to every phone that may pair devices — a wake is only a nudge to poll, so a
 * phone with no such watch nearby wastes one Bluetooth message and nothing else.
 */
const bus = require('./bus');
const devices = require('./devices');
const { hasScope } = require('./scopes');

// What is worth waking a wrist for. The rest (surface updates, ticks) can wait for the app.
const WAKES = new Set(['prompt.new', 'alert', 'agent.turn', 'agent.message', 'artifact.deliver', 'device.control', 'sensor.request']);
const QUIET_MS = 15e3;      // a watch that polled this recently is awake already
const THROTTLE_MS = 5e3;    // one wake per watch per 5 s; its single poll takes the lot
const TTL_SEC = 120;        // a wake nobody delivered in two minutes is stale
const _last = new Map();

function isWatch(d) { return d?.caps?.formFactor === 'watch'; }

function awake(deviceId) {
  const q = bus.delivery(deviceId);
  return q.streaming || (q.lastPollAt && Date.now() - Date.parse(q.lastPollAt) < QUIET_MS);
}

/** The phones to wake for this watch. */
function phonesFor(watch) {
  const all = devices.list().filter(d => !d.revokedAt && d.id !== watch.id);
  if (watch.pairedBy) return all.filter(d => d.id === watch.pairedBy);
  // Not another person's phone: a member's phone, paired with the phone preset, holds devices:admin too.
  return all.filter(d => d.caps?.formFactor === 'phone' && hasScope(d.scopes, 'devices:admin') && (!d.userId || !watch.userId || d.userId === watch.userId));
}

function onEvent(deviceId, env) {
  if (env.class !== 'durable' || !WAKES.has(env.type)) return;
  if (env.payload?.quiet) return;   // the owner is at the panel: nothing worth waking a wrist for
  const watch = devices.get(deviceId);
  if (!isWatch(watch) || watch.revokedAt || awake(deviceId)) return;
  if (Date.now() - (_last.get(deviceId) || 0) < THROTTLE_MS) return;
  _last.set(deviceId, Date.now());
  for (const phone of phonesFor(watch)) {
    bus.publish(phone.id, 'device.wake', { deviceId, type: env.type }, { ttlSec: TTL_SEC });
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  bus.emitter.on('event', (deviceId, env) => { try { onEvent(deviceId, env); } catch { /* a wake must never break a publish */ } });
}

module.exports = { start, onEvent, phonesFor, _reset: () => _last.clear() };

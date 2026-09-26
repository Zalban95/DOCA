'use strict';

/**
 * Per-device event bus with a durable outbox.
 *
 * Every event gets a per-device monotonic `seq`. Durable events are appended
 * to `.doca/outbox/<deviceId>.jsonl` and replayed to the device on
 * (re)connect via `since`; ephemeral events are only delivered to live
 * subscribers and are dropped when the device is offline.
 *
 * Delivery guarantees (see PROTOCOL.md):
 *   ephemeral → at-most-once
 *   durable   → at-least-once until acked (implicit ack = `since` cursor,
 *               explicit ack = POST /events/ack)
 */
const path   = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const store = require('./store');
const L = require('./limits');

/** Event type registry: default class / ttl / priority. Unknown types default to durable. */
const TYPES = {
  heartbeat:          { cls: 'ephemeral' },
  'surface.update':   { cls: 'ephemeral' },
  'job.progress':     { cls: 'ephemeral' },
  'prompt.progress':  { cls: 'ephemeral' },
  'sensor.samples':   { cls: 'ephemeral' },
  // Reply deltas and tool steps are worth nothing after the turn they belong to,
  // and a client that missed them gets the whole reply on `agent.turn` done.
  'agent.text':       { cls: 'ephemeral' },
  'agent.tool':       { cls: 'ephemeral' },

  'prompt.new':       { cls: 'durable', ttlSec: L.PROMPT_DEFAULT_TTL_SEC, priority: 'high' },
  'prompt.outcome':   { cls: 'durable', ttlSec: L.PROMPT_DEFAULT_TTL_SEC, priority: 'high' },
  'prompt.closed':    { cls: 'durable', ttlSec: 3600 },
  'prompt.selected':  { cls: 'durable', ttlSec: 3600 },
  'prompt.confirmed': { cls: 'durable', ttlSec: 3600 },
  'prompt.dismissed': { cls: 'durable', ttlSec: 3600 },
  'prompt.expired':   { cls: 'durable', ttlSec: 3600 },
  alert:              { cls: 'durable', ttlSec: 6 * 3600, priority: 'high' },
  'profile.changed':  { cls: 'durable', ttlSec: L.DEFAULT_EVENT_TTL_SEC },
  'device.vars':      { cls: 'durable', ttlSec: 3600 },
  'device.message':   { cls: 'durable', ttlSec: 6 * 3600 },
  'agent.message':    { cls: 'durable', ttlSec: 6 * 3600 },
  // Durable so a client that arrives mid-turn learns a turn is in flight, and one
  // that was away still gets the answer it did not watch being typed.
  'agent.turn':       { cls: 'durable', ttlSec: 6 * 3600 },
  // A mission starting and finishing is durable — it is the notification that
  // work the user asked for is done, and it is worth having on waking. The step
  // ticks in between are published ephemerally by the publisher, because a
  // progress bar redrawn from an hour-old queue is not progress.
  'agent.mission':    { cls: 'durable', ttlSec: 6 * 3600 },
  'artifact.deliver': { cls: 'durable', ttlSec: L.DEFAULT_EVENT_TTL_SEC },
  'sensor.request':   { cls: 'durable', ttlSec: 600 },
  'sensor.stop':      { cls: 'durable', ttlSec: 600 },
  // Short-lived on purpose: "start your MCP listener" is a request made while
  // somebody is looking at the panel. Replaying it hours later, to a client that
  // has since been shut down deliberately, would be acting on a stale intent.
  'mcp.listener':     { cls: 'durable', ttlSec: 300 },
  'job.done':         { cls: 'durable', ttlSec: 3600 },
  revoked:            { cls: 'durable', ttlSec: 60 },
  resync:             { cls: 'ephemeral' },
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const _state = new Map(); // deviceId → { seq, trimmedBelow, outbox: [], subs: Set }

function outboxFile(id) { return path.join(store.dir('outbox'), `${id}.jsonl`); }
function metaName(id)   { return `outbox/${id}.meta`; }

function stateFor(id) {
  let s = _state.get(id);
  if (!s) {
    const meta = store.readJson(metaName(id), { seq: 0, trimmedBelow: 0 });
    const outbox = store.readJsonl(outboxFile(id));
    const seq = Math.max(meta.seq || 0, ...outbox.map(e => e.seq || 0));
    s = { seq, trimmedBelow: meta.trimmedBelow || 0, outbox, subs: new Set(), dirty: false, delivery: meta.delivery || {} };
    _state.set(id, s);
  }
  return s;
}

// `delivery`: what the hub has seen of this device's side (sentUpTo — the
// highest seq handed over by a stream or a poll; lastPollAt / lastPollSince;
// lastAckAt). It is what lets the panel tell "fetched but never acknowledged"
// (the app has the events, and does not send its cursor back) from "never
// fetched" — a queued count alone cannot (audit 2026-09-26, §4b).
function persistMeta(id, s) { store.writeJson(metaName(id), { seq: s.seq, trimmedBelow: s.trimmedBelow, delivery: s.delivery || {} }); }

function persistOutbox(id, s) { store.writeJsonl(outboxFile(id), s.outbox); persistMeta(id, s); }

function isExpired(e, now = Date.now()) {
  return e.ttlSec != null && Date.parse(e.ts) + e.ttlSec * 1000 < now;
}

/** Drop expired events and enforce ring limits; record the trim watermark. */
function trim(id, s) {
  const now = Date.now();
  const before = s.outbox.length;
  const keep = [];
  const cutoff = now - L.OUTBOX_MAX_HOURS * 3600 * 1000;
  for (const e of s.outbox) {
    if (isExpired(e, now)) continue;                 // ttl expiry is not "loss"
    if (Date.parse(e.ts) < cutoff) { s.trimmedBelow = Math.max(s.trimmedBelow, e.seq); continue; }
    keep.push(e);
  }
  while (keep.length > L.OUTBOX_MAX_EVENTS) {
    const dropped = keep.shift();
    s.trimmedBelow = Math.max(s.trimmedBelow, dropped.seq);
  }
  s.outbox = keep;
  return before !== keep.length;
}

/**
 * Publish an event to one device.
 * @returns the envelope, or null if the event was ephemeral and nobody is listening.
 */
function publish(deviceId, type, payload, opts = {}) {
  const def = TYPES[type] || { cls: 'durable', ttlSec: L.DEFAULT_EVENT_TTL_SEC };
  const cls = opts.cls || def.cls;
  const s = stateFor(deviceId);
  const envelope = {
    seq:      ++s.seq,
    id:       opts.id || `evt_${crypto.randomBytes(8).toString('hex')}`,
    ts:       new Date().toISOString(),
    type,
    class:    cls,
    ttlSec:   cls === 'durable' ? (opts.ttlSec ?? def.ttlSec ?? L.DEFAULT_EVENT_TTL_SEC) : null,
    priority: opts.priority || def.priority || 'normal',
    ack:      cls === 'durable',
    v:        1,
    payload:  payload === undefined ? null : payload,
  };
  const size = Buffer.byteLength(JSON.stringify(envelope));
  if (size > L.EVENT_BYTES) throw Object.assign(new Error(`event ${type} is ${size} bytes (limit ${L.EVENT_BYTES})`), { code: 'event_too_large' });

  if (cls === 'durable') {
    s.outbox.push(envelope);
    trim(deviceId, s);
    persistOutbox(deviceId, s);
  } else {
    persistMeta(deviceId, s);
    if (!s.subs.size) return null;
  }
  for (const sub of s.subs) { try { sub.send(envelope); sent(s, envelope.seq); } catch {} }
  emitter.emit('event', deviceId, envelope);
  return envelope;
}

/**
 * Register a live subscriber. Returns { replay, cursor, resync } where
 * `replay` is the list of pending durable events after `since` and `resync`
 * is true when the client's cursor predates retained history (it must
 * re-fetch snapshots).
 */
function subscribe(deviceId, since, subscriber) {
  const s = stateFor(deviceId);
  const sinceSeq = Number.isFinite(since) ? since : 0;
  if (sinceSeq > 0) ackUpTo(deviceId, sinceSeq);        // implicit ack
  const trimmedChanged = trim(deviceId, s);
  if (trimmedChanged) persistOutbox(deviceId, s);
  const replay = s.outbox.filter(e => e.seq > sinceSeq);
  const resync = sinceSeq > 0 && sinceSeq < s.trimmedBelow;
  for (const e of replay) sent(s, e.seq);
  s.subs.add(subscriber);
  persistMeta(deviceId, s);
  return { replay, cursor: s.seq, resync, unsubscribe: () => s.subs.delete(subscriber) };
}

/** Poll variant: same semantics, no live registration. */
function drain(deviceId, since) {
  const s = stateFor(deviceId);
  const sinceSeq = Number.isFinite(since) ? since : 0;
  if (sinceSeq > 0) ackUpTo(deviceId, sinceSeq);
  if (trim(deviceId, s)) persistOutbox(deviceId, s);
  const events = s.outbox.filter(e => e.seq > sinceSeq);
  s.delivery = { ...(s.delivery || {}), lastPollAt: new Date().toISOString(), lastPollSince: sinceSeq };
  for (const e of events) sent(s, e.seq);
  persistMeta(deviceId, s);
  return {
    events,
    nextSince: s.seq,
    resync: sinceSeq > 0 && sinceSeq < s.trimmedBelow,
  };
}

/** Remove durable events with seq ≤ upTo (client has consumed them). */
function ackUpTo(deviceId, upTo) {
  const s = stateFor(deviceId);
  const before = s.outbox.length;
  s.outbox = s.outbox.filter(e => e.seq > upTo);
  if (s.outbox.length !== before) { s.delivery = { ...(s.delivery || {}), lastAckAt: new Date().toISOString() }; persistOutbox(deviceId, s); }
  return before - s.outbox.length;
}

function sent(s, seq) { if (!(s.delivery?.sentUpTo >= seq)) s.delivery = { ...(s.delivery || {}), sentUpTo: seq }; }

/**
 * Where one device's events stand: { pending, delivered (handed over, not
 * acknowledged), unfetched, oldestPendingAt, sentUpTo, lastPollAt, lastAckAt }.
 */
function delivery(deviceId) {
  const s = stateFor(deviceId), d = s.delivery || {};
  const delivered = s.outbox.filter(e => e.seq <= (d.sentUpTo || 0)).length;
  return { pending: s.outbox.length, delivered, unfetched: s.outbox.length - delivered,
    oldestPendingAt: s.outbox[0]?.ts || null, sentUpTo: d.sentUpTo || 0,
    lastPollAt: d.lastPollAt || null, lastAckAt: d.lastAckAt || null, streaming: s.subs.size > 0 };
}

function pendingCount(deviceId) { return stateFor(deviceId).outbox.length; }
function liveCount(deviceId)    { return stateFor(deviceId).subs.size; }
function isOnline(deviceId)     { return liveCount(deviceId) > 0; }
function cursor(deviceId)       { return stateFor(deviceId).seq; }

/**
 * Outbox files of devices that no longer exist — a re-pairing, a revoked and
 * forgotten device, a pairing that failed — collected at boot (audit N5).
 * Returns the ids removed.
 */
function collectOrphans(knownIds) {
  const fs = require('fs');
  const known = new Set(knownIds);
  const removed = [];
  let files = [];
  try { files = fs.readdirSync(store.dir('outbox')); } catch { return removed; }
  for (const f of files) {
    const m = /^(dev_[a-z0-9]+)\.(jsonl|meta\.json)$/.exec(f);
    if (!m || known.has(m[1])) continue;
    fs.rmSync(require('path').join(store.dir('outbox'), f), { force: true });
    if (!removed.includes(m[1])) removed.push(m[1]);
    _state.delete(m[1]);
  }
  return removed;
}

/** Close every live stream for a device (revocation) and delete its outbox. */
function dropDevice(deviceId, reason) {
  const s = stateFor(deviceId);
  for (const sub of [...s.subs]) { try { sub.close(reason); } catch {} }
  s.subs.clear();
  s.outbox = [];
  try { require('fs').rmSync(outboxFile(deviceId), { force: true }); } catch {}
  store.removeJson(metaName(deviceId));
  _state.delete(deviceId);
}

/**
 * Publish to every device satisfying `filter(deviceRecord)`. Returns
 * [{ deviceId, seq, live }] — `live` when a stream took it at once, else it
 * waits in the device's outbox.
 *
 * An event meant for the owner (a turn's answer, a question) that matched no
 * device, or reached none that has been heard from lately, is said once in the
 * log: the supervisor's promise is that the owner is told on their devices,
 * and until this it could fail completely without a trace (audit N1).
 */
const WATCHED = new Set(['agent.turn', 'prompt.new']);
const _warned = new Map();   // type -> last warning time
function publishWhere(allDevices, filter, type, payload, opts) {
  const out = [];
  let matched = 0;
  for (const d of allDevices) {
    if (d.revokedAt) continue;
    if (!filter(d)) continue;
    matched++;
    const env = publish(d.id, type, payload, opts);
    if (env) out.push({ deviceId: d.id, seq: env.seq, live: stateFor(d.id).subs.size > 0 });
  }
  if (WATCHED.has(type)) {
    const recent = id => { const q = delivery(id); return q.streaming || (q.lastPollAt && Date.now() - Date.parse(q.lastPollAt) < 120e3); };
    const why = !matched ? 'no paired device may receive it' : !out.some(o => recent(o.deviceId)) ? `it waits for ${out.length} device(s), none heard from in 2 minutes` : null;
    if (why && Date.now() - (_warned.get(type) || 0) > 3600e3) {
      _warned.set(type, Date.now());
      console.warn(`[bus] a ${type} event reached no device: ${why}. (Said once an hour.)`);
    }
  }
  return out;
}

/** Test helper. */
function _reset() { _state.clear(); }

module.exports = {
  TYPES, emitter, publish, publishWhere, subscribe, drain, ackUpTo,
  pendingCount, delivery, liveCount, isOnline, cursor, dropDevice, collectOrphans, _reset,
};

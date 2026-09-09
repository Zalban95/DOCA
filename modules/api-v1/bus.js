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
  'artifact.deliver': { cls: 'durable', ttlSec: L.DEFAULT_EVENT_TTL_SEC },
  'sensor.request':   { cls: 'durable', ttlSec: 600 },
  'sensor.stop':      { cls: 'durable', ttlSec: 600 },
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
    s = { seq, trimmedBelow: meta.trimmedBelow || 0, outbox, subs: new Set(), dirty: false };
    _state.set(id, s);
  }
  return s;
}

function persistMeta(id, s) { store.writeJson(metaName(id), { seq: s.seq, trimmedBelow: s.trimmedBelow }); }

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
  for (const sub of s.subs) { try { sub.send(envelope); } catch {} }
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
  s.subs.add(subscriber);
  return { replay, cursor: s.seq, resync, unsubscribe: () => s.subs.delete(subscriber) };
}

/** Poll variant: same semantics, no live registration. */
function drain(deviceId, since) {
  const s = stateFor(deviceId);
  const sinceSeq = Number.isFinite(since) ? since : 0;
  if (sinceSeq > 0) ackUpTo(deviceId, sinceSeq);
  if (trim(deviceId, s)) persistOutbox(deviceId, s);
  return {
    events: s.outbox.filter(e => e.seq > sinceSeq),
    nextSince: s.seq,
    resync: sinceSeq > 0 && sinceSeq < s.trimmedBelow,
  };
}

/** Remove durable events with seq ≤ upTo (client has consumed them). */
function ackUpTo(deviceId, upTo) {
  const s = stateFor(deviceId);
  const before = s.outbox.length;
  s.outbox = s.outbox.filter(e => e.seq > upTo);
  if (s.outbox.length !== before) persistOutbox(deviceId, s);
  return before - s.outbox.length;
}

function pendingCount(deviceId) { return stateFor(deviceId).outbox.length; }
function liveCount(deviceId)    { return stateFor(deviceId).subs.size; }
function isOnline(deviceId)     { return liveCount(deviceId) > 0; }
function cursor(deviceId)       { return stateFor(deviceId).seq; }

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

/** Publish to every device satisfying `filter(deviceRecord)`. */
function publishWhere(allDevices, filter, type, payload, opts) {
  const out = [];
  for (const d of allDevices) {
    if (d.revokedAt) continue;
    if (!filter(d)) continue;
    const env = publish(d.id, type, payload, opts);
    if (env) out.push({ deviceId: d.id, seq: env.seq });
  }
  return out;
}

/** Test helper. */
function _reset() { _state.clear(); }

module.exports = {
  TYPES, emitter, publish, publishWhere, subscribe, drain, ackUpTo,
  pendingCount, liveCount, isOnline, cursor, dropDevice, _reset,
};

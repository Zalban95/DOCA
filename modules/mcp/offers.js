'use strict';

/**
 * A client offering the MCP server it hosts, so nobody has to carry a URL
 * across two machines by hand.
 *
 * The shape is borrowed from the harness's settings proposals, and for the same
 * reason: the thing being asked for is one a request must never be allowed to
 * do by itself. `mcpServers` holds an address the host will call and, for a
 * stdio server, a command the host will spawn — and `POST /api/mcp` is
 * unauthenticated to any tailnet peer. So an offer writes nothing. It sits
 * here until somebody clicks Accept in the dashboard, and only that click
 * reaches the registry.
 *
 * What an offer is *not* is a way around the transport rule: accepting one
 * always produces `transport: 'http'` with `origin.kind: 'client'`, because a
 * command in an offer would be a command a remote machine chose for this one.
 */
const store = require('../store');

const DOC          = 'mcp/offers';
const KEEP_DECIDED = 20;
const MAX_PENDING  = 20;

function load() {
  const doc = store.readJson(DOC, { offers: [] });
  if (!Array.isArray(doc.offers)) doc.offers = [];
  return doc;
}

function save(doc) {
  const pending = doc.offers.filter(o => o.status === 'pending');
  const decided = doc.offers.filter(o => o.status !== 'pending').slice(-KEEP_DECIDED);
  store.writeJson(DOC, { offers: [...decided, ...pending] });
}

function list() {
  const all = load().offers;
  return {
    pending: all.filter(o => o.status === 'pending'),
    decided: all.filter(o => o.status !== 'pending').reverse(),
  };
}

function find(id) {
  return load().offers.find(o => o.id === id) || null;
}

/**
 * Record what a client says it is hosting.
 *
 * One pending offer per device, replaced rather than queued: a client that
 * restarts and re-offers with a fresh URL is correcting itself, and leaving the
 * stale one in the list would just be two cards where the older is wrong.
 */
function offer(deviceId, deviceName, input = {}) {
  const url = String(input.url || '').trim();
  if (!/^https?:\/\//.test(url))
    throw Object.assign(new Error('url must start with http:// or https://'), { status: 400 });

  const headers = input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)
    ? Object.fromEntries(Object.entries(input.headers).slice(0, 20)
      .map(([k, v]) => [String(k).slice(0, 128), String(v).slice(0, 2048)]))
    : {};

  const tools = Array.isArray(input.tools)
    ? input.tools.slice(0, 40).map(t => String(t).slice(0, 64))
    : [];

  const doc = load();
  const kept = doc.offers.filter(o => !(o.status === 'pending' && o.deviceId === deviceId));
  if (kept.filter(o => o.status === 'pending').length >= MAX_PENDING)
    throw Object.assign(new Error('too many offers waiting to be reviewed'), { status: 429 });

  const row = {
    id: `mo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    deviceId,
    deviceName: String(deviceName || deviceId).slice(0, 64),
    label: String(input.label || deviceName || deviceId).trim().slice(0, 64),
    url,
    headers,
    // Advertised, not verified — the host has not spoken to it yet. Shown so the
    // person clicking Accept knows roughly what they are letting in.
    tools,
    note: String(input.note || '').trim().slice(0, 400),
    status: 'pending',
  };
  doc.offers = [...kept, row];
  save(doc);
  return row;
}

/**
 * Accept one, which is the only path from an offer to a definition.
 *
 * The device is re-checked here rather than trusted from the stored row: the
 * offer may have sat for a week, and a revoked device must not get a server
 * pointed at it because it asked nicely before it was revoked.
 */
function accept(id) {
  const doc = load();
  const o = doc.offers.find(x => x.id === id);
  if (!o)                     throw Object.assign(new Error('Unknown offer'), { status: 404 });
  if (o.status !== 'pending') throw Object.assign(new Error(`Already ${o.status}`), { status: 409 });

  const dev = require('../api-v1/devices').get(o.deviceId);
  if (!dev || dev.revokedAt)
    throw Object.assign(new Error(`${o.deviceName} is no longer paired — pair it again and let it offer afresh`), { status: 409 });

  const server = require('./registry').upsert({
    label:     o.label,
    transport: 'http',
    url:       o.url,
    headers:   o.headers,
    origin:    { kind: 'client', deviceId: o.deviceId },
  });

  o.status    = 'accepted';
  o.decidedAt = new Date().toISOString();
  o.serverId  = server.id;
  save(doc);
  return { offer: o, server };
}

function reject(id, reason) {
  const doc = load();
  const o = doc.offers.find(x => x.id === id);
  if (!o)                     throw Object.assign(new Error('Unknown offer'), { status: 404 });
  if (o.status !== 'pending') throw Object.assign(new Error(`Already ${o.status}`), { status: 409 });
  o.status        = 'rejected';
  o.decidedAt     = new Date().toISOString();
  o.decidedReason = String(reason || '').trim().slice(0, 400);
  save(doc);
  return o;
}

module.exports = { list, find, offer, accept, reject };

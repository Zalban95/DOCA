'use strict';

/**
 * What a device waiting for approval may do (devices-approval/; the owner's decision of 2026-10-09). Exactly:
 *
 *   GET  /api/v1/devices/me (or its own id)   its record, with `approval`: who was asked, since when
 *   GET  /api/v1/events                       its event stream (or a poll), to hear `device.approved` or `device.refused`
 *   POST /api/v1/events/ack                   acknowledging what it heard
 *
 * Every other /api/v1 route answers 403 `pending_approval` naming who can approve it; the sockets (MCP host, realtime,
 * call) and a panel session opened with its token refuse it too. The bus delivers it only the events below: a
 * device that is not approved hears nothing meant for its person.
 */
const { sendError } = require('./errors');

/** The only events a pending device receives. */
const EVENTS = new Set(['device.approved', 'device.refused', 'revoked', 'resync', 'heartbeat']);

const isPending = d => require('./devices').isPending(d);

function allowed(req) {
  const p = req.path, id = req.device.id;
  if (req.method === 'GET' && (p === '/events' || p === '/devices/me' || p === `/devices/${id}`)) return true;
  return req.method === 'POST' && p === '/events/ack';
}

/** The refusal's words and details: who was asked. */
function refusal(device) {
  const approval = require('../devices-approval').selfView(device);
  return { message: `This device waits for approval. ${approval.message} Until then it may read its own record (GET /api/v1/devices/me) and hold its event stream, which says device.approved or device.refused.`,
    extra: { approval } };
}

/** Router middleware, right after authentication. */
function guard(req, res, next) {
  if (!req.device || !isPending(req.device) || allowed(req)) return next();
  const r = refusal(req.device);
  return sendError(res, 403, 'pending_approval', r.message, r.extra);
}

/** Whether the bus delivers `type` to `deviceId` (bus.publish asks before queueing anything). */
function delivers(deviceId, type) {
  if (EVENTS.has(type)) return true;
  try { return !isPending(require('./devices').get(deviceId)); } catch { return true; }
}

module.exports = { EVENTS, guard, delivers, isPending, refusal };

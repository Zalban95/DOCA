'use strict';

const devices = require('./devices');
const { hasScope } = require('./scopes');
const { sendError } = require('./errors');

/**
 * Authenticate a request. Bearer header everywhere; `?access_token=` is
 * accepted only where the route opts in (the events stream, because browser
 * EventSource cannot set headers). The token is never echoed or logged.
 */
function authenticate(opts = {}) {
  return (req, res, next) => {
    let token = null;
    const h = req.headers.authorization || '';
    if (/^Bearer\s+/i.test(h)) token = h.replace(/^Bearer\s+/i, '').trim();
    else if (opts.allowQuery && typeof req.query.access_token === 'string') token = req.query.access_token;
    if (!token) return sendError(res, 401, 'unauthenticated', 'Missing bearer token', { hint: 'Authorization: Bearer doca_<device>.<secret>' });
    const device = devices.authenticate(token);
    if (!device) return sendError(res, 401, 'invalid_token', 'Token is unknown, expired or revoked');
    req.device = device;
    req.clientInfo = String(req.headers['x-doca-client'] || '').slice(0, 64) || null;
    next();
  };
}

/** Require one of the given scopes (any match passes). */
function requireScope(...scopes) {
  return (req, res, next) => {
    if (!req.device) return sendError(res, 401, 'unauthenticated', 'Missing bearer token');
    const ok = scopes.some(s => hasScope(req.device.scopes, s));
    if (!ok) return sendError(res, 403, 'scope_required', `This action requires one of: ${scopes.join(', ')}`, { required: scopes });
    next();
  };
}

/** Inline check for use inside handlers (returns boolean). */
function can(req, scope) { return !!req.device && hasScope(req.device.scopes, scope); }

/** `me` resolution for /devices/:id routes. */
function resolveDeviceId(req) {
  return req.params.id === 'me' ? req.device.id : req.params.id;
}

module.exports = { authenticate, requireScope, can, resolveDeviceId };

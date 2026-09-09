'use strict';

/**
 * Uniform error shape for /api/v1:
 *   { error: { code, message, ...extra } }
 * `code` is a stable machine-readable string documented in PROTOCOL.md.
 */
class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code   = code;
    this.extra  = extra || {};
  }
}

function sendError(res, status, code, message, extra) {
  return res.status(status).json({ error: { code, message: message || code, ...(extra || {}) } });
}

/** Express error middleware — converts ApiError and body-parser errors. */
function errorMiddleware(err, _req, res, _next) {
  if (err instanceof ApiError) return sendError(res, err.status, err.code, err.message, err.extra);
  if (err && err.type === 'entity.too.large') return sendError(res, 413, 'payload_too_large', 'Request body exceeds the server limit');
  if (err && err.type === 'entity.parse.failed') return sendError(res, 400, 'bad_json', 'Request body is not valid JSON');
  if (err && err.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'payload_too_large', 'Uploaded file exceeds the server limit');
  console.error('[api-v1]', err);
  return sendError(res, 500, 'internal', err && err.message ? err.message : 'Internal error');
}

/** Wrap an async route handler so rejections reach errorMiddleware. */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, sendError, errorMiddleware, wrap };

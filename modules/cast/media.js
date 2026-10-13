'use strict';

/**
 * One-time media for a cast (docs/design/cast-reach.md §2.4): `token({buffer|file, mime, for})` → a 32-hex token served
 * at `GET /api/cast/media/<token>` through the cast door to the one address it is for, with ranges for a file. Gone at the
 * cast's end (`drop`) or ten minutes after it was last fetched. In memory: a restart ends every cast anyway.
 */
const crypto = require('crypto');
const TTL_MS = 10 * 60e3;
const _tokens = new Map();   // token → { buffer?, file?, mime, for, last }

const plain = a => String(a || '').replace(/^::ffff:/, '');

function sweep() { const now = Date.now(); for (const [t, m] of _tokens) if (now - m.last > TTL_MS) _tokens.delete(t); }

/** Keep `buffer` (or `file`) for the device at `for`. → the token. */
function token({ buffer = null, file = null, mime = 'application/octet-stream', for: addr }) {
  sweep();
  const t = crypto.randomBytes(16).toString('hex');
  _tokens.set(t, { buffer, file, mime, for: plain(addr), last: Date.now() });
  return t;
}

function drop(t) { _tokens.delete(t); }

/** GET /api/cast/media/:token — through the door, only to the address it was made for. */
function serve(req, res) {
  const m = _tokens.get(String(req.params.token || ''));
  // Through the cast door only (door.js marks what it lets in), and only to the address it was made for.
  if (!m || !req.castDoor || plain(req.socket.remoteAddress) !== m.for) return res.status(404).type('text/plain').send('Not here.');
  m.last = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (m.file) return res.type(m.mime).sendFile(m.file);
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Content-Length', m.buffer.length);
  res.end(req.method === 'HEAD' ? undefined : m.buffer);
}

module.exports = { token, drop, serve, _tokens };

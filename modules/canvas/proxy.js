'use strict';

/**
 * The preview half of the canvas origin (./previews.js): forward a request, or
 * a WebSocket (a dev server's hot reload), to the one localhost port a preview
 * token names.
 *
 *   GET /p/<token>/[path]   enter: set this browser's preview cookie, then
 *                           continue to /[path] — so the app's root-relative
 *                           URLs (/assets/app.js, /api/…) reach it unchanged
 *   anything else, with the cookie   → 127.0.0.1:<port>, as asked
 *
 * One preview per browser at a time: opening another replaces the cookie. The
 * cookie holds only the token, is HttpOnly and lives on the canvas origin,
 * which has nothing else to protect.
 */
const http = require('http');
const net  = require('net');

const previews = require('./previews');
const { PORT } = require('../paths');

const COOKIE = 'doca_preview';

function tokenFrom(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{22})`).exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

/** /p/<token>/... → set the cookie and continue at /... ; returns true when it answered. */
function enter(req, res) {
  const m = /^\/p\/([A-Za-z0-9_-]{22})(\/.*)?$/.exec(String(req.url));
  if (!m) return false;
  const p = previews.byToken(m[1]);
  if (!p) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('No such preview, or it has expired.'); return true; }
  res.writeHead(302, {
    Location: m[2] || '/',
    'Set-Cookie': `${COOKIE}=${p.token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${previews.TTL_H * 3600}`,
    'Cache-Control': 'no-store',
  });
  res.end();
  return true;
}

/** Headers to the app: its own host, no panel or preview cookie of ours. */
function upstreamHeaders(req, port) {
  const h = { ...req.headers, host: `127.0.0.1:${port}` };
  const rest = String(h.cookie || '').split(/;\s*/).filter(c => c && !c.startsWith(`${COOKIE}=`)).join('; ');
  if (rest) h.cookie = rest; else delete h.cookie;
  delete h.origin; delete h.referer;
  return h;
}

/** Forward an HTTP request; returns false when this browser has no preview. */
function forward(req, res) {
  const p = previews.byToken(tokenFrom(req));
  if (!p) return false;
  const up = http.request({ host: '127.0.0.1', port: p.port, method: req.method, path: req.url, headers: upstreamHeaders(req, p.port) }, r => {
    const headers = { ...r.headers };
    // Framed by the panel only; a CSP the app sends of its own still applies too.
    const fa = `frame-ancestors https://*:${PORT} http://*:${PORT}`;
    headers['content-security-policy'] = headers['content-security-policy'] ? `${headers['content-security-policy']}, ${fa}` : fa;
    delete headers['x-frame-options'];
    res.writeHead(r.statusCode, headers);
    r.pipe(res);
  });
  up.on('error', e => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Nothing answered on localhost:${p.port} (${e.code || e.message}). Is the server running?`);
  });
  req.pipe(up);
  return true;
}

/** A WebSocket upgrade (hot reload): the same cookie, piped as bytes. */
function upgrade(req, socket, head) {
  const p = previews.byToken(tokenFrom(req));
  if (!p) return socket.destroy();
  const up = net.connect(p.port, '127.0.0.1', () => {
    const h = upstreamHeaders(req, p.port);
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => `${k}: ${x}`))];
    up.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

module.exports = { enter, forward, upgrade, COOKIE };

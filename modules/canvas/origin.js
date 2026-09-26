'use strict';

/**
 * The canvas origin: where agent-written pages run, and the only place.
 *
 * Anything on the panel's origin can call /api/*, and /api/* runs shell
 * commands — so a page the agent wrote, or one that pulls in a hostile script,
 * must never load there. This is a second server on its own port (CANVAS_PORT,
 * default PORT + 1): a different origin to the browser, with no sessions, no
 * cookies and no routes but the pages themselves.
 *
 * And on top of that, every page is sent with a CSP `sandbox` (no
 * allow-same-origin), so it runs with an opaque origin: it cannot read even
 * this origin's storage, and cannot talk to anything — `connect-src 'none'`,
 * images only inline. Scripts and styles may come from the two CDNs artifacts
 * already use. Only the panel may frame it (`frame-ancestors`), and the panel
 * listens to it by postMessage through a short allowlist
 * (public/js/agent-ui/canvas.js).
 *
 *   GET /c/<token>          the latest revision
 *   GET /c/<token>/<rev>    one revision
 *   /p/<token>/…            a preview of a localhost port (./previews.js, ./proxy.js)
 */
const http  = require('http');
const https = require('https');

const canvases = require('./store');
const listen   = require('../listen');
const { PORT, CANVAS_PORT } = require('../paths');

const CDNS = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com';

function policy() {
  return [
    'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads',
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${CDNS}`,
    `style-src 'unsafe-inline' ${CDNS} https://fonts.googleapis.com`,
    'font-src https://fonts.gstatic.com data:',
    'img-src data: blob:',
    'media-src data: blob:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors https://*:${PORT} http://*:${PORT}`,
  ].join('; ');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/** Canvas pages (GET /c/<token>[/<rev>]); previews (/p/<token>/…, then by cookie — ./proxy.js). */
function handler(req, res) {
  const url = String(req.url).split('?')[0];
  const m = /^\/c\/([A-Za-z0-9_-]{22})(?:\/(\d{1,4}))?\/?$/.exec(url);
  if (!m) {
    const proxy = require('./proxy');
    if (proxy.enter(req, res) || proxy.forward(req, res)) return;
    return send(res, 404, 'Nothing here.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Only pages here.');
  const c = canvases.byToken(m[1]);
  const html = c && canvases.page(c, m[2]);
  if (!html) return send(res, 404, 'No such canvas.');
  send(res, 200, req.method === 'HEAD' ? '' : html, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': policy(),
  });
}

/**
 * Start it beside the panel, with the panel's certificate (so a tailnet name
 * that is trusted for one is trusted for the other) and the same listen mode.
 * A canvas origin that cannot bind is a warning, never the panel's death.
 */
function start({ certs, mode }) {
  const server = certs ? https.createServer(certs, handler) : http.createServer(handler);
  listen.guard(server, mode);
  server.on('upgrade', (req, socket, head) => require('./proxy').upgrade(req, socket, head));
  server.on('error', e => console.warn(`[canvas] not serving canvases on :${CANVAS_PORT}: ${e.message}`));
  server.listen(CANVAS_PORT, '0.0.0.0', () => console.log(`[canvas] canvases on :${CANVAS_PORT} (their own origin)`));
  return server;
}

module.exports = { handler, policy, start };

'use strict';

/**
 * A connected service's own UI, on the canvas origin (canvas/origin.js) under /s/<id>/ — another origin than the
 * panel's, as previews are, so the service's page can never reach the panel's /api.
 *
 *   GET /s/<id>/?doca_t=<token>   enter: the token the panel was given (tokens.js) becomes this browser's cookie for
 *                                 that path, then the page continues at /s/<id>/
 *   /s/<id>/<path>, with it       → the service's /<path>: its key added by the hub, X-Forwarded-Prefix: /s/<id> so
 *                                 the service writes its own URLs under the prefix, DOCA's cookies and headers left
 *                                 behind (canvas/proxy.js upstreamHeaders), and only while the service answers
 *
 * The token is the person's: it lapses with their session's time, and a service they may no longer see, or that stopped
 * answering, answers 404/503 here as on the panel.
 */
const http = require('http');
const https = require('https');
const { PORT } = require('../paths');

const PREFIX = /^\/s\/([a-z0-9-]{1,40})(\/[^?]*)?(\?.*)?$/;
const cookieName = id => `doca_svc_${id.replace(/-/g, '_')}`;

function send(res, status, text) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); }

/** Handles /s/<id>/… on the canvas origin; returns false for any other path. */
function handle(req, res) {
  const m = PREFIX.exec(String(req.url));
  if (!m) return false;
  const [, id, rest = '/', query = ''] = m;
  const services = require('./index'), tokens = require('./tokens');
  const s = services.get(id);
  if (!s) { send(res, 404, 'No such service here.'); return true; }

  const params = new URLSearchParams(query.slice(1));
  const entering = params.get('doca_t');
  if (entering) {
    const t = tokens.check(entering, id);
    if (!t) { send(res, 403, 'This link has lapsed: open the page again from the panel.'); return true; }
    params.delete('doca_t');
    const left = params.toString();
    res.writeHead(302, { Location: `/s/${id}${rest}${left ? `?${left}` : ''}`, 'Cache-Control': 'no-store',
      'Set-Cookie': `${cookieName(id)}=${entering}; Path=/s/${id}/; HttpOnly; Secure; SameSite=None; Max-Age=${tokens.TTL_S}` });
    res.end();
    return true;
  }
  const cookie = new RegExp(`(?:^|;\\s*)${cookieName(id)}=([A-Za-z0-9_-]{20,})`).exec(req.headers.cookie || '')?.[1];
  if (!tokens.check(cookie, id)) { send(res, 403, 'Open this service from its page in the panel.'); return true; }
  if (!require('./health').of(id).up) { send(res, 503, `${s.name} is not answering now.`); return true; }

  const target = new URL(`${s.url}${rest}${query}`);
  let headers = { ...require('../canvas/proxy').upstreamHeaders(req, target.port || (target.protocol === 'https:' ? 443 : 80)),
    host: target.host, 'x-forwarded-prefix': `/s/${id}`, 'x-forwarded-proto': 'https' };
  if (s.key) headers = require('./health').request(s, '', headers).headers;
  const lib = target.protocol === 'https:' ? https : http;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(target.hostname);
  const up = lib.request({ protocol: target.protocol, host: target.hostname, port: target.port, method: req.method, path: target.pathname + target.search, headers,
    ...(target.protocol === 'https:' && local ? { rejectUnauthorized: false } : {}) }, r => {
    const h = { ...r.headers };
    // Framed by the panel only; a CSP the service sends of its own still applies too.
    const fa = `frame-ancestors https://*:${PORT} http://*:${PORT}`;
    h['content-security-policy'] = h['content-security-policy'] ? `${h['content-security-policy']}, ${fa}` : fa;
    delete h['x-frame-options'];
    res.writeHead(r.statusCode, h);
    r.pipe(res);
  });
  up.on('error', e => { if (res.headersSent) return res.destroy(); send(res, 502, `${s.name} did not answer (${e.code || e.message}).`); });
  req.pipe(up);
  return true;
}

module.exports = { handle, cookieName };

'use strict';

/**
 * One POST to an HTTP MCP server, waiting exactly as long as the caller says — headers and body alike.
 *
 * Node's built-in fetch (undici) stops waiting for headers after 300 s whatever the caller's own signal says, and its
 * Agent, where that number lives, is not reachable without the `undici` package. So an agents' computer's call, given
 * 600 s by `computers.callTimeoutMs`, was cut at 300 s and reported as a server that "did not answer" (self-test round
 * two, B2). node:http has no such ceiling: the one deadline here is the caller's, and when it passes the request is
 * dropped and a `TimeoutError` thrown, which the client words as its own limit — the work going on regardless.
 *
 * Answers a small fetch-like `{status, ok, headers.get(), text}`.
 */
const http = require('node:http');
const https = require('node:https');

function post(url, { headers = {}, body = '', timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    const req = lib.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, res => {
      const parts = [];
      res.on('data', d => parts.push(d));
      res.on('end', () => finish(resolve, {
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: { get: n => { const v = res.headers[String(n).toLowerCase()]; return v == null ? null : [].concat(v).join(', '); } },
        text: Buffer.concat(parts).toString('utf8'),
      }));
      res.on('error', e => finish(reject, e));
      res.on('close', () => { if (!res.complete) finish(reject, Object.assign(new Error('the connection was dropped before the answer ended'), { code: 'ECONNRESET' })); });
    });
    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error(`no answer within ${timeoutMs} ms`), { name: 'TimeoutError' }));
      req.destroy();
    }, timeoutMs);
    timer.unref?.();
    req.on('error', e => finish(reject, e));
    req.end(body);
  });
}

module.exports = { post };

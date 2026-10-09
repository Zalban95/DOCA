'use strict';

/**
 * One POST to a model's /chat/completions, waiting as long as the caller's signal says — headers and body alike.
 *
 * Node's built-in fetch (undici) stops waiting for response headers after 300 s whatever the caller's signal says,
 * and a server with a queue (llama.cpp on one slot, any busy local runtime) sends no headers until the request leaves
 * the queue. So a `firstTokenTimeoutMs` of 600 s, or the busy-server extension's ten times the setting, ended at
 * 300.4 s as a bare "fetch failed" (deep test B3). mcp/http-post.js made the same move for MCP calls; this is its
 * streaming sibling: node:http has no such ceiling, the one deadline is the caller's signal (the first-token guard, a
 * person's Stop), and an abort rejects with the signal's reason — the same AbortError fetch gave — so the guard and
 * the fallback chain read it as before.
 *
 * Answers the small part of fetch's Response the transport reads: `{status, ok, headers.get(), text(), json(), body}`,
 * `body` a web ReadableStream (`getReader()`), so the SSE parsing is unchanged.
 */
const http = require('node:http');
const https = require('node:https');
const { Readable } = require('node:stream');

const abortError = signal => signal?.reason ?? new DOMException('This operation was aborted', 'AbortError');

/**
 * A kept-alive connection the server has already let go of: Node reuses it, the request is written into a closed
 * socket, and the server never saw it — "socket hang up" before any answer. llama.cpp's router does this after every
 * streamed answer, so the second step of every turn on a local model failed (2026-10-09, lean-prompt). Such a request
 * is sent again once, on a fresh connection; nothing was processed, so nothing is done twice.
 */
const unsent = (req, e, res) => !res && req.reusedSocket && ['ECONNRESET', 'EPIPE'].includes(e?.code);

function post(url, opts = {}) {
  return once(url, opts).catch(e => (e?.retryFresh ? once(url, { ...opts, fresh: true }) : Promise.reject(e)));
}

function once(url, { headers = {}, body = '', signal, fresh = false } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    let res = null, settled = false;
    const onAbort = () => {
      const e = abortError(signal);
      if (!settled) { settled = true; reject(e); }
      req.destroy(e);
      res?.destroy(e);   // a stream being read ends with the same error, as fetch's body did
    };
    const req = lib.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, ...(fresh ? { agent: false } : {}) }, r => {
      res = r;
      r.on('close', () => signal?.removeEventListener('abort', onAbort));
      settled = true;
      const get = n => { const v = r.headers[String(n).toLowerCase()]; return v == null ? null : [].concat(v).join(', '); };
      let stream = null;
      const web = () => (stream ||= Readable.toWeb(r));
      const text = async () => {
        const reader = web().getReader(), parts = [];
        for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(Buffer.from(value)); }
        return Buffer.concat(parts).toString('utf8');
      };
      resolve({
        status: r.statusCode,
        ok: r.statusCode >= 200 && r.statusCode < 300,
        headers: { get },
        text,
        json: async () => JSON.parse(await text()),
        get body() { return web(); },
      });
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', e => {
      signal?.removeEventListener('abort', onAbort);
      if (!settled) { settled = true; reject(!fresh && !signal?.aborted && unsent(req, e, res) ? Object.assign(e, { retryFresh: true }) : e); }
    });
    req.end(body);
  });
}

module.exports = { post };

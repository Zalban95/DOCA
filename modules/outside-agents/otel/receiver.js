'use strict';

/**
 * The hub's OpenTelemetry receiver (life.js opens and closes it): OTLP over HTTP with JSON bodies at POST /v1/logs,
 * /v1/traces and /v1/metrics, on a listener of its own bound to 127.0.0.1 — never the panel's port, the tailnet or the
 * LAN — and answering only a peer on loopback. Protobuf bodies are refused with a 415 saying to export http/json:
 * decoding them would take a protobuf library this project does not carry. A gzip body is unpacked (node:zlib).
 * What arrives goes to map.js and then to ../index.js as steps; nothing is stored as it came.
 */
const http = require('http');
const zlib = require('zlib');

const MAX = 8 * 1024 * 1024;
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const PATHS = { '/v1/logs': 'logs', '/v1/traces': 'traces', '/v1/metrics': 'metrics' };

function answer(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Handle one request; `onSteps(kind, steps, records)` receives what it held. */
function handle(req, res, onSteps) {
  if (!LOOPBACK.test(req.socket.remoteAddress || '')) return answer(res, 403, { error: 'Only this machine may send here.' });
  const kind = PATHS[String(req.url || '').split('?')[0]];
  if (!kind) return answer(res, 404, { error: 'OTLP/HTTP: POST /v1/logs, /v1/traces or /v1/metrics.' });
  if (req.method !== 'POST') return answer(res, 405, { error: 'POST only.' });
  const type = String(req.headers['content-type'] || '');
  if (/protobuf/i.test(type)) return answer(res, 415, { error: 'Protobuf is not read here: export with OTEL_EXPORTER_OTLP_PROTOCOL=http/json.' });
  const chunks = [];
  let size = 0, over = false;
  req.on('data', c => { size += c.length; if (size > MAX) { over = true; req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    if (over) return;
    let buf = Buffer.concat(chunks), body;
    try {
      if (/gzip/i.test(String(req.headers['content-encoding'] || ''))) buf = zlib.gunzipSync(buf, { maxOutputLength: MAX });
      body = JSON.parse(buf.toString('utf8') || '{}');
    } catch { return answer(res, 400, { error: 'Not OTLP JSON.' }); }
    let out = { steps: [], records: 0 };
    try { out = require('./map').steps(kind, body); } catch { /* answered all the same: an exporter retrying will not help */ }
    Promise.resolve(onSteps(kind, out.steps, out.records)).catch(() => {});
    answer(res, 200, {});
  });
  req.on('error', () => {});
}

/** Listen on 127.0.0.1:`port`; resolves to the server, or rejects with why it could not. */
function listen(port, onSteps) {
  const s = http.createServer((req, res) => handle(req, res, onSteps));
  s.requestTimeout = 30000;
  return new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => { s.off('error', reject); resolve(s); });
  });
}

module.exports = { listen, handle, LOOPBACK, MAX };

'use strict';

/**
 * A WebSocket client in Node alone (RFC 6455, text frames), for doca-client: it has no dependency, and Node's own
 * WebSocket cannot be handed the certificate pinned at pairing. Two uses: the socket a home node dials to its hub
 * (wss, the hub's pinned certificate — socket.js) and its link to Home Assistant on the home network (ws or wss —
 * home.js).
 *
 *   const ws = await connect('wss://hub:4242/api/v1/mcp/host', { headers, tls })
 *   ws.on('message', text => …); ws.on('close', (code, reason) => …); ws.send(text); ws.close()
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 32 * 1024 * 1024;

/** One frame from the client: always masked (RFC 6455 §5.3). */
function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, len >> 8, len & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 0x80 | 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  const mask = crypto.randomBytes(4);
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/** Opens the socket. Resolves once the server agreed to the upgrade; rejects with its status otherwise. */
function connect(url, { headers = {}, tls = {}, timeoutMs = 10000 } = {}) {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const key = crypto.randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request({
      host: u.hostname, port: u.port || (secure ? 443 : 80), path: `${u.pathname}${u.search}`, method: 'GET',
      headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
      ...(secure ? tls : {}), timeout: timeoutMs,
    });
    req.on('timeout', () => req.destroy(new Error(`${u.host} did not answer in ${Math.round(timeoutMs / 1000)} s`)));
    req.on('error', reject);
    req.on('response', res => { res.resume(); reject(Object.assign(new Error(`${u.host} refused the socket (HTTP ${res.statusCode})`), { status: res.statusCode })); });
    req.on('upgrade', (res, socket, head) => {
      const want = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== want) { socket.destroy(); return reject(new Error(`${u.host} answered the upgrade wrongly`)); }
      resolve(wrap(socket, head));
    });
    req.end();
  });
}

function wrap(socket, head) {
  const ws = new EventEmitter();
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), parts = [], open = true, closeCode = 1006, closeReason = '';
  ws.readyState = 1;
  ws.lastHeard = Date.now();   // any frame, a ping included: socket.js ends a connection that went silent
  const write = (op, data) => { if (open) try { socket.write(frame(op, data)); } catch { /* gone */ } };
  ws.send = text => write(1, Buffer.from(String(text)));
  ws.close = (code = 1000, reason = '') => {
    if (!open) return;
    const r = Buffer.from(String(reason).slice(0, 120));
    const b = Buffer.alloc(2 + r.length); b.writeUInt16BE(code, 0); r.copy(b, 2);
    write(8, b);
    open = false; ws.readyState = 2;
    setTimeout(() => socket.destroy(), 1000).unref?.();
  };
  ws.terminate = () => { open = false; socket.destroy(); };
  socket.setNoDelay?.(true);
  socket.on('data', d => { ws.lastHeard = Date.now(); buf = Buffer.concat([buf, d]); read(); });
  socket.on('close', () => { open = false; ws.readyState = 3; ws.emit('close', closeCode, closeReason); });
  socket.on('error', e => ws.emit('error', e));

  function read() {
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (len > MAX) { ws.close(1009, 'too big'); socket.destroy(); return; }
      const maskAt = at; if (masked) at += 4;
      if (buf.length < at + len) return;
      let data = buf.subarray(at, at + len);
      if (masked) { const m = buf.subarray(maskAt, maskAt + 4); data = Buffer.from(data.map((x, i) => x ^ m[i & 3])); }
      buf = buf.subarray(at + len);
      if (op === 8) { closeCode = data.length >= 2 ? data.readUInt16BE(0) : 1005; closeReason = data.subarray(2).toString(); if (open) ws.close(closeCode === 1005 ? 1000 : closeCode); socket.end(); continue; }
      if (op === 9) { write(10, data); continue; }
      if (op === 10) continue;
      parts.push(data);
      if (!fin) continue;
      const whole = Buffer.concat(parts); parts = [];
      try { ws.emit('message', whole.toString('utf8')); } catch { /* a listener never breaks the socket */ }
    }
  }
  if (buf.length) setImmediate(read);
  return ws;
}

module.exports = { connect };

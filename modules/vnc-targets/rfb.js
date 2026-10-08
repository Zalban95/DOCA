'use strict';

/**
 * A small RFB (VNC) client, with no dependency (asked 2026-10-08, the VNC section of Machines): enough to sign in, read
 * one screen and send a click or keys — what Live's pictures, the hub-side console bridge and the agent's VNC tools need.
 *   handshake   the version (3.3, 3.7 or 3.8), then security None or VNC authentication (des.js); returns once the
 *               server accepted, before ClientInit — so the console bridge (proxy.js) can hand the rest to noVNC
 *   capture     ClientInit (shared: a person watching keeps watching), 32-bit true colour, Raw and CopyRect, one full
 *               FramebufferUpdateRequest, the screen as { width, height, rgb } — for machines/png.js
 *   act         the same sign-in, then key and pointer events, then goodbye
 * Anything else (VeNCrypt, TLS, Apple's own, a server that sends an encoding it was not offered) is named, not guessed.
 */
const net = require('net');
const { vncResponse } = require('./des');

/** Buffered reads over a socket: read(n) resolves with exactly n bytes, or rejects when the socket ends first. */
function reader(sock) {
  let chunks = [], have = 0, waiting = null, ended = null;
  const pump = () => {
    if (!waiting) return;
    if (have >= waiting.n) {
      const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, have);
      const out = all.subarray(0, waiting.n), rest = all.subarray(waiting.n);
      chunks = rest.length ? [rest] : []; have = rest.length;
      const w = waiting; waiting = null; w.resolve(out);
    } else if (ended) { const w = waiting; waiting = null; w.reject(ended); }
  };
  const onData = d => { chunks.push(d); have += d.length; pump(); };
  sock.on('data', onData);
  sock.on('close', () => { ended = ended || new Error('The VNC server closed the connection.'); pump(); });
  sock.on('error', e => { ended = e; pump(); });
  return {
    read: n => new Promise((resolve, reject) => { waiting = { n, resolve, reject }; pump(); }),
    /** Stop reading and hand back what was read and not used (the console bridge pipes from here). */
    detach: () => { sock.removeListener('data', onData); const rest = chunks.length ? Buffer.concat(chunks, have) : Buffer.alloc(0); chunks = []; have = 0; return rest; },
  };
}

const NAMES = { 5: 'RA2', 6: 'RA2ne', 16: 'Tight', 18: 'TLS', 19: 'VeNCrypt', 22: 'XVP', 30: 'Apple remote desktop', 113: 'MSLogonII', 129: 'Unix login' };

async function reason(r) { const n = (await r.read(4)).readUInt32BE(0); return n ? (await r.read(Math.min(n, 4096))).toString('utf8') : 'refused'; }

/** Version and security; resolves with the minor version used, once the server let us in. */
async function handshake(r, sock, password) {
  const greet = (await r.read(12)).toString('latin1');
  const m = /^RFB (\d{3})\.(\d{3})\n$/.exec(greet);
  if (!m) throw new Error('It is not a VNC server (no RFB greeting).');
  const minor = Number(m[1]) > 3 ? 8 : Number(m[2]) >= 8 ? 8 : Number(m[2]) >= 7 ? 7 : 3;
  sock.write(`RFB 003.00${minor}\n`);
  let type;
  if (minor === 3) {
    type = (await r.read(4)).readUInt32BE(0);
    if (type === 0) throw new Error(`The VNC server refused: ${await reason(r)}`);
  } else {
    const n = (await r.read(1))[0];
    if (n === 0) throw new Error(`The VNC server refused: ${await reason(r)}`);
    const types = [...await r.read(n)];
    type = types.includes(1) ? 1 : types.includes(2) ? 2 : null;
    if (!type) throw new Error(`The VNC server asks for ${types.map(t => NAMES[t] || `security type ${t}`).join(', ')}; DOCA speaks no password and VNC passwords only.`);
    sock.write(Buffer.from([type]));
  }
  if (type === 2) {
    if (!password) throw new Error('The VNC server asks for a password, and none is kept for it.');
    sock.write(vncResponse(await r.read(16), password));
  } else if (type !== 1) throw new Error(`The VNC server asks for ${NAMES[type] || `security type ${type}`}; DOCA speaks no password and VNC passwords only.`);
  if (type === 2 || minor === 8) {
    if ((await r.read(4)).readUInt32BE(0) !== 0) throw new Error(minor === 8 ? `The VNC server refused: ${await reason(r)}` : 'The VNC server refused the password.');
  }
  return minor;
}

/** Connect and sign in; { sock, r } ready for ClientInit. `timeoutMs` bounds the whole of it. */
function open({ host, port, password }, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(port), String(host));
    const r = reader(sock);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`No answer from ${host}:${port} in ${timeoutMs / 1000} s.`)); }, timeoutMs);
    sock.once('connect', () => handshake(r, sock, password).then(() => { clearTimeout(timer); resolve({ sock, r }); },
      e => { clearTimeout(timer); sock.destroy(); reject(e); }));
    sock.once('error', e => { clearTimeout(timer); reject(new Error(`${host}:${port}: ${e.code === 'ECONNREFUSED' ? 'nothing listens there' : e.message}`)); });
  });
}

/** ClientInit (shared) and ServerInit: the screen's size and name. */
async function init(sock, r) {
  sock.write(Buffer.from([1]));
  const head = await r.read(24);
  const name = (await r.read(Math.min(head.readUInt32BE(20), 4096))).toString('utf8');
  return { width: head.readUInt16BE(0), height: head.readUInt16BE(2), name };
}

// 32 bits a pixel, little-endian, true colour, red << 16 | green << 8 | blue: each pixel arrives as B, G, R, unused.
const PIXEL = Buffer.from([0, 0, 0, 0, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);

/** One full screen: { width, height, name, rgb }. */
async function capture(target, { timeoutMs = 10000 } = {}) {
  const { sock, r } = await open(target, timeoutMs);
  const timer = setTimeout(() => sock.destroy(new Error('The VNC server did not send its screen in time.')), timeoutMs);
  try {
    const { width, height, name } = await init(sock, r);
    const enc = Buffer.alloc(12); enc.writeUInt8(2, 0); enc.writeUInt16BE(2, 2); enc.writeInt32BE(0, 4); enc.writeInt32BE(1, 8);   // Raw, CopyRect
    const req = Buffer.alloc(10); req.writeUInt8(3, 0); req.writeUInt16BE(width, 6); req.writeUInt16BE(height, 8);   // not incremental, all of it
    sock.write(Buffer.concat([PIXEL, enc, req]));
    const rgb = Buffer.alloc(width * height * 3);
    for (;;) {
      const type = (await r.read(1))[0];
      if (type === 0) break;
      if (type === 1) { const h = await r.read(5); await r.read(h.readUInt16BE(3) * 6); }   // a colour map: not used in true colour
      else if (type === 2) continue;   // a bell
      else if (type === 3) { const h = await r.read(7); await r.read(h.readUInt32BE(3)); }   // the server's clipboard: not read
      else throw new Error(`The VNC server sent a message DOCA does not read (type ${type}).`);
    }
    const n = (await r.read(3)).readUInt16BE(1);
    for (let i = 0; i < n; i++) {
      const h = await r.read(12);
      const x = h.readUInt16BE(0), y = h.readUInt16BE(2), w = h.readUInt16BE(4), hh = h.readUInt16BE(6), encoding = h.readInt32BE(8);
      if (encoding === 0) {
        const px = await r.read(w * hh * 4);
        for (let row = 0; row < hh; row++) for (let col = 0; col < w; col++) {
          if (x + col >= width || y + row >= height) continue;
          const s = (row * w + col) * 4, d = ((y + row) * width + x + col) * 3;
          rgb[d] = px[s + 2]; rgb[d + 1] = px[s + 1]; rgb[d + 2] = px[s];
        }
      } else if (encoding === 1) {
        const src = await r.read(4), sx = src.readUInt16BE(0), sy = src.readUInt16BE(2);
        const copy = Buffer.alloc(w * hh * 3);
        for (let row = 0; row < hh; row++) rgb.copy(copy, row * w * 3, ((sy + row) * width + sx) * 3, ((sy + row) * width + sx + w) * 3);
        for (let row = 0; row < hh; row++) copy.copy(rgb, ((y + row) * width + x) * 3, row * w * 3, (row + 1) * w * 3);
      } else throw new Error(`The VNC server sent encoding ${encoding}, which DOCA did not ask for.`);
    }
    return { width, height, name, rgb };
  } finally { clearTimeout(timer); sock.destroy(); }
}

/** Sign in and send events — `[{ key, down }]` keysyms or `[{ x, y, mask }]` pointer states — then close. */
async function act(target, events, { timeoutMs = 8000, gapMs = 40, settleMs = 200 } = {}) {
  const { sock, r } = await open(target, timeoutMs);
  try {
    const size = await init(sock, r);
    // Be a client first, as noVNC is: QEMU ignored our clicks until it had our encodings (with its pointer-mode
    // pseudo-encoding, -257, so a tablet stays absolute) and an update request — found on a real VM, 2026-10-08.
    const enc = Buffer.alloc(12); enc.writeUInt8(2, 0); enc.writeUInt16BE(2, 2); enc.writeInt32BE(0, 4); enc.writeInt32BE(-257, 8);
    const req = Buffer.alloc(10); req.writeUInt8(3, 0); req.writeUInt8(1, 1); req.writeUInt16BE(size.width, 6); req.writeUInt16BE(size.height, 8);
    sock.write(Buffer.concat([PIXEL, enc, req]));
    r.detach();   // its updates are not read: only the events matter here
    if (settleMs) await new Promise(res => setTimeout(res, settleMs));
    for (const e of events) {
      const b = Buffer.alloc(e.key != null ? 8 : 6);
      if (e.key != null) { b.writeUInt8(4, 0); b.writeUInt8(e.down ? 1 : 0, 1); b.writeUInt32BE(e.key >>> 0, 4); }
      else { b.writeUInt8(5, 0); b.writeUInt8(e.mask & 0xff, 1); b.writeUInt16BE(Math.max(0, Math.min(size.width - 1, Math.round(e.x))), 2); b.writeUInt16BE(Math.max(0, Math.min(size.height - 1, Math.round(e.y))), 4); }
      sock.write(b);
      if (gapMs) await new Promise(res => setTimeout(res, gapMs));
    }
    await new Promise(res => sock.write(Buffer.alloc(0), res));
    await new Promise(res => setTimeout(res, 300));   // let the last event land before the goodbye
    return size;
  } finally { sock.destroy(); }
}

/** Whether something answers with an RFB greeting there; the version it says, or null. Reads twelve bytes and leaves. */
function greets(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const sock = net.connect(Number(port), String(host));
    const done = v => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(null), timeoutMs);
    let got = Buffer.alloc(0);
    sock.on('data', d => { got = Buffer.concat([got, d]); if (got.length >= 12) done(/^RFB (\d{3}\.\d{3})\n/.exec(got.toString('latin1'))?.[1] || null); });
    sock.on('error', () => done(null));
    sock.on('close', () => done(null));
  });
}

module.exports = { reader, handshake, open, init, capture, act, greets, PIXEL };

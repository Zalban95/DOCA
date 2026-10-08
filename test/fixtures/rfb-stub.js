'use strict';

/**
 * A VNC server small enough to read: it greets with a chosen RFB version, asks for no password or for VNC
 * authentication with a fixed challenge, sends a known screen as a Raw rectangle followed by a CopyRect, and records
 * every message a client sends — for the VNC targets' tests (vnc-rfb, vnc-targets).
 *   CHALLENGE / SECRET_RESPONSE  the challenge 00…0f answered for the password "secret", computed apart from DOCA's DES
 *                                (OpenSSL's legacy des-ecb), so a wrong DES cannot agree with itself
 */
const net = require('net');

const CHALLENGE = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const SECRET_RESPONSE = Buffer.from('ee22539f33a5983ec12f9c2edbc995dd', 'hex');
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

/** The screen: x across red, y across green, blue fixed — so every pixel says where it is. */
const pixel = (x, y) => [x * 60, y * 100, 200];

/** What the screen looks like after the update: the raw screen, then its first two pixels copied to (2,0) and (3,0). */
function expected(width, height) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set(pixel(x, y), (y * width + x) * 3);
  rgb.copy(rgb, 2 * 3, 0, 2 * 3);
  return rgb;
}

function start({ password = null, minor = 8, width = 4, height = 2, name = 'stub screen' } = {}) {
  const got = [], sockets = new Set();
  const server = net.createServer(sock => {
    sockets.add(sock); sock.on('close', () => sockets.delete(sock)); sock.on('error', () => {});
    const { reader } = require('../../modules/vnc-targets/rfb');
    const r = reader(sock);
    (async () => {
      sock.write(`RFB 003.00${minor}\n`);
      await r.read(12);
      if (minor === 3) sock.write(u32(password ? 2 : 1));
      else { sock.write(Buffer.from([1, password ? 2 : 1])); await r.read(1); }
      if (password) {
        sock.write(CHALLENGE);
        const answer = await r.read(16);
        const right = password === 'secret' ? SECRET_RESPONSE : require('../../modules/vnc-targets/des').vncResponse(CHALLENGE, password);
        if (!answer.equals(right)) { sock.write(u32(1)); if (minor === 8) { sock.write(u32(14)); sock.write('wrong password'); } sock.end(); return; }
        sock.write(u32(0));
      } else if (minor === 8) sock.write(u32(0));
      got.push({ type: 'init', shared: (await r.read(1))[0] });
      const pf = Buffer.alloc(16); pf.set([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0]);
      sock.write(Buffer.concat([u16(width), u16(height), pf, u32(Buffer.byteLength(name)), Buffer.from(name)]));
      for (;;) {
        const type = (await r.read(1))[0];
        if (type === 0) { await r.read(19); got.push({ type: 'pixel-format' }); }
        else if (type === 2) { const h = await r.read(3); const encs = await r.read(4 * h.readUInt16BE(1)); got.push({ type: 'encodings', list: [...Array(encs.length / 4).keys()].map(i => encs.readInt32BE(i * 4)) }); }
        else if (type === 3) {
          await r.read(9); got.push({ type: 'update-request' });
          const raw = Buffer.alloc(width * height * 4);
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [R, G, B] = pixel(x, y); raw.set([B, G, R, 0], (y * width + x) * 4); }
          const rect = (x, y, w, h, enc) => Buffer.concat([u16(x), u16(y), u16(w), u16(h), u32(enc)]);
          sock.write(Buffer.concat([Buffer.from([2]),   // a bell first: a client reads past what it does not need
            Buffer.from([0, 0]), u16(2), rect(0, 0, width, height, 0), raw, rect(2, 0, 2, 1, 1), u16(0), u16(0)]));
        } else if (type === 4) { const b = await r.read(7); got.push({ type: 'key', down: b[0], sym: b.readUInt32BE(3) }); }
        else if (type === 5) { const b = await r.read(5); got.push({ type: 'pointer', mask: b[0], x: b.readUInt16BE(1), y: b.readUInt16BE(3) }); }
        else { got.push({ type: `unknown ${type}` }); sock.destroy(); return; }
      }
    })().catch(() => sock.destroy());
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, got,
    close: () => { for (const s of sockets) s.destroy(); return new Promise(res => server.close(res)); },
  })));
}

module.exports = { start, expected, pixel, CHALLENGE, SECRET_RESPONSE };

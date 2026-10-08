'use strict';

/**
 * A VM's screen as a small PNG (vm-shots.js), with node:zlib alone. A hypervisor hands over its whole screen —
 * virsh a PNG on a recent QEMU and a PPM (P6) on an older one, VirtualBox a PNG — at the guest's size, 1920 wide is
 * ~800 KB every few seconds; a tile needs a quarter of that. So: read either (PNG: 8-bit RGB or RGBA, not
 * interlaced — what both write), average it down to at most `maxWidth`, and write an RGB PNG. Anything else read is
 * passed on as it came, so an unusual picture is large rather than missing.
 */
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

/** P6 with a maxval of 255: header words separated by whitespace (comments allowed), then RGB bytes. */
function fromPpm(buf) {
  let i = 2; const words = [];
  if (buf.toString('latin1', 0, 2) !== 'P6') return null;
  while (words.length < 3 && i < buf.length) {
    while (/\s/.test(String.fromCharCode(buf[i]))) i++;
    if (buf[i] === 0x23) { while (i < buf.length && buf[i] !== 0x0a) i++; continue; }
    let w = ''; while (i < buf.length && !/\s/.test(String.fromCharCode(buf[i]))) w += String.fromCharCode(buf[i++]);
    words.push(Number(w));
  }
  const [width, height, max] = words;
  if (max !== 255 || !width || !height) return null;
  const data = buf.subarray(i + 1, i + 1 + width * height * 3);
  return data.length === width * height * 3 ? { width, height, rgb: data } : null;
}

function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

function fromPng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) return null;
  let i = 8, width = 0, height = 0, type = -1, idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), kind = buf.toString('latin1', i + 4, i + 8), body = buf.subarray(i + 8, i + 8 + len);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9];
      if (body[8] !== 8 || ![2, 6].includes(type) || body[12] !== 0) return null;   // 8-bit RGB(A), not interlaced
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    i += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const rgb = Buffer.alloc(width * height * 3), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1
        : f === 4 ? paeth(a, b, c) : 0;
      cur[x] = (line[x] + pred) & 0xff;
    }
    for (let x = 0; x < width; x++) cur.copy(rgb, (y * width + x) * 3, x * bpp, x * bpp + 3);
    cur.copy(prev);
  }
  return { width, height, rgb };
}

/** Box-average down by a whole factor, so that the width is at most maxWidth. */
function shrink(img, maxWidth) {
  const k = Math.ceil(img.width / maxWidth);
  if (k <= 1) return img;
  const width = Math.floor(img.width / k), height = Math.floor(img.height / k), rgb = Buffer.alloc(width * height * 3), n = k * k;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let ch = 0; ch < 3; ch++) {
    let sum = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) sum += img.rgb[((y * k + dy) * img.width + x * k + dx) * 3 + ch];
    rgb[(y * width + x) * 3 + ch] = Math.round(sum / n);
  }
  return { width, height, rgb };
}

function chunk(kind, body) {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

function encode({ width, height, rgb }) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);   // filter 0 on every line
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Whatever the hypervisor wrote → a PNG at most maxWidth wide; a picture it cannot read comes back as it was. */
function small(buf, maxWidth = 960) {
  let img = null;
  try { img = fromPng(buf) || fromPpm(buf); } catch { img = null; }
  if (!img) return buf;
  return encode(shrink(img, maxWidth));
}

module.exports = { small, fromPpm, fromPng, shrink, encode, crc32 };

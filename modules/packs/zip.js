'use strict';

/**
 * A zip file, written and read with nothing but node:zlib (TODO H4.1): a `.dpack` is a zip so that every OS
 * opens it without DOCA, and an Agent Skills folder or a set of scripts inside it is usable as it is. Deflate
 * or store only, no zip64, no encryption — what packs need. Reading refuses any entry whose name could land
 * outside the folder it is unpacked into (an absolute path, a drive letter, `..`), and caps the total size.
 */
const zlib = require('zlib');

const MAX_TOTAL = 200 * 1024 * 1024;
const MAX_ENTRIES = 5000;

function dosTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** @param {Array<{name: string, data: Buffer|string}>} files → Buffer */
function write(files) {
  const locals = [], centrals = [];
  let offset = 0;
  const { time, date } = dosTime();
  for (const f of files) {
    const name = Buffer.from(String(f.name).replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const store = deflated.length >= raw.length;
    const body = store ? raw : deflated;
    const crc = zlib.crc32(raw) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);   // utf-8 names
    head.writeUInt16LE(store ? 0 : 8, 8); head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    locals.push(head, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(store ? 0 : 8, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += head.length + name.length + body.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** A name that stays inside the folder it is unpacked into, or null. */
function safeName(name) {
  const n = String(name).replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').some(p => p === '..') || n.includes('\0')) return null;
  return n;
}

/** Buffer → Array<{name, data}> (directories left out). Throws on anything it will not unpack. */
function read(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('Not a zip file (no end of central directory).'), { status: 400 });
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw Object.assign(new Error(`Too many entries (${count}).`), { status: 413 });
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw Object.assign(new Error('A damaged zip (central directory).'), { status: 400 });
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), at = buf.readUInt32LE(p + 42);
    const rawName = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (rawName.endsWith('/')) continue;
    const name = safeName(rawName);
    if (!name) throw Object.assign(new Error(`"${rawName}" would land outside the pack's folder; refused.`), { status: 400 });
    total += size;
    if (total > MAX_TOTAL) throw Object.assign(new Error('The pack unpacks to more than 200 MB; refused.'), { status: 413 });
    const lnlen = buf.readUInt16LE(at + 26), lxlen = buf.readUInt16LE(at + 28);
    const body = buf.slice(at + 30 + lnlen + lxlen, at + 30 + lnlen + lxlen + csize);
    const data = method === 0 ? body : method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: size + 1 }) : null;
    if (!data) throw Object.assign(new Error(`"${name}" uses compression method ${method}, which packs do not.`), { status: 400 });
    out.push({ name, data });
  }
  return out;
}

module.exports = { write, read, safeName };

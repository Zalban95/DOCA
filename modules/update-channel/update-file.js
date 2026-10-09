'use strict';

/**
 * The update file: a DOCA release a person carries to a hive that cannot reach the update channel (the owner,
 * 2026-10-09: "update files for offline users"). doca-licensing's `npm run release` writes one beside every release,
 * `doca-update-X.Y.Z.dupd` — a plain POSIX tar, uncompressed, so `tar` on any host (Linux, macOS, Windows 10+) lists
 * and unpacks it, and this module reads it by offsets without holding it in memory:
 *
 *   doca-update.json   {format: 1, manifest, signature}: the same signed manifest the channel offers (manifest.js)
 *   doca-X.Y.Z.zip     the release's code — the manifest's `file`, its sha256 and size signed with the rest
 *   image.tar          only when the release has one: `docker save` of the manifest's `image`, its sha256 signed as
 *                      `imageSha256` — what deploy/hive.sh update --file loads for a hive that runs the image
 *
 * Nothing in it is trusted before open() has checked the signature against this build's release keys and the zip's
 * bytes against the signed sha256: a file is only a way to carry a release, never a reason to believe one.
 */
const fs = require('fs');
const crypto = require('crypto');
const manifest = require('./manifest');

const META = 'doca-update.json';
const IMAGE = 'image.tar';
const FORMAT = 1;
const BLOCK = 512;
const CHUNK = 1 << 20;
const EXT = '.dupd';

const fail = (code, why) => Object.assign(new Error(why), { code, status: 400 });

/* ── ustar, by hand: a few dozen lines, so neither side needs a dependency ── */

function octal(buf, off, len, n) {
  if (n < 8 ** (len - 1)) { buf.write(n.toString(8).padStart(len - 1, '0') + '\0', off, len, 'ascii'); return; }
  buf[off] = 0x80;   // past 8 GB: base-256, which GNU tar and bsdtar both read
  let v = BigInt(n);
  for (let i = off + len - 1; i > off; i--) { buf[i] = Number(v & 0xffn); v >>= 8n; }
}

function header(name, size) {
  if (Buffer.byteLength(name) > 99) throw new Error(`A name too long for the file: ${name}`);
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  octal(h, 100, 8, 0o644); octal(h, 108, 8, 0); octal(h, 116, 8, 0);
  octal(h, 124, 12, size); octal(h, 136, 12, Math.floor(Date.now() / 1000));
  h.write('        ', 148, 8, 'ascii');
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii'); h.write('00', 263, 2, 'ascii');
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

function sizeOf(h, off, len) {
  if (h[off] & 0x80) { let v = 0n; for (let i = off + 1; i < off + len; i++) v = (v << 8n) | BigInt(h[i]); return Number(v); }
  return parseInt(h.toString('ascii', off, off + len).replace(/\0.*$/s, '').trim() || '0', 8);
}

function copyInto(fd, src, start, length) {
  const buf = Buffer.alloc(CHUNK);
  const inFd = fs.openSync(src, 'r');
  try {
    for (let done = 0; done < length;) {
      const n = fs.readSync(inFd, buf, 0, Math.min(CHUNK, length - done), start + done);
      if (!n) throw new Error(`${src} ended early`);
      fs.writeSync(fd, buf, 0, n);
      done += n;
    }
  } finally { fs.closeSync(inFd); }
}

/** Write `out`: the signed manifest, the release's zip and, when given, the image's tarball. */
function write(out, { manifest: m, signature, zip, image = null }) {
  const parts = [[META, Buffer.from(JSON.stringify({ format: FORMAT, manifest: m, signature }, null, 2))], [m.file, zip], ...(image ? [[IMAGE, image]] : [])];
  const fd = fs.openSync(out, 'w');
  try {
    for (const [name, src] of parts) {
      const size = Buffer.isBuffer(src) ? src.length : fs.statSync(src).size;
      fs.writeSync(fd, header(name, size));
      if (Buffer.isBuffer(src)) fs.writeSync(fd, src); else copyInto(fd, src, 0, size);
      if (size % BLOCK) fs.writeSync(fd, Buffer.alloc(BLOCK - (size % BLOCK)));
    }
    fs.writeSync(fd, Buffer.alloc(BLOCK * 2));
  } finally { fs.closeSync(fd); }
  return out;
}

/** The entries of a tar: name → {offset, size}. Reads only the headers (and PAX or GNU long names, as docker save writes). */
function entries(file) {
  const out = new Map();
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size, h = Buffer.alloc(BLOCK);
    let pos = 0, longName = null;
    while (pos + BLOCK <= total) {
      fs.readSync(fd, h, 0, BLOCK, pos);
      if (h.every(b => b === 0)) break;
      const size = sizeOf(h, 124, 12), type = String.fromCharCode(h[156] || 48), body = pos + BLOCK;
      const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/s, '');
      let name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
      if (prefix && h.toString('ascii', 257, 262) === 'ustar') name = `${prefix}/${name}`;
      if (type === 'L' || type === 'x') {
        const text = Buffer.alloc(Math.min(size, 1 << 16));
        fs.readSync(fd, text, 0, text.length, body);
        if (type === 'L') longName = text.toString('utf8').replace(/\0.*$/s, '');
        else { const p = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text.toString('utf8')); if (p) longName = p[1]; }
      } else if (type !== 'g') {
        if (body + size > total) throw fail('update_file', 'The update file is cut short: copy it again.');
        out.set(longName || name, { offset: body, size, type });
        longName = null;
      }
      pos = body + Math.ceil(size / BLOCK) * BLOCK;
    }
  } finally { fs.closeSync(fd); }
  return out;
}

function readEntry(file, e, max = 1 << 20) {
  if (e.size > max) throw fail('update_file', 'An entry of the update file is larger than it may be.');
  const buf = Buffer.alloc(e.size), fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, e.size, e.offset); } finally { fs.closeSync(fd); }
  return buf;
}

function sha256Of(file, e) {
  const hash = crypto.createHash('sha256'), buf = Buffer.alloc(CHUNK), fd = fs.openSync(file, 'r');
  try {
    for (let done = 0; done < e.size;) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, e.size - done), e.offset + done);
      if (!n) break;
      hash.update(n === CHUNK ? buf : buf.subarray(0, n));
      done += n;
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

/** Copy one entry out to `dest`. */
function extract(file, e, dest) {
  const fd = fs.openSync(dest, 'w');
  try { copyInto(fd, file, e.offset, e.size); } finally { fs.closeSync(fd); }
  return dest;
}

/**
 * Read and check an update file: the manifest signed by one of `keys` (this build's release keys), its zip present
 * with the signed size and sha256. {manifest, signature, keyId, zip: entry, image: entry|null}; throws saying why not.
 */
function open(file, { keys = require('./keys').RELEASE_KEYS } = {}) {
  let list;
  try { list = entries(file); } catch (e) { throw e.code ? e : fail('update_file', `This is not a DOCA update file (${e.message}).`); }
  const meta = list.get(META);
  if (!meta) throw fail('update_file', `This is not a DOCA update file: it has no ${META}. Update files are named doca-update-X.Y.Z${EXT}.`);
  let body;
  try { body = JSON.parse(readEntry(file, meta).toString('utf8')); } catch { throw fail('update_file', `The update file's ${META} cannot be read.`); }
  if (body.format !== FORMAT) throw fail('update_file', `The update file is format ${body.format}; this version reads format ${FORMAT}. Install a newer version first.`);
  let v;
  try { v = manifest.verify(body.manifest, body.signature, keys); } catch (e) { throw Object.assign(e, { status: 400 }); }
  const m = v.manifest, zip = list.get(m.file);
  if (!zip) throw fail('update_file', `The update file does not carry ${m.file}, the code its manifest names.`);
  if (m.size && zip.size !== Number(m.size)) throw fail('sha256', `${m.file} is ${zip.size} bytes, not the ${m.size} its signed manifest says: the file was changed or cut short.`);
  if (sha256Of(file, zip) !== m.sha256) throw fail('sha256', `${m.file} does not match the sha256 its signed manifest names: the file was changed after signing.`);
  return { manifest: m, signature: body.signature, keyId: v.keyId, zip, image: list.get(IMAGE) || null };
}

module.exports = { write, entries, readEntry, extract, sha256Of, open, META, IMAGE, FORMAT, EXT };

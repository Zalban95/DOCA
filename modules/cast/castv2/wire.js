'use strict';

/**
 * Google Cast v2's wire, with no protobuf library (cast-reach.md §3.1; measured on a Google Home Max, 2026-10-12): each
 * message is a 4-byte big-endian length, then a protobuf `CastMessage` — 1 protocol_version (varint, 0), 2 source_id,
 * 3 destination_id, 4 namespace (strings), 5 payload_type (varint, 0 = string), 6 payload_utf8 (a JSON string). Only
 * varints and length-delimited fields, so this is the whole of it.
 */
const varint = n => { const b = []; while (n > 127) { b.push((n & 127) | 128); n >>>= 7; } b.push(n); return Buffer.from(b); };
const field = (n, s) => { const v = Buffer.from(String(s), 'utf8'); return Buffer.concat([varint((n << 3) | 2), varint(v.length), v]); };
const num = (n, v) => Buffer.concat([varint(n << 3), varint(v)]);

/** One framed message from `source` to `destination` on `namespace`, its payload JSON. */
function encode(source, destination, namespace, payload) {
  const body = Buffer.concat([num(1, 0), field(2, source), field(3, destination), field(4, namespace), num(5, 0), field(6, JSON.stringify(payload))]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

/** One message's body (without its length): {source, destination, namespace, data} — data null when not JSON. */
function decode(buf) {
  const o = {};
  let i = 0;
  const read = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 127) * 2 ** s; s += 7; } while (b & 128 && i < buf.length); return r; };
  while (i < buf.length) {
    const key = read(), n = Math.floor(key / 8), type = key & 7;
    if (type === 0) o[n] = read();
    else if (type === 2) { const l = read(); o[n] = buf.subarray(i, i + l); i += l; } else break;   // nothing else is used
  }
  let data = null;
  try { data = o[6] ? JSON.parse(o[6].toString('utf8')) : null; } catch { /* a binary payload: not ours */ }
  return { source: o[2]?.toString('utf8') || '', destination: o[3]?.toString('utf8') || '', namespace: o[4]?.toString('utf8') || '', data };
}

/** A reader that takes bytes as they arrive and calls `onMessage` per whole message. */
function reader(onMessage) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0);
      if (n > 1 << 20) { buf = Buffer.alloc(0); return; }   // not Cast: never hold more than a megabyte waiting
      if (buf.length < 4 + n) return;
      const m = decode(buf.subarray(4, 4 + n));
      buf = buf.subarray(4 + n);
      onMessage(m);
    }
  };
}

const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
  dashcast: 'urn:x-cast:com.madmod.dashcast',
};

module.exports = { encode, decode, reader, NS };

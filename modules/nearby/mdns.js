'use strict';

/**
 * mDNS / DNS-SD in Node, with dgram alone (no dependency): one PTR query per service type sent to 224.0.0.251:5353
 * from a port of our own — a "legacy unicast" query (RFC 6762 §6.7), which responders answer straight back to that
 * port, so nothing has to share 5353 with Avahi, mDNSResponder or Windows' own responder. Answers and additional
 * records are parsed (PTR, SRV, TXT, A, AAAA, with name compression) and grouped into instances: a name, the service
 * type, the host, port, addresses and TXT values. Read-only: it asks who is there and listens; it never announces.
 */
const dgram = require('dgram');

const GROUP = '224.0.0.251';
const PORT = 5353;
const T = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 };

/** A query packet asking PTR for each name (id 0, no flags, as mDNS asks). */
function buildQuery(names) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(names.length, 4);
  const parts = [head];
  for (const n of names) {
    for (const label of String(n).replace(/\.$/, '').split('.')) {
      const b = Buffer.from(label, 'utf8');
      parts.push(Buffer.from([b.length]), b);
    }
    const tail = Buffer.alloc(5);
    tail.writeUInt16BE(T.PTR, 1);
    tail.writeUInt16BE(1, 3);   // class IN
    parts.push(tail);
  }
  return Buffer.concat(parts);
}

/** A name at `off`, following compression pointers; returns [name, the offset after it]. */
function readName(buf, off) {
  const labels = [];
  let end = null, jumps = 0;
  while (off < buf.length) {
    const len = buf[off];
    if (len === 0) { off += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (off + 1 >= buf.length || ++jumps > 20) break;
      if (end === null) end = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      continue;
    }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += 1 + len;
  }
  return [labels.join('.'), end === null ? off : end];
}

function readTxt(buf, off, len) {
  const out = {};
  const stop = off + len;
  while (off < stop) {
    const l = buf[off];
    const s = buf.toString('utf8', off + 1, off + 1 + l);
    off += 1 + l;
    if (!s) continue;
    const eq = s.indexOf('=');
    if (eq < 0) out[s.toLowerCase()] = true; else out[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
  }
  return out;
}

const ipv6 = b => Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(':').replace(/(^|:)0(:0)+(:|$)/, '::');

/** Every record of a response (answers, authority and additional), or [] when the packet is not one we can read. */
function parse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return [];
  const qd = buf.readUInt16BE(4), total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  try {
    for (let i = 0; i < qd; i++) off = readName(buf, off)[1] + 4;
    const out = [];
    for (let i = 0; i < total && off + 10 <= buf.length; i++) {
      const [name, at] = readName(buf, off);
      const type = buf.readUInt16BE(at), ttl = buf.readUInt32BE(at + 4), len = buf.readUInt16BE(at + 8);
      const d = at + 10;
      if (d + len > buf.length) break;
      let data = null;
      if (type === T.PTR) data = readName(buf, d)[0];
      else if (type === T.SRV) data = { priority: buf.readUInt16BE(d), weight: buf.readUInt16BE(d + 2), port: buf.readUInt16BE(d + 4), target: readName(buf, d + 6)[0] };
      else if (type === T.TXT) data = readTxt(buf, d, len);
      else if (type === T.A && len === 4) data = Array.from(buf.subarray(d, d + 4)).join('.');
      else if (type === T.AAAA && len === 16) data = ipv6(buf.subarray(d, d + 16));
      if (data !== null) out.push({ name, type, ttl, data });
      off = d + len;
    }
    return out;
  } catch { return []; }
}

const lc = s => String(s || '').toLowerCase();

/**
 * Records (from any number of packets, each with the address it came from) → instances:
 * {instance, name, type, host, port, addresses, txt}. The service type is the PTR's owner (`_googlecast._tcp.local`).
 */
function instances(packets) {
  const recs = packets.flatMap(p => parse(p.buf).map(r => ({ ...r, from: p.from })));
  const by = (type, name) => recs.filter(r => r.type === type && lc(r.name) === lc(name));
  const seen = new Map();
  for (const ptr of recs.filter(r => r.type === T.PTR && !/^_services\._dns-sd\._udp/i.test(r.name))) {
    const inst = ptr.data;
    if (seen.has(lc(inst))) continue;
    const srv = by(T.SRV, inst)[0]?.data || null;
    const txt = Object.assign({}, ...by(T.TXT, inst).map(r => r.data));
    const host = srv?.target || null;
    const addresses = [...new Set([...(host ? [...by(T.A, host), ...by(T.AAAA, host)].map(r => r.data) : []), ptr.from].filter(Boolean))];
    const type = ptr.name.replace(/\.local\.?$/i, '');
    const name = inst.endsWith(ptr.name) ? inst.slice(0, -ptr.name.length - 1) : inst.split('.')[0];
    seen.set(lc(inst), { instance: inst, name, type, host, port: srv?.port || null, addresses, txt });
  }
  return [...seen.values()];
}

/** The service types a `_services._dns-sd._udp.local` answer named. */
const typesIn = packets => [...new Set(packets.flatMap(p => parse(p.buf))
  .filter(r => r.type === T.PTR && /^_services\._dns-sd\._udp/i.test(r.name)).map(r => r.data.replace(/\.$/, '')))];

// Interfaces that are not the room around us: containers' bridges, VMs' networks, VPNs (the tailnet has its own source).
const VIRTUAL = /^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|utun|zt|wg|tun|tap|lo)/i;

/** The IPv4 addresses of the interfaces that face a real network: where a multicast question is sent from. */
function lanAddresses(ifs = require('os').networkInterfaces()) {
  return Object.entries(ifs).filter(([n]) => !VIRTUAL.test(n))
    .flatMap(([, list]) => (list || []).filter(a => (a.family === 'IPv4' || a.family === 4) && !a.internal && !/^169\.254\./.test(a.address)).map(a => a.address));
}

/** Ask once on every real interface and listen for `ms`: the packets that came back, each with its sender's address. */
function ask(names, { ms = 2500, socket = dgram.createSocket, addresses = lanAddresses() } = {}) {
  const q = buildQuery(names);
  const packets = [];
  const one = addr => new Promise(resolve => {
    let s;
    try { s = socket({ type: 'udp4', reuseAddr: true }); } catch { return resolve(); }
    const done = () => { try { s.close(); } catch { /* closed */ } resolve(); };
    s.on('error', done);
    s.on('message', (buf, r) => { if (packets.length < 2000) packets.push({ buf, from: r.address }); });
    s.bind(0, addr, () => {
      try { s.setMulticastTTL(255); s.setMulticastInterface(addr); } catch { /* not every OS lets it be set */ }
      s.send(q, PORT, GROUP, () => {});
      setTimeout(() => s.send(q, PORT, GROUP, () => {}), 400);   // once more: a packet on a busy Wi-Fi is easily lost
      setTimeout(done, ms).unref?.();
    });
  });
  return Promise.all((addresses.length ? addresses : [undefined]).map(one)).then(() => packets);
}

/** One sweep: the given types and `_services._dns-sd._udp.local`, then the types that answer named (up to 24). */
async function browse(types, opts = {}) {
  const want = [...new Set(types.map(t => `${t.replace(/\.local\.?$/i, '')}.local`))];
  const first = await ask([...want, '_services._dns-sd._udp.local'], opts);
  const more = typesIn(first).map(t => t.replace(/\.local$/i, '')).filter(t => !want.includes(`${t}.local`)).slice(0, 24);
  const second = more.length && opts.more !== false ? await ask(more.map(t => `${t}.local`), opts) : [];
  return instances([...first, ...second]);
}

module.exports = { buildQuery, parse, instances, typesIn, ask, browse, lanAddresses, VIRTUAL, T };

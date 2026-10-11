'use strict';

/**
 * UPnP / DLNA: one M-SEARCH (ssdp:all) to 239.255.255.250:1900 on every real interface, the answers' LOCATION read,
 * and each device description (XML) fetched with a short timeout — only from a private address, and only over http,
 * so a reply naming somebody else's server is never followed. From the description: the friendly name, maker,
 * model, device type (a MediaRenderer can be played to), its UDN (who it is, across scans), its page and the
 * control URL of its AVTransport service (how a DLNA player is told what to play).
 */
const dgram = require('dgram');
const http = require('http');
const { lanAddresses } = require('./mdns');

const GROUP = '239.255.255.250';
const PORT = 1900;
const SEARCH = ['M-SEARCH * HTTP/1.1', `HOST: ${GROUP}:${PORT}`, 'MAN: "ssdp:discover"', 'MX: 2', 'ST: ssdp:all', '', ''].join('\r\n');

/** One answer (or NOTIFY) → its headers, names in lower case; null when it is not HTTP-shaped. */
function parseResponse(text) {
  const lines = String(text || '').split(/\r?\n/);
  if (!/^(HTTP\/1\.[01] 200|NOTIFY \* HTTP)/i.test(lines[0] || '')) return null;
  const h = {};
  for (const l of lines.slice(1)) { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
  return h.location ? h : null;
}

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/;

/** Whether a LOCATION may be fetched: http, an IPv4 private address (what a LAN device announces). */
function fetchable(loc) {
  try { const u = new URL(loc); return u.protocol === 'http:' && PRIVATE.test(u.hostname); } catch { return false; }
}

const unxml = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml); return m ? unxml(m[1]) : ''; };

/** A description document → what it says of its (first, root) device; relative URLs resolved against `base`. */
function parseDescription(xml, base = '') {
  const s = String(xml || '');
  const dev = (/<device>([\s\S]*)<\/device>/i.exec(s) || [])[1] || '';
  const top = dev.replace(/<deviceList>[\s\S]*<\/deviceList>/i, '').replace(/<serviceList>[\s\S]*?<\/serviceList>/i, '');
  const abs = u => { if (!u) return ''; try { return new URL(u, tag(s, 'URLBase') || base).href; } catch { return ''; } };
  const services = [...dev.matchAll(/<service>([\s\S]*?)<\/service>/gi)].map(m => ({ type: tag(m[1], 'serviceType'), control: abs(tag(m[1], 'controlURL')) }))
    .filter(x => x.type).slice(0, 30);
  return {
    friendlyName: tag(top, 'friendlyName'), manufacturer: tag(top, 'manufacturer'), modelName: tag(top, 'modelName'),
    modelNumber: tag(top, 'modelNumber'), deviceType: tag(top, 'deviceType'), udn: tag(top, 'UDN'),
    presentationURL: abs(tag(top, 'presentationURL')), services,
  };
}

/** GET a description: 2 s, 256 KB, no redirects. */
function getText(url, { ms = 2000, max = 256 * 1024 } = {}) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: ms, headers: { 'User-Agent': 'DOCA nearby' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(''); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; if (body.length > max) { req.destroy(); resolve(''); } });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
}

/** Ask on every real interface and gather the answers for `ms`: {location → headers, with the sender's address}. */
function search({ ms = 3000, socket = dgram.createSocket, addresses = lanAddresses() } = {}) {
  const found = new Map();
  const one = addr => new Promise(resolve => {
    let s;
    try { s = socket({ type: 'udp4', reuseAddr: true }); } catch { return resolve(); }
    const done = () => { try { s.close(); } catch { /* closed */ } resolve(); };
    s.on('error', done);
    s.on('message', (buf, r) => {
      const h = parseResponse(buf.toString('utf8'));
      if (h && found.size < 300 && !found.has(h.location)) found.set(h.location, { ...h, from: r.address });
    });
    s.bind(0, addr, () => {
      try { s.setMulticastTTL(4); if (addr) s.setMulticastInterface(addr); } catch { /* not every OS lets it be set */ }
      s.send(SEARCH, PORT, GROUP, () => {});
      setTimeout(() => s.send(SEARCH, PORT, GROUP, () => {}), 500);
      setTimeout(done, ms).unref?.();
    });
  });
  return Promise.all((addresses.length ? addresses : [undefined]).map(one)).then(() => [...found.values()]);
}

/** One sweep: the answers, each with its description read (at most 40, six at a time). */
async function discover(opts = {}) {
  const answers = (await search(opts)).filter(a => fetchable(a.location)).slice(0, 40);
  const fetchText = opts.getText || getText;
  const out = [];
  for (let i = 0; i < answers.length; i += 6) {
    out.push(...await Promise.all(answers.slice(i, i + 6).map(async a => {
      const xml = await fetchText(a.location);
      return { location: a.location, from: a.from, server: a.server || '', usn: a.usn || '', st: a.st || a.nt || '', ...(xml ? parseDescription(xml, a.location) : {}) };
    })));
  }
  return out;
}

module.exports = { parseResponse, parseDescription, fetchable, search, discover, SEARCH };

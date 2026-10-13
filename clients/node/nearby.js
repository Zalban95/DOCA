'use strict';

/**
 * doca-client's `nearby` family (docs/design/cast-reach.md §6.2; R3f, the owner's yes of 2026-10-13): what is around
 * this machine, seen from here — so the hub can look from a client on another network (a desk at home while the hub
 * is at the office). Lent only when its person says yes, like every family.
 *
 *   nearby_network  which network this machine is on (its subnet, the gateway, a hash of the gateway's MAC)
 *   nearby_scan     Cast devices, Bonjour, UPnP/DLNA, the network's neighbours and Bluetooth — as the hub's own
 *                   sightings (nearby/sightings.js), which the hub merges unchanged
 *   nearby_probe      whether an address answers on a port (a TCP connect; nothing is sent)
 *
 * The readers are the hub's own modules, unchanged: shipped beside this file in nearby/ by `doca-client update`, or
 * read from the checkout (modules/nearby) when this runs from the repository.
 */
const net = require('net');
const path = require('path');

function mod(name) {
  for (const dir of [path.join(__dirname, 'nearby'), path.join(__dirname, '..', '..', 'modules', 'nearby')]) {
    try { return require(path.join(dir, name)); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).includes(name)) throw e; }
  }
  throw new Error(`This doca-client lacks nearby/${name}.js: run "doca-client update" once more.`);
}

const MDNS_TYPES = ['_airplay._tcp', '_raop._tcp', '_ipp._tcp', '_ipps._tcp', '_printer._tcp', '_hap._tcp', '_spotify-connect._tcp',
  '_http._tcp', '_ssh._tcp', '_smb._tcp', '_googlezone._tcp', '_sonos._tcp', '_rfb._tcp', '_matter._tcp'];
const SOURCES = ['cast', 'mdns', 'ssdp', 'lan', 'bluetooth'];

const READ = {
  cast: async s => ({ list: (await mod('mdns').browse(['_googlecast._tcp'], { more: false })).filter(x => /^_googlecast/.test(x.type)).map(x => s.cast(x)) }),
  mdns: async s => ({ list: (await mod('mdns').browse(MDNS_TYPES)).filter(x => !/^_googlecast/.test(x.type)).map(s.mdns) }),
  ssdp: async s => ({ list: (await mod('ssdp').discover()).map(s.upnp) }),
  lan: async (s, n) => ({ list: n.map(s.lan) }),
  bluetooth: async s => { const r = await mod('bluetooth').look(); return { list: r.devices.map(s.bluetooth), why: r.why }; },
};

async function scan(args = {}) {
  const want = (Array.isArray(args.sources) && args.sources.length ? args.sources : SOURCES).filter(x => SOURCES.includes(x));
  const s = mod('sightings');
  const neighbours = await mod('lan').neighbours().catch(() => []);
  const results = await Promise.all(want.map(id => READ[id](s, neighbours).catch(e => ({ list: [], why: e.message }))));
  const why = {};
  want.forEach((id, i) => { if (!results[i].list.length && results[i].why) why[id] = results[i].why; });
  return { things: results.flatMap(r => r.list), sources: want, network: await mod('network').network({ neighbours }), why, at: new Date().toISOString() };
}

function probe(args = {}) {
  const host = String(args.address || ''), port = Number(args.port) || 8009, t0 = Date.now();
  return new Promise(resolve => {
    const sock = net.connect({ host, port, timeout: 3000 });
    const end = open => { sock.destroy(); resolve({ open, ms: Date.now() - t0 }); };
    sock.on('connect', () => end(true)); sock.on('timeout', () => end(false)); sock.on('error', () => end(false));
  });
}

const TOOLS = {
  nearby_network: { family: 'nearby', description: 'Which network this machine is on: its subnet, the gateway, and a hash of the gateway\'s card (never the card itself).', input: {},
    run: () => mod('network').network() },
  nearby_scan: { family: 'nearby', description: 'What is around this machine: Cast speakers and TVs, Bonjour, UPnP/DLNA players, the network\'s neighbours and Bluetooth, with the network it looked from.',
    input: { sources: 'array' }, run: (_c, a) => scan(a) },
  nearby_probe: { family: 'nearby', description: 'Whether an address on this machine\'s network answers on a port (a TCP connect; nothing is sent).', input: { address: 'string', port: 'number' },
    run: (_c, a) => probe(a) },
};

/** The hub's files this family needs beside it, as the hub serves them (api-v1/client-files.js). */
const SHIPPED = ['mdns.js', 'ssdp.js', 'lan.js', 'oui.js', 'bluetooth.js', 'sightings.js', 'network.js'];

module.exports = { TOOLS, SHIPPED, scan, probe, SOURCES };

'use strict';

/**
 * The sources and one scan. Each source is a switch the person turns on (`nearby.sources.<id>`, settings-schema; all
 * off on a new install), with a sentence saying what it looks at; a scan asks only the ones that are on, all at once,
 * turns what each saw into sightings (sightings.js), merges them into one row per thing (merge.js) and joins that to
 * what was seen before (store.js). Every scan is an activity line, whoever asked: the page's Scan, the schedule, the
 * agent's `nearby scan`.
 */
const os = require('os');
const sight = require('./sightings');
const merge = require('./merge');
const store = require('./store');

const MDNS_TYPES = ['_airplay._tcp', '_raop._tcp', '_ipp._tcp', '_ipps._tcp', '_printer._tcp', '_pdl-datastream._tcp', '_hap._tcp', '_spotify-connect._tcp',
  '_http._tcp', '_ssh._tcp', '_smb._tcp', '_googlezone._tcp', '_sonos._tcp', '_rfb._tcp', '_workstation._tcp', '_companion-link._tcp', '_matter._tcp'];

/** The sources, in the order the page lists them: what each looks at, and on which systems it works. */
const SOURCES = [
  { id: 'cast', label: 'Cast devices', about: 'Chromecasts, Google and Nest speakers and TVs with Cast built in, found by their mDNS announcement (and catt, when it is installed).', os: ['linux', 'darwin', 'win32'] },
  { id: 'mdns', label: 'Bonjour / zeroconf', about: 'Everything that announces itself on the local network: AirPlay, printers, HomeKit, Spotify Connect, web pages, file shares, SSH.', os: ['linux', 'darwin', 'win32'] },
  { id: 'ssdp', label: 'UPnP / DLNA', about: 'Smart TVs, media players and servers, and the router, asked over UPnP; a media renderer can be played to.', os: ['linux', 'darwin', 'win32'] },
  { id: 'lan', label: 'Network neighbours', about: 'Every address this machine has talked to lately (its ARP table), with the maker of its network card and its name when the network gives one.', os: ['linux', 'darwin', 'win32'] },
  { id: 'bluetooth', label: 'Bluetooth', about: 'What this machine\'s Bluetooth adapter sees in 8 seconds, and what it knows already; a device can be paired from here (Linux).', os: ['linux', 'darwin'] },
  { id: 'homeassistant', label: 'Home Assistant', about: 'The lights, players, switches and the rest of the Home Assistant this hub is connected to.', os: ['linux', 'darwin', 'win32'] },
  { id: 'tailscale', label: 'Tailnet', about: 'The other machines and phones on this hub\'s tailnet (Tailscale).', os: ['linux', 'darwin', 'win32'] },
];

const isOn = id => { try { return require('../settings-schema').value(`nearby.sources.${id}`) === true; } catch { return false; } };

/** The sources with their switch, and when one cannot work here, why. */
function sources(platform = process.platform) {
  return SOURCES.map(s => ({ ...s, on: isOn(s.id), works: s.os.includes(platform), why: s.os.includes(platform) ? null : 'Not on this system yet.' }));
}

// Each source: what it returns → sightings, and why when it saw nothing it could.
const READ = {
  cast: async () => {
    const found = await require('./mdns').browse(['_googlecast._tcp'], { more: false });
    const list = found.filter(x => /^_googlecast/.test(x.type)).map(x => sight.cast(x));
    if (list.length) return { list };
    const c = await require('./others').catt();
    return { list: c.list.map(x => sight.cast(x, 'cast')), why: c.why };
  },
  mdns: async () => ({ list: (await require('./mdns').browse(MDNS_TYPES)).filter(x => !/^_googlecast/.test(x.type)).map(sight.mdns) }),
  ssdp: async () => ({ list: (await require('./ssdp').discover()).map(sight.upnp) }),
  lan: async () => ({ list: (await require('./lan').neighbours()).map(sight.lan) }),
  bluetooth: async () => { const r = await require('./bluetooth').look(); return { list: r.devices.map(sight.bluetooth), why: r.why }; },
  homeassistant: async () => { const r = await require('./others').homeAssistant(); return { list: r.list.map(sight.homeAssistant), why: r.why }; },
  tailscale: async () => { const r = await require('./others').tailscale(); return { list: r.list.map(sight.tailscale), why: r.why }; },
};

const own = () => new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(a => a.address));

const running = new Map();   // by looker: one scan at a time from each

// Each sighting says who saw it and on which named network (networks.js): a TV saved on a customer's Wi-Fi stays that Wi-Fi's.
function tag(things, by, network, at) {
  const net = require('./networks').remember(network, by)?.id || null;
  return things.map(t => ({ ...t, seenFrom: [{ by, label: network?.label || null, network: network?.gatewayMacHash || null, net, address: t.addresses?.[0] || null, at }] }));
}

/** A scan from one of the person's clients (lookers.js): its sightings, merged here like the hub's. */
async function fromClient({ from, only, why, person }) {
  const at = new Date().toISOString();
  const r = await require('./lookers').fromClient(from, person, only);
  const things = tag(merge.group(r.things), r.by, { ...r.network, label: r.label }, at);
  const all = merge.into(store.seen(), things, at);
  const bySource = {};
  for (const t of r.things) bySource[t.source] = (bySource[t.source] || 0) + 1;
  store.writeSeen(all, { at, sources: r.sources, found: things.length, bySource, why: r.why, from: { by: r.by, label: r.label } });
  require('../activity').note({ from: 'nearby', what: `looked for things nearby from ${r.label}: ${things.length} found`, why: `${why}; with ${r.sources.join(', ') || 'its sources'}`, person });
  return { things: all, found: things.length, bySource, why: r.why, at, from: r.label, sameNetwork: r.sameNetwork };
}

/**
 * Scan with the sources that are on (or `only` those of them) — from this hub, or `from` one of the person's clients
 * (lookers.js; the client's own switch is its family). Returns {things, found, bySource, why, at}. One scan at a time
 * from each looker: a second ask while one runs gets the same answer.
 */
function scan({ only = null, why = 'asked', person = null, read = READ, from = 'hub' } = {}) {
  const key = from || 'hub';
  if (running.has(key)) return running.get(key);
  const p = (key !== 'hub' ? fromClient({ from: key, only, why, person }) : (async () => {
    const at = new Date().toISOString();
    const ids = SOURCES.filter(s => isOn(s.id) && s.os.includes(process.platform) && (!only || only.includes(s.id))).map(s => s.id);
    if (!ids.length) return { things: store.seen(), found: 0, bySource: {}, why: {}, at, none: true };
    const results = await Promise.all(ids.map(id => read[id]().catch(e => ({ list: [], why: e.message }))));
    const bySource = {}, whys = {};
    ids.forEach((id, i) => { bySource[id] = results[i].list.length; if (!results[i].list.length && results[i].why) whys[id] = results[i].why; });
    const mine = own();
    const hubNet = await require('./lookers').hubNetwork().catch(() => null);
    const things = tag(merge.group(results.flatMap(r => r.list)).map(t => (t.addresses.some(a => mine.has(a)) ? { ...t, self: true, name: `${t.name} (this hub)` } : t)), 'hub', { ...hubNet, label: 'this hub' }, at);
    const all = merge.into(store.seen(), things, at);
    store.writeSeen(all, { at, sources: ids, found: things.length, bySource, why: whys });
    require('../activity').note({ from: 'nearby', what: `looked for things nearby: ${things.length} found`, why: `${why}; with ${ids.join(', ')}`, person });
    return { things: all, found: things.length, bySource, why: whys, at };
  })()).finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

const scanning = () => running.size > 0;

module.exports = { SOURCES, sources, scan, scanning, isOn, READ, MDNS_TYPES };

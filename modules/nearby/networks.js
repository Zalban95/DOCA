'use strict';

/**
 * Networks, named once (docs/design/cast-reach.md §1.3; asked 2026-10-14: "I connect to a customer's Wi-Fi and want to
 * show my setup … save the screen on that specific network for me to see in the app when I need to share through").
 * Every scan's looker says which network it is on (network.js: subnet, gateway, the router's card as a hash, the Wi-Fi's
 * name where the system gives it); each becomes one record here, kept in `nearby/networks` (store.js, never prefs):
 *   { id: 'net_<12 hex>', label, ssid, subnet, gateway, gatewayMacHash, firstSeen, lastSeen, seenBy: [...] }
 * so a TV saved on a customer's Wi-Fi is listed under that network, and the Cast sheet says whether one of the person's
 * lookers is there now. Identity is for grouping and saying, never for deciding who can reach a TV — a connection
 * decides that (relay.js, door.js). The SSID is kept as written (a person reads it); the router's MAC only as a hash.
 */
const crypto = require('crypto');
const store = require('../store');

const DOC = 'nearby/networks';
const NOW_MS = 30 * 60e3;   // a looker's network counts as "where it is now" for half an hour after it said so
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const clean = (v, max = 60) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) || null;

const read = () => store.readJson(DOC, { networks: [], at: {} });
const write = d => store.writeJson(DOC, d);
const list = () => read().networks;

/** Whether a reading is this record: the same router card, else the same subnet and gateway — and the same Wi-Fi name
 *  wherever both know one (two customers' 192.168.1.0/24 behind 192.168.1.1 are two networks). */
function matches(n, r) {
  if (n.ssid && r.ssid && n.ssid !== r.ssid) return false;
  if (n.gatewayMacHash && r.gatewayMacHash) return n.gatewayMacHash === r.gatewayMacHash;
  return !!r.subnet && n.subnet === r.subnet && !!r.gateway && n.gateway === r.gateway;
}

const idOf = r => `net_${crypto.createHash('sha256').update([r.gatewayMacHash || '', r.ssid || '', r.subnet || '', r.gateway || ''].join('|')).digest('hex').slice(0, 12)}`;

/** The name a person reads before they give one: the Wi-Fi's own, else the addresses. */
const defaultLabel = r => (r.ssid ? r.ssid : r.subnet ? `Network ${r.subnet}` : 'A network');

/**
 * A looker's reading: the record it is (made the first time), and that `by` (the hub, or a device id) is there now.
 * Null for a reading with nothing to know it by (no private subnet: a phone on mobile data).
 */
function remember(reading, by) {
  const r = reading || {};
  if (!r.subnet && !r.gatewayMacHash) return null;
  const d = read(), at = new Date().toISOString();
  let n = d.networks.find(x => matches(x, r));
  if (!n) {
    n = { id: idOf(r), label: defaultLabel(r), named: false, ssid: clean(r.ssid, 64), subnet: r.subnet || null, gateway: r.gateway || null,
      gatewayMacHash: r.gatewayMacHash || null, firstSeen: at, lastSeen: at, seenBy: [] };
    d.networks.push(n);
  }
  // What a later reading adds: a Wi-Fi name or a router card the first one could not read.
  if (!n.ssid && r.ssid) { n.ssid = clean(r.ssid, 64); if (!n.named) n.label = n.ssid; }
  if (!n.gatewayMacHash && r.gatewayMacHash) n.gatewayMacHash = r.gatewayMacHash;
  n.lastSeen = at;
  if (by && !n.seenBy.includes(by)) n.seenBy = [...n.seenBy, by].slice(-12);
  d.at = { ...(d.at || {}), ...(by ? { [by]: { net: n.id, at } } : {}) };
  d.networks = d.networks.sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen))).slice(0, 200);
  write(d);
  return n;
}

/** The network `by` said it was on in the last half hour, or null. */
function whereNow(by) {
  const a = read().at?.[by];
  return a && Date.now() - Date.parse(a.at) < NOW_MS ? a.net : null;
}

/** A person's name for a network ("Rossi's office"). */
function rename(id, label) {
  const d = read();
  const n = d.networks.find(x => x.id === id);
  if (!n) throw bad('No network by that id.', 404);
  const l = clean(label);
  if (!l) throw bad('Give it a name.');
  Object.assign(n, { label: l, named: true });
  write(d);
  return n;
}

function forget(id) {
  const d = read();
  if (!d.networks.some(x => x.id === id)) throw bad('No network by that id.', 404);
  write({ ...d, networks: d.networks.filter(x => x.id !== id) });
  return { forgot: id };
}

const get = id => list().find(x => x.id === id) || null;

module.exports = { list, get, remember, whereNow, rename, forget, matches, NOW_MS };

'use strict';

/**
 * Where Nearby looks from (docs/design/cast-reach.md §1.2, §1.5; R3f, the owner's yes of 2026-10-13): this hub, or one
 * of the person's own clients that lends the `nearby` family (PROTOCOL §22.5) and is connected now — a desk at home
 * while the hub is at the office. A client's scan is its own: it runs its readers and returns sightings, which are
 * merged here like the hub's, each thing remembering who saw it (`seenFrom`).
 *
 * Private addresses are kept apart across networks: a client on another network than the hub's (another gateway)
 * has its 192.168.1.5 keyed as `ip:192.168.1.5@<device>`, so it never joins the hub's 192.168.1.5. Only the person's
 * own devices are offered, never another person's (Nearby is a host's page; a member's own Nearby is later).
 */
const net = require('./network');

let hubNet = null;
/** The hub's own network, kept a minute (no reverse lookups: only the gateway is wanted). */
async function hubNetwork() {
  if (hubNet && Date.now() - hubNet.t < 60e3) return hubNet.v;
  const neighbours = await require('./lan').neighbours({ dns: { reverse: async () => [] } }).catch(() => []);
  const v = await net.network({ neighbours });
  hubNet = { t: Date.now(), v };
  return v;
}

/** The running MCP servers of `person`'s own devices that offer nearby_scan: [{id: server id, deviceId, label}]. */
function clients(person) {
  const reg = require('../mcp/registry');
  const devices = require('../api-v1/devices');
  return reg.list().filter(s => s.origin?.kind === 'client' && s.state === 'running' && (s.tools || []).some(t => t.name === 'nearby_scan'))
    .map(s => ({ s, d: devices.get(s.origin.deviceId) }))
    .filter(({ d }) => d && !d.revokedAt && (!person?.id || d.userId === person.id))
    .map(({ s, d }) => ({ id: s.id, deviceId: d.id, label: d.name }));
}

/** The choices for "Look from": the hub first, then the person's clients. */
function list(person) {
  return [{ id: 'hub', label: `This hub (${require('os').hostname()})`, kind: 'hub' }, ...clients(person).map(c => ({ ...c, kind: 'client' }))];
}

/** One client's scan: its sightings, with private addresses kept to its network when that is not the hub's. */
async function fromClient(serverId, person, only = null) {
  const c = clients(person).find(x => x.id === serverId);
  if (!c) throw Object.assign(new Error('That device is not one of yours lending Nearby right now (it lends the nearby family, and is connected).'), { status: 404 });
  const cl = require('../mcp/registry').client(c.id);
  const text = await cl.callTool('nearby_scan', only ? { sources: only } : {});
  let r;
  try { r = JSON.parse(text); } catch { throw Object.assign(new Error(`${c.label} did not answer with a scan: ${String(text).slice(0, 200)}`), { status: 502 }); }
  const same = net.sameNetwork(r.network, await hubNetwork());
  const things = (r.things || []).filter(t => t && Array.isArray(t.keys)).map(t => (same ? t : { ...t, keys: t.keys.map(k => (k.startsWith('ip:') ? `${k}@${c.deviceId}` : k)) }));
  return { things, network: r.network || null, why: r.why || {}, sources: r.sources || [], by: c.deviceId, label: c.label, sameNetwork: same };
}

module.exports = { list, clients, fromClient, hubNetwork };

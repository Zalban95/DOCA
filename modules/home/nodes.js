'use strict';

/**
 * Homes read through a home node (docs/design/home-node.md): a paired device in the household — doca-client on a mini
 * PC, a Pi, a NAS — that keeps Home Assistant's address and token itself and lends the family `home` over the socket
 * it dials to the hub (mcp/socket-hosts.js). The hub never holds the token and never reaches into the home: it asks the
 * node's tools (home_states, home_call, home_camera, PROTOCOL §22.4) and hears its pushes (`notifications/doca/home`).
 *
 * A node is a device that granted `home` (and DOCA has not revoked it) and whose server a person accepted. Each is a
 * home with a name (the device's) and an id (that name as a slug: allot patterns may name `<id>/<entity>`). What it
 * last said is kept — in memory and in the store, so a restart still shows it — and when the node is away the page
 * draws it greyed with when it was last seen, and acting is refused with a sentence.
 */
const store = require('../store');
const live = require('../live');

const DOC = 'home-nodes';
const FRESH_MS = 60000;
const N = new Map();   // deviceId → { view, at, seen, tiles: Map(entity → tile) }
let _persist = null;

const registry = () => require('../mcp/registry');
const sockets = () => require('../mcp/socket-hosts');
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'home';

function entry(deviceId) {
  if (!N.has(deviceId)) {
    const kept = store.readJson(DOC, {})[deviceId] || {};
    const e = { view: kept.view || null, at: kept.at || null, seen: kept.seen || null, tiles: new Map() };
    for (const a of e.view?.areas || []) for (const t of a.tiles) e.tiles.set(t.id, t);
    N.set(deviceId, e);
  }
  return N.get(deviceId);
}

/** What was last heard is kept on disk a few seconds after it changes (a busy house is many changes a minute). */
function persist() {
  if (_persist) return;
  _persist = setTimeout(() => {
    _persist = null;
    const doc = {};
    for (const [id, e] of N) doc[id] = { view: e.view, at: e.at, seen: e.seen };
    store.writeJson(DOC, doc);
  }, 3000);
  _persist.unref?.();
}

/** The nodes there are: {deviceId, id, name, online, seen}, ids unique. */
function list() {
  const ctl = require('../devices-control'), devices = require('../api-v1/devices');
  const out = [], taken = new Set(['hub']);
  for (const d of devices.list ? devices.list() : []) {
    if (d.revokedAt || !ctl.state(d.id).usable.includes('home')) continue;
    const spec = registry().forDevice(d.id);
    if (!spec) continue;
    let id = slug(d.name), n = 2;
    while (taken.has(id)) id = `${slug(d.name)}-${n++}`;
    taken.add(id);
    const e = entry(d.id);
    out.push({ deviceId: d.id, serverId: spec.id, id, name: d.name, online: online(d.id), seen: e.seen || d.lastSeenAt || null });
  }
  return out;
}

const online = deviceId => {
  const spec = registry().forDevice(deviceId);
  return !!spec && registry().client(spec.id)?.state === 'running' && (spec.transport !== 'socket' || sockets().connectedNow(deviceId));
};

/** One of the node's tools, raw: the JSON it answered, or an Error with its words. */
async function tool(deviceId, name, args = {}) {
  const spec = registry().forDevice(deviceId);
  const c = spec && registry().client(spec.id);
  if (!c || c.state !== 'running') throw Object.assign(new Error('The home node is not connected.'), { status: 503 });
  const res = await c.request('tools/call', { name, arguments: args });
  const text = (res?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  if (res?.isError) throw Object.assign(new Error(text || `${name} failed on the home node.`), { status: /no |not /i.test(text) ? 404 : 502 });
  const image = (res?.content || []).find(x => x.type === 'image');
  let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { body, image };
}

/** Reads the whole home from the node again. */
async function refresh(deviceId) {
  const e = entry(deviceId);
  const { body } = await tool(deviceId, 'home_states');
  e.view = { connected: !!body?.connected, error: body?.error || null, place: body?.place || null, version: body?.version || null, units: body?.units || null,
    areas: Array.isArray(body?.areas) ? body.areas : [] };
  e.tiles = new Map();
  for (const a of e.view.areas) for (const t of a.tiles || []) e.tiles.set(t.id, t);
  e.at = e.seen = new Date().toISOString();
  persist();
  return e;
}

/** The node's home: fresh when it is online (read again when older than a minute), else what it last said, marked. */
async function snapshot(node) {
  const e = entry(node.deviceId);
  if (node.online && (!e.view || Date.now() - Date.parse(e.at || 0) > FRESH_MS || e.stale)) {
    try { await refresh(node.deviceId); e.stale = false; } catch (err) { e.error = err.message; }
  }
  const base = e.view || { connected: false, areas: [] };
  if (!node.online) return { ...base, connected: false, offline: true, seen: node.seen, at: e.at,
    error: `The home node ${node.name} is away${node.seen ? ` — last seen ${node.seen}` : ''}. What it last said is shown greyed; nothing can be done until it is back.` };
  return { ...base, seen: e.seen, at: e.at, ...(e.error && !e.view ? { error: e.error } : {}) };
}

/** A push from a node: one entity's new tile, or "read me again". */
function heard(deviceId, msg) {
  if (msg.method !== 'notifications/doca/home') return;
  const node = list().find(n => n.deviceId === deviceId);
  if (!node) return;   // not (or no longer) a home: nothing it says is drawn
  const e = entry(deviceId), p = msg.params || {};
  e.seen = new Date().toISOString();
  if (p.what === 'state' && p.tile && p.id === p.tile.id) {
    e.tiles.set(p.id, p.tile);
    for (const a of e.view?.areas || []) a.tiles = a.tiles.map(t => (t.id === p.id ? p.tile : t));
    persist();
    return live.changed('home', p.id, 'state', { tile: p.tile, home: node.id });
  }
  e.stale = true;   // removed, layout, status: the page reads it all again
  live.changed('home', p.id || null, p.what === 'removed' ? 'removed' : p.what === 'layout' ? 'layout' : 'status', { home: node.id });
}

/** An entity as the node last described it, for actions.js. */
const tileOf = (deviceId, id) => entry(deviceId).tiles.get(id) || null;

let _started = false;
function start() {
  if (_started) return;
  _started = true;
  const ev = sockets().events;
  ev.on('notification', heard);
  const status = deviceId => { const n = list().find(x => x.deviceId === deviceId); if (n) { entry(deviceId).stale = true; entry(deviceId).seen = new Date().toISOString(); persist(); live.changed('home', null, 'status', { home: n.id }); } };
  ev.on('down', status);
  // Up: its server starts a moment later (registry.wakeForDevice); say so once it runs.
  ev.on('up', deviceId => { let n = 0; const t = setInterval(() => { if (online(deviceId) || ++n > 40) { clearInterval(t); status(deviceId); } }, 250); t.unref?.(); });
}

module.exports = { list, online, snapshot, refresh, tool, tileOf, heard, start, slug, _nodes: N };

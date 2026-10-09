'use strict';

/**
 * The home in DOCA's own layout (TODO H10.10, asked 2026-10-06): Home Assistant stays the device layer — its thousands
 * of integrations, its areas, scenes and automations — and DOCA draws its own Home page from it.
 *
 * Where HA is read from is a source (asked 2026-10-09: "the server sometimes could be remote"):
 *   direct.js  the hub itself, one WebSocket signed in with the key for services `home-assistant` — a hub on the
 *              household's own network (home id `hub`);
 *   nodes.js   a home node — a paired device in the household that keeps HA's token itself and lends the family
 *              `home` over the socket it dials out — one home per node (id: its name as a slug).
 * `home.source` (settings-schema.js) chooses: `auto` reads the nodes when there is one — always on a hosted hive,
 * where the hub cannot reach a home's network — else the hub itself; `node`, `direct`, `both` as they say. Several
 * homes (a family's two houses, a customer's sites) are listed and the page switches between them.
 *
 * Whose home: the hive's. Anyone signed in may see it and anyone who may talk to the agent may use it (rights.js),
 * narrowed per entity by the resource kind `home` (auth/allot.js): a level listing `home: ['light.*', 'mare/*', …]`
 * sees and uses only those — a pattern names an entity in every home, or `<home>/<entity>` in one — and a grant
 * `use:home:<entity>` adds one back. Unlocking and disarming ask for the password (auth/guarded.js).
 */
const direct = require('./direct');
const nodes = require('./nodes');
const live = require('../live');

const holders = new Set();   // screens holding the Home page

/** The homes there are, in the order the switcher shows them: {id, name, kind, online, seen, deviceId?}. */
function homes() {
  const source = require('../settings-schema').value('home.source');
  const ns = source === 'direct' ? [] : nodes.list();
  const hosted = require('../hosted').on();
  const useDirect = source === 'direct' || source === 'both' || (source === 'auto' && !ns.length && !hosted);
  const out = ns.map(n => ({ id: n.id, name: n.name, kind: 'node', deviceId: n.deviceId, online: n.online, seen: n.seen }));
  if (useDirect) out.unshift({ id: direct.ID, name: 'This hub', kind: 'direct', online: true });
  return out;
}

const pick = id => { const hs = homes(); return hs.find(h => h.id === id) || hs[0] || null; };

/** Whether a person may see and use an entity of a home: a pattern for every home, or `<home>/<entity>`. */
function allowed(person, id, home = direct.ID) {
  const allot = require('../auth/allot');
  return allot.uses(person, 'home', id) || allot.uses(person, 'home', `${home}/${id}`);
}

/** The home as one person sees it: the homes there are, then the chosen one's areas and tiles. */
async function view(person, homeId) {
  const hs = homes();
  const h = pick(homeId);
  const list = hs.map(x => ({ id: x.id, name: x.name, kind: x.kind, online: x.online, seen: x.seen || null }));
  if (!h) return { connected: false, homes: list, setup: { key: direct.KEY, where: 'Field → Connectors → Keys for services', node: 'doca-client home setup' } };
  const raw = h.kind === 'direct' ? await direct.snapshot() : await nodes.snapshot(nodes.list().find(n => n.id === h.id));
  const areas = (raw.areas || []).map(a => ({ ...a, tiles: a.tiles.filter(t => allowed(person, t.id, h.id)) })).filter(a => a.tiles.length);
  if (raw.setup && h.kind === 'direct') raw.setup.node = 'doca-client home setup';
  return { ...raw, home: h.id, homeName: h.name, kind: h.kind, homes: list, areas };
}

/** The home an entity is acted on in: {home, kind, has(id), send(msg), camera(id)}; throws when there is none or it is away. */
function source(homeId) {
  const h = pick(homeId);
  if (!h || (homeId && h.id !== homeId)) throw Object.assign(new Error(`There is no home ${homeId || 'here'}.`), { status: 404 });
  if (h.kind === 'direct') return { home: h.id, kind: 'direct', has: id => !!direct.stateOf(id) && direct.shown(id), ready: () => direct.ensure(),
    send: msg => direct.callService(msg), camera: id => direct.still(id) };
  if (!h.online) throw Object.assign(new Error(`The home node ${h.name} is away${h.seen ? ` (last seen ${h.seen})` : ''}: nothing can be done there until it is back.`), { status: 409, code: 'node_away' });
  return { home: h.id, kind: 'node', deviceId: h.deviceId, has: id => !!nodes.tileOf(h.deviceId, id), ready: () => nodes.snapshot({ ...h, online: true }),
    send: msg => nodes.tool(h.deviceId, 'home_call', { domain: msg.domain, service: msg.service, entity_id: msg.target.entity_id, data: msg.service_data }),
    camera: async id => { const { image } = await nodes.tool(h.deviceId, 'home_camera', { entity_id: id }); if (!image) throw Object.assign(new Error('The node sent no picture.'), { status: 502 }); return { type: image.mimeType, buf: Buffer.from(image.data, 'base64') }; } };
}

/** A page holds the Home page open (or lets go): the hub's own connection stays while anyone holds it; nodes push anyway. */
async function hold(screen, on = true) {
  if (on) holders.add(screen); else holders.delete(screen);
  const d = await direct.hold(screen, on && homes().some(h => h.kind === 'direct'));
  return { holding: holders.has(screen), connected: d.connected };
}

/** Whether a live change goes to this screen: it holds the page, and its person may see that entity in that home. */
const hears = (screen, person, id, change = {}) => holders.has(screen) && (!id || allowed(person, id, change.home || direct.ID));

let _listening = false;
function start() {
  if (_listening) return;
  _listening = true;
  nodes.start();
  live.feed.on('screen-closed', screen => { if (holders.has(screen)) hold(screen, false); });
}

module.exports = { start, homes, view, source, hold, hears, allowed, close: direct.close, KEY: direct.KEY };

'use strict';

/**
 * The home read by the hub itself (the source `direct`; index.js composes the homes): one WebSocket to Home Assistant
 * (link.js), signed in with the key for services `home-assistant` (its origin is HA's address; the token never reaches
 * a browser) — for a hub on the household's own network. A hub elsewhere (a hosted hive) reads a home through a home
 * node in the household instead (nodes.js, docs/design/home-node.md).
 *
 * Opened only while a Home page holds it (`hold`, through the page's live stream) or something asks (`ensure`), and
 * closed a minute after the last of them. While open, the states are cached and every `state_changed` goes out on the
 * live feed as a `home` change (home `hub`) carrying the entity's new tile; index.js decides who hears it.
 */
const link = require('./link');
const { tileOf, hiddenByRegistry, DOMAINS } = require('./tiles');
const ID = 'hub';   // this home's id: allot patterns may name `hub/<entity>`
const live = require('../live');

const KEY = 'home-assistant';
const IDLE_MS = 60000;
const S = { link: null, opening: null, error: null, failedAt: 0, version: null, config: null,
  states: new Map(), areas: new Map(), devArea: new Map(), reg: new Map(), holders: new Set(), lastUse: 0, sweep: null, retry: null };

/** The key: {origin, value} or null when none is kept. */
const keyOf = () => require('../service-keys').secretOf(KEY);

async function registries() {
  const c = S.link;
  const safe = p => p.catch(() => []);   // a token of a non-admin HA user cannot read the registries: no areas, still a home
  const [areas, devices, entities] = await Promise.all([safe(c.cmd('config/area_registry/list')), safe(c.cmd('config/device_registry/list')), safe(c.cmd('config/entity_registry/list'))]);
  S.areas = new Map((areas || []).map(a => [a.area_id, a.name]));
  S.devArea = new Map((devices || []).filter(d => d.area_id).map(d => [d.id, d.area_id]));
  S.reg = new Map((entities || []).map(e => [e.entity_id, e]));
}

function onEvent(ev) {
  if (ev?.event_type === 'state_changed') {
    const { entity_id: id, new_state: now } = ev.data || {};
    if (!id) return;
    if (!now) { S.states.delete(id); return live.changed('home', id, 'removed', { home: ID }); }
    S.states.set(id, now);
    const tile = shown(id) ? tileOf(now, S.reg.get(id)) : null;
    if (tile) live.changed('home', id, 'state', { tile, home: ID });
    return;
  }
  if (/_registry_updated$/.test(ev?.event_type || '')) { clearTimeout(S.regTimer); S.regTimer = setTimeout(() => registries().then(() => live.changed('home', null, 'layout', { home: ID })).catch(() => {}), 1000); }
}

function onClose() {
  S.link = null;
  live.changed('home', null, 'status', { home: ID });
  if (S.holders.size && !S.retry) S.retry = setTimeout(() => { S.retry = null; ensure().catch(() => {}); }, 5000);   // a page is still looking
}

/** Opens the connection if it is not open. Throws (with status) when no key is kept or HA refuses. */
async function ensure() {
  S.lastUse = Date.now();
  const k = keyOf();
  if (S.link && (!k?.value || k.origin !== S.origin || k.value !== S.token)) close();   // the key was changed or removed: start again with it
  if (S.link) return S.link;
  if (S.opening) return S.opening;
  if (!k?.value) throw Object.assign(new Error('No key named home-assistant: paste Home Assistant\'s long-lived token, with its address, in Field → Connectors → Keys for services.'), { status: 404, code: 'no_key' });
  if (S.error && S.failedWith === `${k.origin} ${k.value}` && Date.now() - S.failedAt < 10000) throw S.error;   // not a new attempt per page load while HA says no to this key
  S.opening = (async () => {
    const c = await link.open({ origin: k.origin, token: k.value, onEvent, onClose });
    S.link = c; S.version = c.version; S.origin = k.origin; S.token = k.value;
    try {
      const [config, states] = await Promise.all([c.cmd('get_config').catch(() => null), c.cmd('get_states')]);
      S.config = config;
      S.states = new Map((states || []).map(s => [s.entity_id, s]));
      await registries();
      await c.cmd('subscribe_events', { event_type: 'state_changed' });
      for (const t of ['area_registry_updated', 'entity_registry_updated', 'device_registry_updated']) await c.cmd('subscribe_events', { event_type: t }).catch(() => {});
    } catch (e) { S.link = null; c.close(); throw e; }
    S.error = null;
    if (!S.sweep) { S.sweep = setInterval(sweep, 15000); S.sweep.unref?.(); }
    live.changed('home', null, 'status', { home: ID });
    return c;
  })();
  try { return await S.opening; }
  catch (e) { S.error = e; S.failedAt = Date.now(); S.failedWith = `${k.origin} ${k.value}`; throw e; }
  finally { S.opening = null; }
}

/** Nobody looking for a minute: the connection closes, the cache goes with it. */
function sweep() {
  if (S.holders.size || Date.now() - S.lastUse < IDLE_MS) return;
  close();
}

function close() {
  clearInterval(S.sweep); S.sweep = null; clearTimeout(S.retry); S.retry = null;
  const c = S.link; S.link = null; S.token = null;
  c?.close();
  S.states.clear();
}

/** Whether an entity is on the page at all: a kind it draws, not kept off by HA's registry. */
const shown = id => DOMAINS.includes(id.split('.')[0]) && !hiddenByRegistry(S.reg.get(id));

const areaOf = id => { const r = S.reg.get(id); return r?.area_id || (r?.device_id && S.devArea.get(r.device_id)) || null; };

/** The whole home (index.js narrows it per person): areas with their tiles, the things in no area last. */
async function snapshot() {
  const k = keyOf();
  if (!k?.value) { if (S.link) close(); return { connected: false, setup: { key: KEY, where: 'Field → Connectors → Keys for services' } }; }
  try { await ensure(); } catch (e) { return { connected: false, origin: k.origin, error: e.message }; }
  const groups = new Map();
  for (const [id, s] of S.states) {
    if (!shown(id)) continue;
    const tile = tileOf(s, S.reg.get(id));
    if (!tile) continue;
    const area = areaOf(id) || '';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(tile);
  }
  const order = t => DOMAINS.indexOf(t.domain);
  const areas = [...groups].map(([id, tiles]) => ({ id: id || null, name: id ? S.areas.get(id) || id : 'Elsewhere', tiles: tiles.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => (!a.id) - (!b.id) || a.name.localeCompare(b.name));
  return { connected: true, origin: k.origin, place: S.config?.location_name || null, version: S.version, units: S.config?.unit_system || null, areas };
}

/** A page holds the Home page open (or lets go): the connection stays while anyone holds it. */
async function hold(screen, on = true) {
  if (on) S.holders.add(screen); else { S.holders.delete(screen); S.lastUse = Date.now(); }
  if (on) await ensure().catch(() => {});
  return { holding: S.holders.has(screen), connected: !!S.link };
}

/** One entity's state as cached, for actions.js and the camera. */
const stateOf = id => S.states.get(id) || null;

/** A camera's still, with the token, which stays on the hub. */
async function still(id) {
  const k = keyOf();
  const r = await fetch(new URL(`/api/camera_proxy/${encodeURIComponent(id)}`, k.origin), { headers: { Authorization: `Bearer ${k.value}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Object.assign(new Error(`Home Assistant gave no picture for ${id} (HTTP ${r.status}).`), { status: 502 });
  const buf = Buffer.from(await r.arrayBuffer());
  return { type: String(r.headers.get('content-type') || ''), buf };
}

/** Sends HA one call_service the caller checked. */
async function callService(msg) { const c = await ensure(); await c.cmd('call_service', msg); }

module.exports = { ID, KEY, ensure, snapshot, hold, stateOf, shown, keyOf, still, callService, close, sweep, _state: S };

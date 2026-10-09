'use strict';

/**
 * doca-client as a home node (docs/design/home-node.md): the family `home`. This machine — a mini PC, a Pi, a NAS that
 * stays on in the household — keeps Home Assistant's address and long-lived token itself (`doca-client home setup`,
 * in its own config, 0600) and its WebSocket to HA open on the home network. The hub never holds the token and never
 * needs to reach the home: the node lends three tools over the socket it dials out (socket.js) and pushes each change.
 *
 *   home_states {}                                    the home: place, areas, each entity a tile (home-shared.js)
 *   home_call {domain, service, entity_id, data}      one service on one entity, from the same short list as the hub
 *   home_camera {entity_id}                           a camera's still, as MCP image content
 *   notifications/doca/home {what, id, tile}          pushed up: state (a tile), removed, layout, status
 *
 * HA's protocol is the hub's (modules/home/link.js): auth_required → auth → auth_ok; numbered commands; events.
 */
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { connect } = require('./ws-lite');
const shared = require('./home-shared');

const CMD_MS = 15000;
const H = { ws: null, opening: null, seq: 0, pending: new Map(), states: new Map(), areas: new Map(), devArea: new Map(), reg: new Map(),
  config: null, version: null, error: null, since: null, cfg: null, retry: null, backoff: 1000, stopped: true, events: new EventEmitter() };

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wsUrl = origin => { const u = new URL('/api/websocket', origin); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.toString(); };
const say = (what, extra = {}) => H.events.emit('change', { what, ...extra });

function cmd(type, extra = {}) {
  return new Promise((ok, no) => {
    if (!H.ws) return no(bad('Home Assistant is not connected from this node.', 503));
    const id = ++H.seq;
    const t = setTimeout(() => { H.pending.delete(id); no(bad(`Home Assistant did not answer ${type} in ${CMD_MS / 1000} s.`, 504)); }, CMD_MS);
    H.pending.set(id, { ok, no, t });
    H.ws.send(JSON.stringify({ id, type, ...extra }));
  });
}

/** Signs in to HA and reads the home. Resolves when the states are read; rejects with HA's reason. */
function open() {
  const { url, token } = H.cfg.home || {};
  if (!url || !token) return Promise.reject(bad('This node has no Home Assistant yet: doca-client home setup', 404));
  return H.opening || (H.opening = (async () => {
    const ws = await connect(wsUrl(url), { timeoutMs: 10000 });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { ws.terminate(); reject(bad(`Home Assistant at ${url} did not sign in within 10 s.`, 504)); }, 10000);
      ws.on('message', raw => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.type === 'auth_required') return ws.send(JSON.stringify({ type: 'auth', access_token: token }));
        if (m.type === 'auth_ok') { clearTimeout(t); H.version = m.ha_version || null; return resolve(); }
        if (m.type === 'auth_invalid') { clearTimeout(t); ws.terminate(); return reject(bad(`Home Assistant refused the token (${m.message || 'invalid'}) — run doca-client home setup with a new long-lived token.`, 401)); }
        if (m.type === 'event') return onEvent(m.event);
        if (m.type === 'result' && H.pending.has(m.id)) {
          const p = H.pending.get(m.id); H.pending.delete(m.id); clearTimeout(p.t);
          if (m.success) p.ok(m.result); else p.no(bad(`Home Assistant: ${m.error?.message || m.error?.code || 'refused'}`));
        }
      });
      ws.on('close', () => { clearTimeout(t); reject(bad(`Home Assistant at ${url} closed the connection.`, 502)); onClose(ws); });
      ws.on('error', () => { /* close follows */ });
    });
    H.ws = ws;
    const safe = p => p.catch(() => []);   // a non-admin HA user cannot read the registries: no areas, still a home
    const [config, states, areas, devices, entities] = await Promise.all([cmd('get_config').catch(() => null), cmd('get_states'),
      safe(cmd('config/area_registry/list')), safe(cmd('config/device_registry/list')), safe(cmd('config/entity_registry/list'))]);
    H.config = config;
    H.states = new Map((states || []).map(s => [s.entity_id, s]));
    registries(areas, devices, entities);
    await cmd('subscribe_events', { event_type: 'state_changed' });
    for (const t of ['area_registry_updated', 'entity_registry_updated', 'device_registry_updated']) await cmd('subscribe_events', { event_type: t }).catch(() => {});
    H.error = null; H.since = new Date().toISOString(); H.backoff = 1000;
    say('status');
  })().catch(e => { H.error = e.message; if (H.ws) { H.ws.terminate(); H.ws = null; } throw e; }).finally(() => { H.opening = null; }));
}

function registries(areas, devices, entities) {
  H.areas = new Map((areas || []).map(a => [a.area_id, a.name]));
  H.devArea = new Map((devices || []).filter(d => d.area_id).map(d => [d.id, d.area_id]));
  H.reg = new Map((entities || []).map(e => [e.entity_id, e]));
}

function onEvent(ev) {
  if (ev?.event_type === 'state_changed') {
    const { entity_id: id, new_state: now } = ev.data || {};
    if (!id) return;
    if (!now) { H.states.delete(id); return say('removed', { id }); }
    H.states.set(id, now);
    const tile = shown(id) ? shared.tileOf(now, H.reg.get(id)) : null;
    if (tile) say('state', { id, tile });
    return;
  }
  if (/_registry_updated$/.test(ev?.event_type || '')) {
    clearTimeout(H.regTimer);
    H.regTimer = setTimeout(async () => {
      try { registries(...await Promise.all(['area', 'device', 'entity'].map(k => cmd(`config/${k}_registry/list`).catch(() => [])))); say('layout'); } catch { /* next time */ }
    }, 1000);
  }
}

function onClose(ws) {
  if (H.ws !== ws) return;
  H.ws = null;
  for (const p of H.pending.values()) { clearTimeout(p.t); p.no(bad('The connection to Home Assistant closed.', 502)); }
  H.pending.clear();
  H.error = H.error || 'Home Assistant closed the connection';
  say('status');
  again();
}

/** HA restarting, the Wi-Fi dropping: try again, waiting longer each time (up to a minute). */
function again() {
  if (H.stopped || H.retry) return;
  H.retry = setTimeout(() => { H.retry = null; open().catch(() => again()); }, H.backoff);
  H.retry.unref?.();
  H.backoff = Math.min(60000, H.backoff * 2);
}

/** Starts keeping the link (doca-client run with home lent). */
function start(cfg) { H.cfg = cfg; H.stopped = false; return open().catch(e => { again(); return e; }); }
function stop() { H.stopped = true; clearTimeout(H.retry); H.retry = null; const ws = H.ws; H.ws = null; ws?.close(); }

const shown = id => shared.DOMAINS.includes(id.split('.')[0]) && !shared.hiddenByRegistry(H.reg.get(id));
const areaOf = id => { const r = H.reg.get(id); return r?.area_id || (r?.device_id && H.devArea.get(r.device_id)) || null; };

/** The whole home as tiles in areas; the hub narrows it to what each person may see. */
function view() {
  const groups = new Map();
  for (const [id, s] of H.states) {
    if (!shown(id)) continue;
    const tile = shared.tileOf(s, H.reg.get(id));
    if (!tile) continue;
    const area = areaOf(id) || '';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(tile);
  }
  const order = t => shared.DOMAINS.indexOf(t.domain);
  const areas = [...groups].map(([id, tiles]) => ({ id: id || null, name: id ? H.areas.get(id) || id : 'Elsewhere', tiles: tiles.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => (!a.id) - (!b.id) || a.name.localeCompare(b.name));
  return { connected: !!H.ws, error: H.ws ? null : H.error, since: H.since, place: H.config?.location_name || null, version: H.version, units: H.config?.unit_system || null, areas };
}

async function call(args) {
  const msg = shared.checkCall(args || {});
  if (!H.ws) await open();
  const id = msg.target.entity_id;
  if (!H.states.get(id) || !shown(id)) throw bad(`Home Assistant has no ${id}.`, 404);
  await cmd('call_service', msg);
  return { ok: true, entity_id: id, service: `${msg.domain}.${msg.service}` };
}

/** A camera's still, fetched here with the token, which stays here. */
function camera({ entity_id: id } = {}) {
  if (!/^camera\.[a-z0-9_]+$/.test(String(id || '')) || !H.states.get(id) || !shown(id)) return Promise.reject(bad(`No camera ${id}.`, 404));
  const { url, token } = H.cfg.home;
  const u = new URL(`/api/camera_proxy/${encodeURIComponent(id)}`, url);
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).get(u, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }, res => {
      const parts = []; let n = 0;
      res.on('data', d => { n += d.length; if (n > 5 * 1024 * 1024) req.destroy(bad('The camera\'s picture is too large to pass on.', 502)); else parts.push(d); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(bad(`Home Assistant gave no picture for ${id} (HTTP ${res.statusCode}).`, 502));
        const type = String(res.headers['content-type'] || '').split(';')[0].trim();
        resolve({ image: { data: Buffer.concat(parts).toString('base64'), mimeType: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type) ? type : 'image/jpeg' } });
      });
    });
    req.on('timeout', () => req.destroy(bad('The camera did not answer in 10 s.', 504)));
    req.on('error', reject);
  });
}

/** The family's tools, in doca-client's shape (TOOLS). */
const TOOLS = {
  home_states: { family: 'home', description: 'The home this node keeps: Home Assistant\'s areas and, in each, a tile per light, switch, cover, thermostat, lock, sensor, camera… (state and a few attributes).', input: {},
    run: () => view() },
  home_call: { family: 'home', description: 'Ask Home Assistant to do one thing to one entity: a service from a short list per kind (light turn_on with brightness_pct, cover open_cover, climate set_temperature, lock lock/unlock…).',
    input: { domain: 'string', service: 'string', entity_id: 'string', data: 'object' }, run: (_c, a) => call(a) },
  home_camera: { family: 'home', description: 'A camera\'s picture, now.', input: { entity_id: 'string' }, run: (_c, a) => camera(a) },
};

/** `doca-client home setup`: HA's address and a long-lived token, asked here and kept here (0600), checked first. */
async function setup(cfg, { ask, save, log }) {
  const url = String(await ask('Home Assistant\'s address (for example http://homeassistant.local:8123): ')).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(url)) throw new Error('That is not an address like http://homeassistant.local:8123.');
  const token = String(await ask('A long-lived access token (HA: your profile → Security → Long-lived access tokens): ', { secret: true })).trim();
  if (!token) throw new Error('No token: nothing was kept.');
  H.cfg = { home: { url, token } };
  try { await open(); } finally { stop(); }
  const n = view().areas.reduce((s, a) => s + a.tiles.length, 0);
  cfg.home = { url, token, at: new Date().toISOString() };
  cfg.transport = 'socket';   // a node dials its hub: nothing at home has to be reachable
  save(cfg);
  log(`✓ Home Assistant ${H.version || ''} at ${url} answers: ${n} thing(s) to draw. The token stays in this machine's config.\n  Next: doca-client run — it asks whether to lend "home" (or --grant home), then accept its offer once in the hub's MCP tab.`);
}

module.exports = { TOOLS, start, stop, view, call, camera, setup, events: H.events, _state: H };

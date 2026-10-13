'use strict';

/**
 * Draw my hive (R16, queue 30, asked 2026-10-12): the hive as one picture, made from DOCA's own records — this hub, the
 * people's devices, the machines, the models in use, the MCP servers and connections, and the things saved nearby —
 * each a node with the facts its own module keeps, and a link for every relation a record names: a server a device
 * hosts, a thing a device saw, the model the agent uses. Mechanical (visibility-mechanical): no model draws or words it.
 * GET /api/machines/map (host, with the rest of /api/machines); Machines → Map draws it (public/js/hive-map.js).
 */
const os = require('os');

const safe = (fn, d = []) => { try { return fn() ?? d; } catch { return d; } };
const COL = { people: 'people', devices: 'devices', hub: 'hub', machines: 'machines', field: 'field', around: 'around' };

async function map() {
  const nodes = [], links = [];
  const add = n => { nodes.push(n); return n.id; };
  const hub = add({ id: 'hub', col: COL.hub, kind: 'hub', label: os.hostname(), detail: `DOCA ${require('../../package.json').version} · ${process.platform}` });

  // People and their devices (paired clients; browsers are screens — counted per person, not drawn one by one).
  const auth = require('../auth/store');
  const people = new Map();
  const person = id => {
    if (!id) return null;
    if (!people.has(id)) { const u = safe(() => auth.userById(id), null); people.set(id, add({ id: `p:${id}`, col: COL.people, kind: 'person', label: u?.name || u?.email || 'someone', detail: '', screens: 0 })); }
    return people.get(id);
  };
  const devices = safe(() => require('../api-v1/devices').list()).filter(d => !d.revokedAt);
  const online = id => safe(() => require('../api-v1/bus').isOnline(id), false);
  for (const d of devices) {
    if (d.kind === 'browser') { const p = person(d.userId); if (p) nodes.find(n => n.id === p).screens++; continue; }
    const id = add({ id: `d:${d.id}`, col: COL.devices, kind: d.kind || 'device', label: d.name, detail: `${d.kind || 'device'}${online(d.id) ? ' · connected' : ''}`, up: online(d.id) });
    links.push({ from: id, to: hub, label: 'paired' });
    const p = person(d.userId);
    if (p) links.push({ from: p, to: id, label: '' });
  }
  for (const n of nodes) if (n.kind === 'person') n.detail = n.screens ? `${n.screens} screen${n.screens === 1 ? '' : 's'}` : '';

  // Machines: containers, the agents' computers, VMs and VNC screens (machines/rows.js, the status column's own rows).
  const r = await require('./rows').rows().catch(() => ({ rows: [] }));
  for (const m of r.rows || []) {
    if (m.kind === 'container' && m.point !== 'up') continue;   // stopped containers are counted, not drawn
    const id = add({ id: `m:${m.kind}:${m.id}`, col: COL.machines, kind: m.kind, label: m.name, detail: m.detail || m.state || '', up: m.point === 'up' });
    links.push({ from: hub, to: id, label: m.kind === 'vnc' ? 'screen' : '' });
  }

  // The field: the models in use (model-roles.js) by where they answer, MCP servers by whose machine they are on.
  const byModel = new Map();
  for (const role of safe(() => require('../model-roles').roles()).filter(x => x.current && x.id !== 'new')) {
    const key = String(role.current).split(';')[0].trim().slice(0, 80);
    if (!byModel.has(key)) byModel.set(key, add({ id: `model:${byModel.size}`, col: COL.field, kind: 'model', label: key, detail: '' }));
    const n = nodes.find(x => x.id === byModel.get(key));
    n.detail = n.detail ? `${n.detail}, ${role.label.toLowerCase()}` : role.label;
  }
  for (const id of byModel.values()) links.push({ from: hub, to: id, label: 'uses' });
  for (const s of safe(() => require('../mcp/registry').list())) {
    const id = add({ id: `mcp:${s.id}`, col: COL.field, kind: 'mcp', label: s.label || s.id, detail: `MCP · ${s.state}${s.toolCount ? ` · ${s.toolCount} tools` : ''}`, up: s.state === 'running' });
    const host = s.origin?.kind === 'client' && nodes.some(n => n.id === `d:${s.origin.deviceId}`) ? `d:${s.origin.deviceId}` : hub;
    links.push({ from: host, to: id, label: host === hub ? '' : 'hosts' });
  }
  for (const [cid, rec] of Object.entries(safe(() => require('../connectors/vault').all(), {}))) {
    if (!rec?.accessToken) continue;
    links.push({ from: hub, to: add({ id: `c:${cid}`, col: COL.field, kind: 'connector', label: cid, detail: 'connected account', up: true }), label: '' });
  }
  for (const s of safe(() => require('../api-services/store').list())) links.push({ from: hub, to: add({ id: `api:${s.name || s.id}`, col: COL.field, kind: 'service', label: s.name || s.id, detail: 'API service' }), label: '' });

  // Around: the things saved in Nearby, by place, linked to whoever saw them last.
  for (const t of safe(() => require('../nearby/store').saved())) {
    const id = add({ id: `t:${t.id}`, col: COL.around, kind: t.kind || 'thing', label: t.name, detail: [t.place, t.room].filter(Boolean).join(' · '), up: !!t.lastSeen && Date.now() - Date.parse(t.lastSeen) < 864e5 });
    const by = (t.seenFrom || [])[0]?.by;
    links.push({ from: by && by !== 'hub' && nodes.some(n => n.id === `d:${by}`) ? `d:${by}` : hub, to: id, label: 'sees' });
  }

  return { at: new Date().toISOString(), nodes, links,
    columns: [['people', 'People'], ['devices', 'Devices'], ['hub', 'Hub'], ['machines', 'Machines'], ['field', 'Models and services'], ['around', 'Around']]
      .filter(([c]) => nodes.some(n => n.col === c)).map(([id, label]) => ({ id, label })) };
}

function mount(app) {
  app.get('/api/machines/map', async (_req, res) => { try { res.json(await map()); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { map, mount };

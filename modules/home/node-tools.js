'use strict';

/**
 * The agent using a home node's tools (`mcp__<node>__home_states|home_call|home_camera`, PROTOCOL §22.4): the node
 * lends them like any device's, and the hub answers them as the Home page would for the turn's person — the home
 * narrowed to the entities their level has (allot `home`), a call checked against the same list and refused when not
 * theirs, a script an admin's. Unlocking and disarming are a person's every time (harness/forced-asks.js). Returns
 * null for any other tool, which then goes to its server as before.
 */
const nodes = require('./nodes');

async function call(name, args, ctx = {}) {
  const m = /__home_(states|call|camera)$/.exec(name);
  if (!m || !/^mcp__/.test(name)) return null;
  const t = require('../mcp/tools').available().find(x => x.exposed === name);
  const node = t && nodes.list().find(n => n.serverId === t.server);
  if (!node) return null;
  const home = require('./index'), person = ctx.user;
  try {
    if (m[1] === 'states') {
      const v = await home.view(person, node.id);
      return JSON.stringify({ home: node.id, name: node.name, connected: v.connected, ...(v.offline ? { offline: true, seen: v.seen, note: v.error } : {}),
        place: v.place || null, areas: v.areas.map(a => ({ name: a.name, tiles: a.tiles.map(x => ({ id: x.id, name: x.name, state: x.state, attrs: x.attrs })) })) });
    }
    if (m[1] === 'call') return JSON.stringify(await require('./actions').call(person, { ...(args || {}), home: node.id }));
    const id = String(args?.entity_id || '');
    if (!home.allowed(person, id, node.id)) return `Error: ${id} is not allotted to ${person?.name || 'this person'} — an admin gives it in Settings → Users (the level's Home).`;
    if (!node.online) return `Error: the home node ${node.name} is away; its cameras come back with it.`;
    return null;   // allowed: the node's picture is kept as an attachment the usual way (mcp/content.js)
  } catch (e) { return `Error: ${e.message}`; }
}

module.exports = { call };

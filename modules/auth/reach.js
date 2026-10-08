'use strict';

/**
 * How far a person's agents reach (CONSTITUTION S2, 2026-10-07: "depending on the user's level … a logical reach,
 * from just creating safely with tools to doing anything"; TODO P1.9). A rung per level, applied on top of its tool
 * policy:
 *   none         no tools (a viewer)
 *   create       work that creates, safely: files, pages, the web, memory, recipes — and the agents' own computers,
 *                which are isolated; not the hub's command line, not any device, not an MCP server on the hub
 *   own-devices  create, plus the tools of the person's own devices (a phone, a desktop they paired)
 *   anything     everything the level's tool policy allows
 * A grant (`tool:<name>`) still reaches past a rung: that is how an admin or a team leader allots one device or
 * server to someone (S13). Another person's device can also be lent whole — `use:device:<id>` (allot.js) — and an
 * `own-devices` level then reaches it as one of the person's own; a `create` level still does not. A level says its rung as `reach`; one that does not is ruled by its tool policy alone, as
 * before (an admin's "Git only" level that allows shell:git keeps it) — the built-ins: viewer (its policy denies every
 * tool), member own-devices, admin and main admin anything.
 */
const RUNGS = ['none', 'create', 'own-devices', 'anything'];
// The hub machine's own command line and commands: an admin's (S2), whatever the tool policy says.
const HUB_MACHINE = new Set(['shell', 'shell_job', 'hub_command', 'mcp_connect']);

function rungOf(level) {
  return RUNGS.includes(level?.reach) ? level.reach : 'anything';   // a level that names no rung: its tool policy is the rule, as before
}

/** The MCP server behind an exposed tool name, with whose device it is on: { server, kind: computer|device|hub, ownerId }. */
function serverOf(name) {
  if (!String(name).startsWith('mcp__')) return null;
  let t = null;
  try { t = require('../mcp/tools').available().find(x => x.exposed === name); } catch { /* none running */ }
  const id = t?.server || String(name).split('__')[1];
  if (/^computer-/.test(id)) return { server: id, kind: 'computer' };
  let spec = null;
  try { spec = require('../mcp/registry').get(id); } catch { /* gone */ }
  if (spec?.origin?.kind === 'client') {
    let device = null;
    try { device = require('../api-v1/devices').get(spec.origin.deviceId); } catch { /* gone */ }
    return { server: id, kind: 'device', ownerId: device?.userId || null, deviceId: spec.origin.deviceId || null };
  }
  return { server: id, kind: 'hub' };
}

/** Why `name` is past this person's rung, or null when it is within it. */
function refuse(level, person, name) {
  const rung = rungOf(level);
  if (rung === 'anything') return null;
  if (rung === 'none') return `${level.name || 'this level'} reaches no tools`;
  if (HUB_MACHINE.has(name)) return `${name} is the hub machine's own command line, an admin's — beyond ${level.name || 'this level'}'s reach (${rung})`;
  const s = serverOf(name);
  if (!s || s.kind === 'computer') return null;
  if (s.kind === 'hub') return `${s.server} runs on the hub machine, an admin's — beyond ${level.name || 'this level'}'s reach (${rung}); an admin can allot it`;
  if (rung === 'create') return `${s.server} is a device — beyond ${level.name || 'this level'}'s reach (create); an admin can allot it`;
  if (s.ownerId && s.ownerId === person?.id) return null;
  if (s.deviceId && require('./allot').uses(person, 'device', s.deviceId)) return null;   // lent to them (use:device:<id>)
  return `${s.server} is on someone else's device — an admin can lend it (use:device:${s.deviceId || '<id>'} in Settings → Users)`;
}

module.exports = { RUNGS, HUB_MACHINE, rungOf, refuse, serverOf };

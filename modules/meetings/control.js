'use strict';

/**
 * Taking control of a shared screen — consent first, every time (asked 2026-10-09: "screen sharing, and even take
 * control, with the same permission type").
 *
 *   request   the viewer asks (optional: the sharer may offer unasked)
 *   offer     consent 1 — the sharer chooses "Let <name> control" and which of their own machines that screen is
 *   confirm   consent 2 — the sharer confirms, having been told in words what it means; only now does input flow
 *   input     the controller's pointer and keys, carried by the hub to that machine's own `input_*` tools (PROTOCOL
 *             §22.1) — a DOCA client on the sharer's machine (DocaDesk today; DocaMobile's input_tap) injects them;
 *             a plain browser share is pixels and can never be controlled
 *   end       the sharer's Stop, Esc three times on their meeting page, the controller letting go, the share stopping,
 *             either leaving, the meeting ending — whichever comes first
 *
 * Who may: access.controlRefusal (the controller's level reaches devices, one organisation), and the machine is the
 * sharer's own paired device lending `input` (granted on the device, not revoked here) whose server is running. Each
 * step is audited (audit.js); a key is never logged, typing only as a count. While control is active, `driving()` says
 * so, and the agent's own input on that machine waits (mcp/tools.js): a person's hand comes first.
 */
const crypto = require('crypto');

const grants = new Map();   // id → grant
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const rooms = () => require('./rooms');
const audit = () => require('./audit');
const tell = (roomId, what, extra) => require('../live').changed('meeting', roomId, what, extra);

const INPUT = { click: ['input_click', 'input_tap'], move: ['input_move'], type: ['input_type'], keys: ['input_keys', 'input_key'] };
const OFFER_TTL_MS = 2 * 60000;

/** The sharer's own machines that can take a controller's input now: [{id, name, tools}]. */
function machines(personId) {
  if (!personId) return [];
  const registry = require('../mcp/registry');
  return require('../api-v1/devices').list().filter(d => !d.revokedAt && d.userId === personId).map(d => {
    if (!require('../devices-control').state(d.id).usable.includes('input')) return null;
    const spec = registry.forDevice(d.id), client = spec && registry.client(spec.id);
    if (!client || client.state !== 'running') return null;
    const names = (client.tools || []).map(t => t.name);
    return names.some(n => INPUT.click.includes(n)) ? { id: d.id, name: d.name || d.id, tools: names } : null;
  }).filter(Boolean);
}

const view = g => ({ id: g.id, roomId: g.roomId, state: g.state, sharer: { peer: g.sharerPeer, id: g.sharerId, name: g.sharerName },
  controller: { peer: g.controllerPeer, id: g.controllerId, name: g.controllerName }, device: g.deviceId ? { id: g.deviceId, name: g.deviceName } : null,
  offeredAt: g.offeredAt, grantedAt: g.grantedAt || null });

function peerPerson(roomId, screen) {
  const p = rooms().peerOf(roomId, screen);
  return { peer: p, person: { id: p.personId, name: p.name, orgId: p.orgId, role: p.role } };
}

/** The viewer asks to control the screen `to` shares. */
function request(roomId, screen, to) {
  const { peer: c } = peerPerson(roomId, screen);
  const s = rooms().peerOf(roomId, String(to || ''));
  if (!s.sharing) throw bad(`${s.name} is not sharing a screen.`, 409);
  const g = { roomId, controllerId: c.personId, controllerName: c.name, sharerId: s.personId, sharerName: s.name, orgId: s.orgId };
  audit().control(g, 'requested');
  tell(roomId, 'control-request', { to: s.screen, from: screen, name: c.name, personId: c.personId });
  return { asked: s.name };
}

/** Consent 1: the sharer offers control of their screen, on one of their own machines, to one person in the room. */
function offer(roomId, screen, { to, device } = {}) {
  const { peer: s, person: sharer } = peerPerson(roomId, screen);
  if (!s.sharing) throw bad('Share your screen first: control is of a screen you share.', 409);
  const target = [...rooms().get(roomId).peers.values()].find(p => p.screen === to || p.personId === to);
  if (!target) throw bad('That person is not in the meeting.', 404);
  const why = require('./access').controlRefusal({ id: target.personId, name: target.name, orgId: target.orgId, role: target.role }, sharer);
  const fail = msg => { audit().control({ roomId, sharerId: s.personId, sharerName: s.name, controllerId: target.personId, controllerName: target.name, orgId: s.orgId }, 'refused', msg); return bad(msg, 403); };
  if (why) throw fail(why);
  const mine = machines(s.personId);
  const m = mine.find(x => x.id === device) || (!device && mine.length === 1 ? mine[0] : null);
  if (!m) throw fail(mine.length ? 'Choose which of your machines this screen is.'
    : `None of your machines can take someone else's pointer now: control needs ${require('../branding').name('product')}'s app on the shared machine (the desktop app, or the phone app) lending its input, and connected. A screen shared from a plain browser can be seen, not controlled.`);
  for (const g of grants.values()) if (g.roomId === roomId && g.sharerPeer === screen && g.state !== 'ended') end(g, 'a new offer replaced it');
  const g = { id: `ctl_${crypto.randomBytes(6).toString('hex')}`, roomId, state: 'offered', sharerPeer: screen, sharerId: s.personId, sharerName: s.name,
    controllerPeer: target.screen, controllerId: target.personId, controllerName: target.name, deviceId: m.id, deviceName: m.name, tools: m.tools,
    orgId: s.orgId, offeredAt: new Date().toISOString(), typed: 0, queue: Promise.resolve(), lastMove: 0 };
  grants.set(g.id, g);
  audit().control(g, 'offered');
  return { grant: view(g), confirm: `${target.name} will move the pointer and type on ${m.name} until you stop it — Stop, or Esc three times on this page. Every move shows with their name.` };
}

/** Consent 2: the sharer confirms. Only now can the controller's input reach the machine. */
function confirm(roomId, screen, id) {
  const g = grants.get(String(id || ''));
  if (!g || g.roomId !== roomId || g.sharerPeer !== screen) throw bad('No such offer from this page.', 404);
  if (g.state !== 'offered') throw bad(`This offer is ${g.state}.`, 409);
  if (Date.now() - Date.parse(g.offeredAt) > OFFER_TTL_MS) { end(g, 'the offer was not confirmed in time'); throw bad('The offer expired: offer again.', 410); }
  g.state = 'active'; g.grantedAt = new Date().toISOString();
  audit().control(g, 'granted');
  tell(roomId, 'control', { grant: view(g) });
  return { grant: view(g) };
}

/** The controller's input: pointer position as a fraction of the shared picture, scaled to the machine's pixels. */
function input(roomId, screen, id, ev = {}) {
  const g = grants.get(String(id || ''));
  if (!g || g.roomId !== roomId || g.controllerPeer !== screen || g.state !== 'active') throw bad('You do not have control of this screen.', 403);
  const s = rooms().get(roomId)?.peers.get(g.sharerPeer);
  if (!s?.sharing) { end(g, 'the share stopped'); throw bad('The share stopped.', 410); }
  const kind = String(ev.kind || '');
  if (!INPUT[kind]) throw bad('kind is click, move, type or keys.');
  const tool = INPUT[kind].find(n => g.tools.includes(n));
  if (!tool) throw bad(`${g.deviceName} does not take ${kind} input.`, 501);
  const frac = v => Math.min(1, Math.max(0, Number(v)));
  const at = (ev.fx !== undefined && s.sharing.width && s.sharing.height)
    ? { x: Math.round(frac(ev.fx) * (s.sharing.width - 1)), y: Math.round(frac(ev.fy) * (s.sharing.height - 1)) } : {};
  let args;
  if (kind === 'move') {
    if (Date.now() - g.lastMove < 60) return { ok: true, skipped: true };   // ~16 moves a second is what a pointer needs
    g.lastMove = Date.now(); args = at;
  } else if (kind === 'click') args = { ...at, ...(['right', 'middle'].includes(ev.button) ? { button: ev.button } : {}), ...(ev.double ? { double: true } : {}) };
  else if (kind === 'type') { args = { text: String(ev.text || '').slice(0, 2000) }; g.typed += args.text.length; }
  else args = { keys: String(ev.keys || '').slice(0, 100) };
  // The label everyone sees: who moved, and where — never what was typed.
  if (at.x !== undefined) tell(roomId, 'pointer', { by: g.controllerName, peer: g.sharerPeer, fx: frac(ev.fx), fy: frac(ev.fy), click: kind === 'click' });
  g.queue = g.queue.then(() => callTool(g, tool, args)).catch(() => {});
  return { ok: true, queued: tool };
}

async function callTool(g, tool, args) {
  if (g.state !== 'active') return;
  const registry = require('../mcp/registry');
  const spec = registry.forDevice(g.deviceId), client = spec && registry.client(spec.id);
  if (!client || client.state !== 'running') return end(g, `${g.deviceName} disconnected`);
  const text = await client.callTool(tool, args).catch(e => `Error: ${e.message}`);
  if (/^Error:/.test(String(text))) tell(g.roomId, 'control-error', { to: g.controllerPeer, error: String(text).replace(/^Error:\s*/, '').slice(0, 300) });
}

function end(g, why) {
  if (g.state === 'ended') return;
  const was = g.state;
  g.state = 'ended'; g.endedAt = new Date().toISOString(); g.why = why;
  if (was === 'active') audit().control(g, 'ended', `${why}${g.typed ? `; ${g.typed} characters typed` : ''}`);
  tell(g.roomId, 'control', { grant: view(g), why });
  setTimeout(() => grants.delete(g.id), 60000).unref?.();
}

/** Revoke: the sharer (Stop, Esc ×3) ends any control of their screen; the controller lets go of theirs. */
function revoke(roomId, screen, id = null) {
  let n = 0;
  for (const g of grants.values()) {
    if (g.roomId !== roomId || g.state === 'ended' || (id && g.id !== id)) continue;
    if (g.sharerPeer === screen) { end(g, `${g.sharerName} stopped it`); n++; } else if (g.controllerPeer === screen) { end(g, `${g.controllerName} let go`); n++; }
  }
  return { ended: n };
}

/** Everything a page, a share or a room ending takes with it. */
function endFor({ roomId = null, screen = null, sharer = null }, why) {
  for (const g of grants.values()) {
    if (g.state === 'ended' || (roomId && g.roomId !== roomId)) continue;
    if (sharer && g.sharerPeer !== sharer) continue;
    if (screen && g.sharerPeer !== screen && g.controllerPeer !== screen) continue;
    end(g, why);
  }
}

/** Whether a person is controlling this device now (the agent's own input on it waits). */
const driving = deviceId => [...grants.values()].some(g => g.state === 'active' && g.deviceId === deviceId);
const list = roomId => [...grants.values()].filter(g => g.roomId === roomId && g.state !== 'ended').map(view);

module.exports = { machines, request, offer, confirm, input, revoke, endFor, driving, list, INPUT };

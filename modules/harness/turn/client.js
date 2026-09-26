'use strict';

/**
 * Where the turn came from: the device's shape, what it can show and take, and
 * the tools it hosts itself — the part of the prompt that changes per client.
 */

/**
 * How much answer the thing in front of the user can actually hold.
 *
 * The rule lives here, not in the callers, so a watch gets the same treatment
 * whether it asked through `/api/v1` or through anything added later. It is
 * derived from what the device declared — form factor first, screen width when
 * the form factor is one we do not know — because a client that lies about its
 * screen is only lying to itself.
 */
const SHAPE = {
  watch:   'One or two short sentences. No tables, no code blocks, no lists longer than three items. Lead with the number or the verdict; offer to send the detail to a bigger screen.',
  glasses: 'One short sentence, spoken aloud rather than read. No formatting at all.',
  phone:   'A few short paragraphs. A small table is fine, a wide one is not; keep code snippets under ten lines.',
  tablet:  'Normal prose with tables and short code blocks.',
  desktop: 'Full detail is welcome: tables, long code, complete output.',
  tv:      'Very few words in large blocks. No tables, no code.',
  headless:'Complete and machine-readable. Do not shorten for a human, and do not decorate.',
};

function shapeFor(client) {
  if (client.kind === 'agent' || client.formFactor === 'headless') return SHAPE.headless;
  const named = SHAPE[client.formFactor];
  if (named) return named;
  const w = Number(client.screen?.w) || 0;
  if (!w) return SHAPE.phone;                 // unknown and undeclared: the middle is the safe guess
  if (w < 400)  return SHAPE.watch;
  if (w < 900)  return SHAPE.phone;
  return SHAPE.desktop;
}

/**
 * Who this turn came from. The agent is one mind with many windows, and the
 * windows are not interchangeable: the same answer that is right on a desktop is
 * unreadable on a watch. Every entry point names its client, so this block is
 * present on every turn rather than only on the ones somebody remembered.
 */
function clientBlock(client) {
  if (!client) return '';
  const screen = client.screen?.w && client.screen?.h
    ? `${client.screen.w}×${client.screen.h}${client.screen.shape === 'round' ? ' round' : ''}`
    : 'screen not declared';
  const can = [
    client.input?.voice && 'voice',
    client.input?.text && 'keyboard',
    client.input?.touch && 'touch',
    client.input?.camera && 'camera',
  ].filter(Boolean).join(', ');
  return [
    '# Who is asking',
    `This turn came from "${client.name}"${client.id ? ` (${client.id})` : ''} — ${client.label || client.formFactor || 'an unknown client'}, ${screen}${can ? `, input: ${can}` : ''}.`,
    ...(client.user ? [`Signed in as ${client.user.name || client.user.email}${client.user.name && client.user.email ? ` <${client.user.email}>` : ''}`
      + `${client.user.role ? `, ${client.user.role} of this panel` : ''}. What changes on this machine in this turn is logged as theirs.`] : []),
    `Shape the answer for it: ${shapeFor(client)}`,
    'Other devices of the same user may be reading this conversation too, so do not describe this one as if it were the only one.',
  ].join('\n');
}

/**
 * Which machine's tools to reach for, given who asked.
 *
 * Both halves of this were already in the prompt and nothing joined them: the
 * agent is told which client this turn came from (`clientBlock`) and it is told,
 * per tool, which machine that tool acts on (`mcp/tools.js::machineNote`). What
 * it was never told is that those two facts are related. So with a Blender on
 * the phone's machine and a Blender on the host, "look at my Blender scene" had
 * no rule behind it and the answer came down to whether the user happened to
 * name a machine.
 *
 * The rule is: whoever asked is probably talking about their own machine. It is
 * a default, not a constraint — the agent may reach anywhere it has tools for,
 * and the one thing it must not do is reach somewhere else silently.
 *
 * Rendered only when a client-hosted server exists, because with everything on
 * one host there is nothing to choose between and this is prompt the user pays
 * for on every step.
 */
function placeBlock(client) {
  let servers = [];
  try { servers = require('../../mcp/registry').list(); } catch { return ''; }

  const running = servers.filter(s => s.state === 'running');
  const hosted  = running.filter(s => s.origin?.kind === 'client');
  if (!hosted.length) return '';

  const mine = client?.id ? hosted.filter(s => s.origin.deviceId === client.id) : [];
  const out  = ['# Whose machine to work on'];

  if (mine.length) {
    out.push(`This turn came from a device that hosts its own tools: `
      + `${mine.map(s => `mcp__${s.id}__* (${s.toolCount} tools, on ${s.originLabel})`).join(', ')}.`);
    out.push('When the request does not name a machine, that is the one it almost certainly means — '
      + 'somebody asking from their laptop about "my files" or "my Blender" means the laptop in front of them.');
  } else {
    out.push('This turn came from a device that hosts no tools of its own, so anything you do lands on '
      + 'another machine. Say which one, in the answer, whenever that could surprise them.');
  }

  const elsewhere = hosted.filter(s => !mine.includes(s));
  if (elsewhere.length)
    out.push(`Also reachable, on other machines: `
      + `${elsewhere.map(s => `mcp__${s.id}__* (${s.originLabel})`).join(', ')}.`);
  if (running.some(s => s.origin?.kind !== 'client'))
    out.push('The DOCA host\'s own servers, and your shell, act here — on the machine this panel runs on, '
      + 'which is usually not the machine that asked.');

  out.push('Two rules, and the second matters more: prefer the asking device when nothing says otherwise, '
    + 'and **name the machine you used** whenever it is not theirs. A tool that failed on one machine may '
    + 'succeed on another — offer that, do not silently substitute it.');

  return out.join('\n');
}

/**
 * The person behind a turn (docs/design/auth.md §6): from a signed-in browser
 * (`req.auth`, set by auth/gate.js) or from the account a device is paired to.
 * Rides on the client, so every entry point that names its client names them.
 */
function personOf(auth) {
  if (!auth?.user) return null;
  return { id: auth.user.id, name: auth.user.name || '', email: auth.user.email || '', role: auth.role || null, orgId: auth.orgId || null };
}

function deviceOwner(device) {
  if (!device?.userId) return null;
  const authStore = require('../../auth/store');
  const u = authStore.userById(device.userId);
  if (!u) return null;
  const orgId = device.orgId || authStore.defaultOrg()?.id || null;
  return personOf({ user: u, orgId, role: orgId ? authStore.membership(orgId, u.id)?.role : null });
}

/** The dashboard in a browser, as a client — with whoever is signed in to it. */
function dashboardClient(req) {
  return { name: 'Dashboard console', kind: 'dashboard', formFactor: 'desktop',
    label: 'the dashboard in a desktop browser, next to every panel you can read',
    input: { text: true, touch: false }, user: personOf(req?.auth) };
}

module.exports = { shapeFor, clientBlock, placeBlock, personOf, deviceOwner, dashboardClient };

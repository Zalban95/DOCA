'use strict';

/**
 * A watch's console into a page, for the agent (device-console.js, console-pages.js; asked 2026-10-14: "link the
 * watch's commands to Benchie … play the game on the TV — all the tools to do it quickly, without workarounds").
 * `link` makes a person's own watch (or phone) play into a preview — the project page the canvas tool serves, in the
 * panel's window or on a TV (cast show {preview}) — whose code reads it with /__doca/console.js; `unlink` takes it
 * off; `status` says what each console of theirs plays into and what a page hears. It changes where a person's own
 * device input goes, so only when they asked (asked: true on their own turn), never from a mission (registry.NEVER),
 * and never the buttons' commands on the host, which stay the panel's under `host`.
 */
const bad = m => `Error: ${m}`;

const HOW = 'In the page: <script src="/__doca/console.js"></script>, then docaConsole.addEventListener(\'frame\' → {t, accel:[x,y,z] m/s², '
  + 'gyro:[x,y,z] rad/s, heading, crown}, \'button\' → {id: A–E, down, behaviour}, \'state\' → {enabled, mode, toggles, joystick}). '
  + 'A, B, C are held buttons (down true, then false on release), D, E toggles; frames flow while the person has STREAM on, on the watch\'s Controls page.';

module.exports = [{
  name: 'device_console',
  description: 'Link a person\'s own watch (or phone) console — its buttons, toggles and motion — to a project page the canvas tool previews, so the page (a game, a demo) is played with it, in the panel or on a TV — use it when the person asks to control a page with their watch. '
    + 'link: device + preview (prv_…); unlink; status. The page reads it with /__doca/console.js (status says how). Only when the person asked: asked true.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'link', 'unlink'] },
      device: { type: 'string', description: 'link, unlink: the device\'s name or id (doca_clients lists them); status: optional.' },
      preview: { type: 'string', description: 'link, unlink: the preview\'s id (prv_…) from the canvas tool.' },
      asked: { type: 'boolean', description: 'true only when the person asked for exactly this on this turn.' },
    },
    required: ['action'],
  },
  run: async ({ action, device, preview, asked }, ctx = {}) => {
    const person = ctx.user;
    if (!person?.id) return bad('no person on this turn — a console is a person\'s own device.');
    const devices = require('../../api-v1/devices'), con = require('../../device-console'), pv = require('../../canvas/previews');
    const host = require('../../auth/rights').can(person.role, 'host');
    const mine = devices.list().filter(d => !d.revokedAt && d.kind !== 'browser' && d.kind !== 'channel' && (d.userId === person.id || (host && !d.userId)));
    if (action === 'status') {
      const rows = mine.map(d => ({ d, c: con.configOf(d.id) })).filter(({ d }) => !device || d.id === device || d.name.toLowerCase() === String(device).toLowerCase());
      if (!rows.length) return 'No device of this person\'s has a console (a watch with DocaWear\'s Controls page, or a phone).';
      return [...rows.map(({ d, c }) => `- ${d.name} (${d.id}): plays into ${c.pages.length ? c.pages.map(id => `${pv.get(id)?.title || id} (${id}, ${require('../../console-pages').listeners(id)} page(s) listening now)`).join(', ') : 'no page'}; mode ${c.mode}`), HOW].join('\n');
    }
    if (!(asked === true && ctx.byPerson)) return bad('link a console only when the person asked for it on their own turn (asked: true): it is their own device\'s input.');
    const want = String(device || '').trim().toLowerCase();
    const d = mine.find(x => x.id === device || x.name.toLowerCase() === want) || (mine.filter(x => x.name.toLowerCase().includes(want)).length === 1 ? mine.find(x => x.name.toLowerCase().includes(want)) : null);
    if (!d) return bad(`no device of this person's called "${device}": ${mine.map(x => x.name).join(', ') || 'none paired'}.`);
    const p = pv.get(String(preview || '')) || pv.byToken(String(preview || ''));
    if (!p) return bad('no preview by that id — the canvas tool\'s preview makes one (prv_…), for 12 hours.');
    if (!host && p.sessionId && !require('../session-access').mayUse(person, p.sessionId)) return bad('that preview was made in someone else\'s conversation.');
    const pages = con.configOf(d.id).pages;
    const next = action === 'link' ? [...new Set([...pages, p.id])] : pages.filter(x => x !== p.id);
    if (action !== 'link' && action !== 'unlink') return bad('action is status, link or unlink.');
    const store = require('../../store'), doc = store.readJson(con.DOC, {});
    doc[d.id] = { ...con.configOf(d.id), pages: next };
    store.writeJson(con.DOC, doc);
    require('../../activity').note({ from: 'console', what: `${action === 'link' ? 'linked' : 'unlinked'} ${d.name}'s console ${action === 'link' ? 'to' : 'from'} the page "${p.title}"`, why: 'the person asked', person: { id: person.id, name: person.name || person.email || null } });
    return action === 'link'
      ? `${d.name}'s console now plays into "${p.title}" (${p.id}). ${HOW} Cast it to a TV with cast show {preview: "${p.id}"}.`
      : `${d.name}'s console no longer plays into "${p.title}".`;
  },
}];

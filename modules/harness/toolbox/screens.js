'use strict';

/**
 * The screens, for the agent (TODO B6b; audit 2026-10-06 aw 8): every signed-in browser is a device of kind `browser`
 * (modules/screens), and its presence heartbeat says which page it shows (screens/showing.js). Before this the agent
 * could not answer "what is on the kitchen tablet" nor put the Workstream on the wall screen when asked.
 *
 * One way per job: how a screen looks and is laid out is panel_layout's; a screen's own settings (call, voice, ambient,
 * face) are proposed with settings_propose {screen} — `propose` here reads that screen's proposable settings and says
 * so, it never writes. Showing a page goes through the approval gate like any call that does something (it is not in
 * approval.FREE); a host's turn may show on any screen, anyone else's only on their own; a mission never holds it
 * (registry.NEVER), since a page appearing on a person's screen from work nobody watches is not theirs to have asked for.
 */
const bad = m => `Error: ${m}`;

const isHost = person => require('../session-access').isHost(person);
const pages = () => require('../../features/pages');

/** The screens this person may see: a host every one, anyone else their own. */
function visible(person) {
  return require('../../api-v1/devices').list()
    .filter(d => d.kind === 'browser' && !d.revokedAt && !d.archivedAt && (isHost(person) || d.userId === person.id));
}

/** A screen named by the agent: "this", an id, or a name a person would say ("Chrome on Android"). */
function pick(person, name, ctx) {
  const mine = visible(person);
  if (!name || name === 'this') {
    if (!ctx.screen) return { error: 'this turn did not come from a screen; name one (action list shows them).' };
    name = ctx.screen;
  }
  const want = String(name).toLowerCase();
  const hits = mine.filter(d => d.id === name || String(d.name || '').toLowerCase() === want);
  if (hits.length === 1) return { screen: hits[0] };
  if (hits.length > 1) return { error: `more than one screen is called "${name}": name it by id (${hits.map(d => d.id).join(', ')}).` };
  return { error: `no screen "${name}" of ${isHost(person) ? 'this hive' : 'theirs'} — action list shows them.` };
}

function line(d, shown, ctx, person) {
  const s = shown[d.id];
  const what = s?.page ? `shows ${pages().label(s.page)} (${s.page})${s.solo ? ' alone' : ''}${s.visible ? '' : ', in the background'}` : 'not heard from lately';
  let owner = '';
  if (isHost(person) && d.userId && d.userId !== person.id) {
    try { const u = require('../../auth/store').userById(d.userId); owner = ` — ${u?.name || u?.email || d.userId}'s`; } catch { /* gone */ }
  }
  return `- ${d.name || d.id} (${d.id})${d.id === ctx.screen ? ' — the screen this turn came from' : ''}${owner}: ${what}`;
}

module.exports = [
  {
    name: 'screen',
    description: 'See the screens (signed-in browsers) and what page each shows, or put a page on one — use it when the person asks what is on a '
      + 'screen or to show a page there ("put the Workstream on the wall screen"). list: the screens with their page; show: open a page on one '
      + '(alone, full window, with solo); propose: that screen\'s own settings, to suggest a change with settings_propose and its screen id. '
      + 'The panel\'s look and layout is panel_layout\'s.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'show', 'propose'] },
        screen: { type: 'string', description: 'show and propose: "this" (the screen the person asked from, the default), a screen id, or its name from list.' },
        page: { type: 'string', description: 'show: the page id, e.g. harness, workstream, ambient, live, projects, chronicle.' },
        solo: { type: 'boolean', description: 'show: the page by itself, no header or sidebar (a wall screen); false keeps the whole panel.' },
      },
      required: ['action'],
    },
    run: ({ action, screen, page, solo }, ctx = {}) => {
      const person = ctx.user;
      if (!person?.id) return bad('no person on this turn — a screen is a person\'s.');
      if (action === 'list') {
        const shown = require('../../screens/showing').all(), list = visible(person);
        if (!list.length) return 'No screens yet: a browser becomes one when a person signs in on it.';
        return [`Screens${isHost(person) ? '' : ' of theirs'} (what each showed in its last minute):`, ...list.map(d => line(d, shown, ctx, person))].join('\n');
      }
      const { screen: d, error } = pick(person, screen, ctx);
      if (error) return bad(error);
      if (action === 'propose') {
        const lines = require('../screen-proposals').readable(d.id, person);
        return lines.length ? `${d.name || d.id}'s own settings, as they are now:\n${lines.join('\n')}\n`
          + `To suggest a change: settings_propose with screen "${d.id === ctx.screen ? 'this' : d.id}" (the person accepts it). Its look and layout: panel_layout.`
          : bad('that screen has no settings of its own to propose.');
      }
      if (action !== 'show') return bad('action is list, show or propose.');
      const { NAV_TABS, HOST_TABS = [] } = pages().lists();
      if (!NAV_TABS.includes(String(page))) return bad(`which page? One of: ${NAV_TABS.join(', ')}.`);
      // A page that is the machine itself is left out of a screen whose person does not hold host (nav.js HOST_TABS).
      if (HOST_TABS.includes(page) && d.userId && d.userId !== person.id) {
        const u = require('../turn/client').personById({ id: d.userId, orgId: d.orgId || require('../../auth/store').defaultOrg()?.id || null });
        if (!u || !isHost(u)) return bad(`${pages().label(page)} is an admin's page, and that screen's person is not one.`);
      }
      try {
        const r = require('../../screens/showing').show(d.id, { page, solo: solo === true });
        return `Sent ${pages().label(page)}${r.solo ? ' (alone)' : ''} to ${d.name || d.id}: it ${r.showing === 'heard from lately' ? 'opens it now' : r.showing.replace(/^not heard from lately: it/, 'was not heard from lately, so it')}. Say so in one line.`;
      } catch (e) { return bad(e.message); }
    },
  },
];

'use strict';

/**
 * Nearby, for the agent (modules/nearby): the things around this hub — speakers, TVs, printers, lights, computers, phones
 * — that the sources a person switched on have seen, and the ones they saved with a place and a room. Read-only by
 * shape: `list` and `find` read, `scan` looks again with the sources already on (the person's switch is the consent);
 * it never switches a source on, saves, forgets or pairs — those are the person's, in Machines → Nearby. A host's turn
 * only: it is the machine's network and radio. Each thing comes with how to use what it can do, so "play this on the
 * kitchen speaker" needs no rediscovery.
 */
const bad = m => `Error: ${m}`;

const { line, ago } = require('../../nearby/describe');

const isHost = person => !person?.id || require('../session-access').isHost(person);

module.exports = [{
  name: 'nearby',
  description: 'See the things around this hub — speakers, TVs, printers, lights, computers, phones, Bluetooth devices — that Machines → Nearby has '
    + 'seen or the person saved with a place and a room, and how to use each (cast, DLNA, AirPlay, print, its page, ssh, Home Assistant) — use it '
    + 'before playing, casting or printing to something in the room. list: saved, then the rest seen; find: by name, kind, place or ability; '
    + 'scan: look again with the sources the person switched on, from the hub or from one of the person\'s devices (from). It never saves, forgets or pairs: those are the person\'s, in Machines → Nearby.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'find', 'scan'] },
      query: { type: 'string', description: 'find: words to match — a name ("kitchen"), a kind (speaker, tv, printer), a place or room, or an ability (cast, print).' },
      from: { type: 'string', description: 'scan: where to look from — "hub" (default), or one of the person\'s own devices that lends Nearby, by its name or id (a desk at home while the hub is elsewhere).' },
    },
    required: ['action'],
  },
  run: async ({ action, query, from }, ctx = {}) => {
    if (!isHost(ctx.user)) return bad('what is around the hub is an admin\'s to see — this turn\'s person does not hold host.');
    const store = require('../../nearby/store'), scan = require('../../nearby/scan');
    const on = scan.sources().filter(s => s.on && s.works).map(s => s.id);
    if (action === 'scan' && from && !/^(hub|this hub)$/i.test(from)) {
      const person = ctx.user?.id ? { id: ctx.user.id, name: ctx.user.name } : null;
      const lookers = require('../../nearby/lookers').clients(person);
      const f = String(from).toLowerCase();
      const c = lookers.find(x => x.id === from || x.deviceId === from || x.label.toLowerCase() === f) || lookers.find(x => x.label.toLowerCase().includes(f));
      if (!c) return bad(`no device of the person's called "${from}" lends Nearby now. ${lookers.length ? `Ones that do: ${lookers.map(x => x.label).join(', ')}.` : 'None does: a client lends it once its person says yes to the nearby family and it is connected.'}`);
      const r = await scan.scan({ from: c.id, why: 'the agent asked', person });
      const misses = Object.entries(r.why || {}).map(([s, w]) => `${s}: ${String(w).replace(/\.$/, '')}`);
      return `Scanned from ${c.label}${r.sameNetwork === false ? ' (on another network than the hub\'s)' : ''}: ${r.found} found (${Object.entries(r.bySource).map(([s, n]) => `${s} ${n}`).join(', ') || 'nothing'}).${misses.length ? ` Not seen: ${misses.join('; ')}.` : ''} \`nearby\` list shows them.`;
    }
    if (action === 'scan') {
      if (!on.length) return bad('no source is switched on: the person switches them on in Machines → Nearby (say so in one line, with the link #nearby).');
      const r = await scan.scan({ why: 'the agent asked', person: ctx.user?.id ? { id: ctx.user.id, name: ctx.user.name } : null });
      const misses = Object.entries(r.why || {}).map(([s, w]) => `${s}: ${String(w).replace(/\.$/, '')}`);
      return `Scanned with ${on.join(', ')}: ${r.found} found (${Object.entries(r.bySource).map(([s, n]) => `${s} ${n}`).join(', ')}).${misses.length ? ` Not seen: ${misses.join('; ')}.` : ''} \`nearby\` list shows them.`;
    }
    const saved = store.saved();
    const savedSeen = new Set(saved.map(t => t.seenId).filter(Boolean));
    const rest = store.seen().filter(t => !savedSeen.has(t.id));
    if (action === 'list') {
      if (!saved.length && !rest.length) return on.length ? 'Nothing seen yet: `nearby` scan looks now.' : 'Nothing seen yet, and no source is on: the person switches them on in Machines → Nearby.';
      const out = [];
      if (saved.length) out.push('Saved by the person:', ...saved.map(line));
      if (rest.length) out.push(`${saved.length ? 'Also seen, not saved' : 'Seen, not saved'} (newest first${rest.length > 30 ? ', first 30' : ''}):`, ...rest.slice(0, 30).map(line));
      out.push(`Last scan: ${ago(store.lastScan()?.at)}; sources on: ${on.join(', ') || 'none'}.`);
      return out.join('\n');
    }
    if (action === 'find') {
      const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return bad('find needs a query: a name, a kind, a place or an ability.');
      const text = t => [t.name, t.kind, t.place, t.room, t.model, t.maker, ...(t.can || []), ...(t.addresses || [])].join(' ').toLowerCase();
      const hits = [...saved, ...rest].filter(t => words.every(w => text(t).includes(w)));
      return hits.length ? hits.slice(0, 20).map(line).join('\n') : `Nothing nearby matches "${query}". ${on.length ? '`nearby` scan looks again.' : 'No source is on (Machines → Nearby).'}`;
    }
    return bad('action is list, find or scan.');
  },
}];

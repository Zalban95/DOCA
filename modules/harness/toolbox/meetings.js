'use strict';

/**
 * Meetings, for the agent (meetings/): it lists the person's meetings and proposes one — "set up a call with Anna on
 * Thursday at three" — which waits for the person's Confirm in Meetings before anyone is invited (the agent proposes,
 * a person decides). It never invites, cancels, joins, shares a screen or takes control: those are the person's own
 * clicks in the room. Not in approval.FREE; in registry.NEVER (a mission does not book its person's time).
 */
const bad = m => `Error: ${m}`;

/** People named by the agent: an id, a name a person would say, or a mail address. */
function resolve(person, names) {
  const dir = require('../../meetings/access').directory(person.orgId);
  const people = [], emails = [], unknown = [];
  for (const n of [].concat(names || [])) {
    const s = String(n || '').trim();
    if (!s) continue;
    if (s.includes('@')) { emails.push(s); continue; }
    const low = s.toLowerCase();
    const hits = dir.filter(p => p.id === s || p.name.toLowerCase() === low || p.name.toLowerCase().split(/\s+/)[0] === low);
    if (hits.length === 1) people.push(hits[0].id); else unknown.push(hits.length ? `${s} (more than one: ${hits.map(h => h.name).join(', ')})` : s);
  }
  return { people, emails, unknown, dir };
}

function line(m, tz) {
  const when = m.startsAt ? require('../../timezones').human(new Date(m.startsAt), tz) : 'now';
  return `- ${m.title} — ${when}, ${m.state}${m.room?.peers?.length ? `, ${m.room.peers.length} in the room` : ''} (id ${m.id}, ${m.link})`;
}

module.exports = [
  {
    name: 'meeting',
    description: 'See the person\'s meetings, or propose one with people of the hive (or mail addresses) — use it when they ask to set up a call or '
      + 'a meeting. list: their meetings; propose: a meeting waiting for their Confirm in Meetings, after which each person is invited in their own '
      + 'calendar (Google, Microsoft, or an iCalendar invite) with its link. Times are on the person\'s clock unless an offset is given.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'propose'] },
        title: { type: 'string', description: 'propose: what the meeting is about, a few words.' },
        start: { type: 'string', description: 'propose: when, e.g. 2026-10-12T15:00 (the person\'s clock) or with an offset. Left out: a call now.' },
        minutes: { type: 'integer', description: 'propose: how long (default 30).' },
        people: { type: 'array', items: { type: 'string' }, description: 'propose: who — names of people in the hive, or mail addresses.' },
        note: { type: 'string', description: 'propose: an agenda or a line for the invitation.' },
      },
      required: ['action'],
    },
    run: async ({ action, title, start, minutes, people, note }, ctx = {}) => {
      const person = ctx.user;
      if (!person?.id) return bad('no person on this turn — a meeting is a person\'s.');
      if (!require('../../license').featureOn('meetings')) return bad('meetings are not part of this hive\'s licence.');
      const tz = require('../../timezones').of(person.id) || require('../../timezones').hostZone();
      if (action === 'list') {
        const list = await require('../../meetings/store').forPerson(person.id, { since: new Date(Date.now() - 86400000).toISOString(), limit: 20 });
        if (!list.length) return 'No meetings in the last day or ahead.';
        const views = await Promise.all(list.map(m => require('../../meetings').view(m, person)));
        return ['Their meetings (newest first):', ...views.map(m => line(m, tz))].join('\n');
      }
      if (action !== 'propose') return bad('action is list or propose.');
      const who = resolve(person, people);
      if (who.unknown.length) return bad(`not found in this hive: ${who.unknown.join('; ')}. People here: ${who.dir.map(p => p.name).join(', ') || 'none'}; or give a mail address.`);
      if (!who.people.length && !who.emails.length) return bad('name at least one person to meet.');
      try {
        const out = await require('../../meetings').create(person, { title, start, minutes, people: who.people, emails: who.emails, note, proposed: true,
          base: ctx.base || null });
        const m = out.meeting;
        try { require('../../notices').post({ personId: person.id, title: `Proposed: ${m.title}`, text: 'Confirm it in Meetings to invite everyone.', from: 'meetings' }); } catch { /* the answer says it */ }
        return `Proposed "${m.title}" — ${m.startsAt ? require('../../timezones').human(new Date(m.startsAt), tz) : 'now'} with ${m.people.filter(p => p.role !== 'organizer').map(p => p.name).join(', ')}. `
          + `It waits for their Confirm in Meetings (id ${m.id}); then each person is invited in their own calendar. Nobody has been invited yet.`;
      } catch (e) { return bad(e.message); }
    },
  },
];

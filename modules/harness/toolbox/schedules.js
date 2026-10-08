'use strict';

/**
 * The `schedule` tool (modules/schedules; TODO H7.1): propose a recurring turn or recipe. It starts `proposed`
 * and runs only once the person switches it on in the panel — a schedule makes you act unasked, again and
 * again, and that is theirs to decide. You may list, pause and delete; never switch one on.
 */
module.exports = [
  {
    name: 'schedule',
    description: 'Schedules: propose that a message is sent to a conversation, or a recipe run, on a timetable — every N minutes or a '
      + 'cron expression ("0 9 * * 1-5" is 09:00 on weekdays, on the person\'s clock when their screen has said its zone, else the hub\'s). It runs as the person you are working for, with '
      + 'their level and approvals, and only after they switch it on in the panel (Harness → Schedules). list shows them; '
      + 'pause and delete act at once.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'propose', 'pause', 'delete'] },
        id: { type: 'string', description: 'pause / delete: the schedule.' },
        title: { type: 'string', description: 'propose: a short name.' },
        message: { type: 'string', description: 'propose a turn: what is sent each time, written as the instruction it is.' },
        recipe: { type: 'string', description: 'propose a recipe run instead: its id; values in values.' },
        values: { type: 'object' },
        every: { type: 'number', description: 'propose: minutes between runs (at least 1)…' },
        cron: { type: 'string', description: '…or a five-field cron expression.' },
        here: { type: 'boolean', description: 'propose a turn: send it into this conversation rather than one of its own.' },
      },
      required: ['action'],
    },
    run: async (a, ctx = {}) => {
      const s = require('../../schedules');
      const person = ctx.user || null;
      const zones = require('../../timezones'), tz = zones.of(person?.id) || zones.hostZone();
      const line = x => `- ${x.id} [${x.state}] ${x.title} — ${x.whenText}${x.nextAt && x.state === 'on' ? `, next ${zones.iso(new Date(x.nextAt), tz)}` : ''}${x.last ? `; last: ${x.last.ok ? 'ok' : 'failed'} ${x.last.summary.slice(0, 80)}` : ''}`;
      if (a.action === 'list') { const l = s.listFor(person); return l.length ? l.map(line).join('\n') : 'No schedules.'; }
      if (a.action === 'propose') {
        const x = s.create({ title: a.title, kind: a.recipe ? 'recipe' : 'turn', message: a.message, recipe: a.recipe, values: a.values,
          every: a.every, cron: a.cron, sessionId: a.here ? ctx.sessionId : null }, { person, madeBy: 'agent' });
        return `Proposed ${x.id} "${x.title}" (${require('../../schedules/when').describe(x.when)}). It runs once the person switches it on in Harness → Schedules; tell them so.`;
      }
      if (!a.id) return 'Error: say which schedule (id).';
      const mine = s.listFor(person).find(x => x.id === a.id);
      if (!mine) return `Error: no schedule ${a.id} of theirs.`;
      if (a.action === 'pause') { s.setState(a.id, 'paused'); return `Paused ${a.id}.`; }
      if (a.action === 'delete') { s.remove(a.id); return `Deleted ${a.id}.`; }
      return 'Error: action is list, propose, pause or delete.';
    },
  },
  {
    // Decided 2026-10-07: a reminder the person asked for in their own words fires without a click — once, as a
    // notice to their own devices. A repeating schedule is still proposed and switched on by them.
    name: 'remind',
    description: 'Remind the person once, later, on their own devices — use it when they ask "remind me at 6 to call Marco" or "in 20 '
      + 'minutes". It is set at once (they asked), fires once as a notice, and is listed with their schedules (Harness → Schedules), '
      + 'where they can delete it. For something that repeats, propose a schedule instead.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to remind them of, as they would want to read it.' },
        at: { type: 'string', description: 'When, as a date and time on the person\'s own clock (2026-10-07T18:00), or …' },
        in: { type: 'number', description: '… in how many minutes from now.' },
        device: { type: 'string', description: 'One of their devices by name or id; default all of theirs that take notices.' },
      },
      required: ['text'],
    },
    run: async (a, ctx = {}) => {
      // A time without an offset is on the person's clock (the zone their screens report), not the hub's (deep test B, C10).
      const zones = require('../../timezones'), tz = zones.of(ctx.user?.id) || zones.hostZone();
      const at = a.at ? zones.parseLocal(a.at, tz) : Number(a.in) > 0 ? new Date(Date.now() + Number(a.in) * 60000) : null;
      if (!at || Number.isNaN(at.getTime())) return 'Error: say when — at (a date and time) or in (minutes).';
      const x = require('../../schedules').create({ kind: 'reminder', text: a.text, at: at.toISOString(), device: a.device }, { person: ctx.user || null, madeBy: 'agent' });
      return `Reminder ${x.id} set for ${zones.human(at, tz)}, ${zones.iso(at, tz)}${zones.of(ctx.user?.id) ? '' : ' — the hub\'s clock: none of their screens has said its zone yet'}: "${x.text}". It reaches their devices once; they can delete it in Harness → Schedules.`;
    },
  },
];

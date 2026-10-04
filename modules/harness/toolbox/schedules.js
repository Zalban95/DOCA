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
      + 'cron expression ("0 9 * * 1-5" is 09:00 on weekdays, host time). It runs as the person you are working for, with '
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
      const line = x => `- ${x.id} [${x.state}] ${x.title} — ${x.whenText}${x.nextAt && x.state === 'on' ? `, next ${x.nextAt}` : ''}${x.last ? `; last: ${x.last.ok ? 'ok' : 'failed'} ${x.last.summary.slice(0, 80)}` : ''}`;
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
];

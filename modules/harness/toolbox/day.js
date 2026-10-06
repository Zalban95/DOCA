'use strict';

/** The person's day (modules/ambient): what the ambient screen shows, for the agent (audit 2026-10-06, aw 6; TODO B6). */
module.exports = [
  {
    name: 'today',
    description: 'The person\'s day: the weather and five days ahead, today\'s plan from their connected calendar, and what is waiting '
      + 'for them (questions, proposals, missions) — use it for "what\'s my day", a morning brief, or before planning around the weather. '
      + 'place: a town (default: the hive\'s ambient place); units: metric or imperial.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'A town or address; default the ambient screen\'s place (ambient.place).' },
        units: { type: 'string', enum: ['metric', 'imperial'] },
      },
    },
    run: async ({ place, units }, ctx = {}) => {
      const where = place || require('../../settings-schema').value('ambient.place') || '';
      const d = await require('../../ambient').today(ctx.user || null, { place: where, units: units || require('../../settings-schema').value('ambient.units') || 'metric' });
      return JSON.stringify(d, null, 1).slice(0, 6000);
    },
  },
];

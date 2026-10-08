'use strict';

/** The person's day (modules/ambient): what the ambient screen shows, for the agent (audit 2026-10-06, aw 6; TODO B6). */
module.exports = [
  {
    name: 'today',
    description: 'The person\'s day: the weather and five days ahead, today\'s plan from their connected calendar, and what is waiting '
      + 'for them (questions, proposals, missions) — use it for "what\'s my day", "what\'s the weather", a morning brief, or before planning '
      + 'around the weather. place: a town (default: where the asking screen is — its place, else its own device\'s location); units: metric or imperial.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'A town or address; default where the asking screen is (ambient.place, else its device\'s own location).' },
        units: { type: 'string', enum: ['metric', 'imperial'] },
      },
    },
    run: async ({ place, units }, ctx = {}) => {
      // The asking screen's place, else its device's own position, else the hive's (ambient/where.js) — and which it was.
      const own = require('../../ambient/where').settingsOf(ctx.screen, ctx.user?.id);
      const d = await require('../../ambient').today(ctx.user || null, { place, screen: ctx.screen || null,
        units: units || own.units || require('../../settings-schema').value('ambient.units') || 'metric' });
      const w = d.weather;
      const head = w && !w.error ? `Weather for ${w.place} — ${d.where?.said || 'the place asked for'}. Say which place it is.`
        : !w ? 'No place is known for this screen, so there is no weather: ask the person which town they are in and, when they name it, set it '
          + 'with settings_propose {screen: "this", asked: true, changes: [{path: "ambient.place", value: "<town>"}]} — or they can tap '
          + '"Use this device\'s location" on Ambient.'
          : `The weather could not be read for ${JSON.stringify(place || '')} (${d.where?.said || 'no place'}): ${w.error}`;
      return `${head}\n${JSON.stringify(d, null, 1)}`.slice(0, 6000);
    },
  },
];

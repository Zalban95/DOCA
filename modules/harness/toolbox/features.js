'use strict';

/**
 * The feature index for the agent (modules/features; CONSTITUTION §0 and W14, TODO P1.7): every feature ever built,
 * where it lives and how it is switched on — looked up when needed rather than pasted into every prompt, since the
 * prompt is re-sent on every step. It reads DOCA's own index and usage counts and nothing else, so it is free to call.
 */
const { clip } = require('./common');

module.exports = [
  {
    name: 'features',
    description: 'Look up what DOCA can do — every feature ever built, where it is and how it is switched on — use it before '
      + 'saying something cannot be done, or to bring back an older way. find: words ("wake word", "search provider"); '
      + 'id: one feature; unused: true lists the alternatives kept beside their replacements with how much each is used.',
    parameters: {
      type: 'object',
      properties: {
        find:   { type: 'string', description: 'Words for what the person wants, e.g. "screen reading" or "telegram".' },
        id:     { type: 'string', description: 'One feature\'s id, from an earlier answer.' },
        unused: { type: 'boolean', description: 'true: the kept alternatives with their usage and a recommendation (for maintenance).' },
      },
    },
    run: ({ find, id, unused }, ctx = {}) => {
      const features = require('../../features');
      if (unused) return clip(['Alternatives kept beside what replaced them (nothing is removed; the admin may hide an unused one from the default in Settings → System → Features):',
        ...require('../../features/review').lines()].join('\n'));
      if (id) {
        const f = features.get(String(id));
        if (!f) return `No feature "${id}". Search with find.`;
        const alts = features.all().filter(a => a.beside === f.id);
        return features.describe(f) + (alts.length ? `\n  Kept beside it: ${alts.map(a => `${a.name} (${a.id})`).join(', ')}.` : '');
      }
      if (!find) {
        const n = features.all().length;
        return `${n} features are indexed. Call features with find: "<words>" for the ones that fit, or unused: true for the kept alternatives.`;
      }
      const hits = features.find(find);
      // A setting asked for by name is answered with where it is and the one way to change it (settings-find), so the
      // agent stops looking: "manual approval" used to send it from here to settings_read and back (deep test A).
      const sf = require('../../settings-find');
      const places = sf.find(find, { host: !ctx.user || require('../session-access').isHost(ctx.user), limit: 3 });
      const settings = places.length ? `\n\nSettings that match — where they are and how to change them:\n${places.map(sf.describe).join('\n')}` : '';
      if (!hits.length && !settings) return `Nothing indexed matches "${find}". Try other words, or say what the person wants done in plain words.`;
      return clip(`${hits.map(f => features.describe(f)).join('\n')}${settings}`.trim());
    },
  },
];

'use strict';

/**
 * The declaration of the screen setting `experience` (settings-schema.js reads it from here, beside the code that
 * keeps it): how one screen opens and moves — Standard (the panel as it always was) or Flow (pages warmed at the
 * start, a short movement between them, the groups on a side rail). A look is the person's, so nothing here is
 * proposable (docs/design/flow-experience.md).
 */
module.exports = { is: 'travels', home: 'device', on: 'screen', note: 'how this screen opens and moves between pages: standard (as always) or flow (pages warmed at the start, a short movement, groups on a side rail); the person\'s own (public/js/flow/*, docs/design/flow-experience.md)',
  keys: {
    mode:   { type: 'string', oneOf: ['standard', 'flow'], default: 'standard', propose: false, hint: 'Standard is the panel as it always was; Flow (experimental) warms the pages when it opens, moves between them in a fifth of a second and puts the groups on a side rail.' },
    warm:   { type: 'string', oneOf: ['all', 'used'], default: 'all', propose: false, hint: 'Which pages Flow gets ready when the panel opens: every page you can open, or only the ones you use most on this screen.' },
    motion: { type: 'string', oneOf: ['gentle', 'quick', 'none'], default: 'gentle', propose: false, hint: 'How pages move in Flow: gentle (220 ms), quick (120 ms) or none. A screen that asks for reduced motion never moves.' },
    groups: { type: 'string', oneOf: ['rail', 'top'], default: 'rail', propose: false, hint: 'Where Flow shows the groups of pages: a side rail, or across the top as in Standard.' },
  } };

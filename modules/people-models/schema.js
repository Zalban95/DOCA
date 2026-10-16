'use strict';

/**
 * The declaration of prefs `peopleModels` (settings-schema.js reads it from here): which models the people of this hub
 * run on (people-models/index.js; the owner's decision of 2026-10-16). Any combination may be on. Changing it asks for
 * the password (auth/guarded.js) and it is never proposable: it decides what every person's agents run on and spend.
 */
const never = spec => ({ ...spec, propose: false });

module.exports = { is: 'travels', home: 'hive', note: 'which models people run on: the owner\'s, their own choice, or one the owner assigns — the owner\'s, never proposable',
  keys: {
    same:   never({ type: 'boolean', default: true, hint: 'People use the same models as the owner (the harness\'s model and its fallbacks), when nothing else is set for them. Off: someone with no assigned model and no choice of their own has none.' }),
    choose: never({ type: 'boolean', default: false, hint: 'People choose their own model for a conversation, in the chat\'s model picker — only a model allotted to them (Settings → Users → a level\'s models), and counted against their budget. Admins always may.' }),
    assign: never({ type: 'boolean', default: false, hint: 'The owner assigns models: to one person, to a level, or to everyone but the owner. The most specific wins; a person\'s own choice, where allowed, wins over it.' }),
    all:    never({ type: 'string', default: '', hint: 'provider/model for everyone but the owner, when assigning. Empty: none.' }),
    levels: never({ type: 'object', default: {}, hint: 'provider/model per level id (member, admin, a level of your own), when assigning.' }),
    people: never({ type: 'object', default: {}, hint: 'provider/model per person (their account id), when assigning.' }),
  } };

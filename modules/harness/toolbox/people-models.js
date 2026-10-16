'use strict';

/**
 * Models for people, for the agent (people-models/; the owner's decisions of 2026-10-16): `show` says the policy, the
 * order the rules decide in, who may assign what, and — for the person on the turn — whom they may assign and to which
 * models; `propose` prepares the exact change they asked for as a card in this conversation, whose Accept asks their
 * password (CONSTITUTION S14). The agent never applies it: there is no `asked` here, and Unattended does not apply it.
 */
const words = m => (m === 'none' ? 'nothing assigned' : m || 'not set');

function show(person) {
  const pm = require('../../people-models'), as = require('../../people-models/assign');
  const pol = pm.policy();
  const lines = ['Models for people (Settings → Users → Models for people):',
    `- Policy (the owner's): people use the owner's models when nothing else applies: ${pol.same ? 'yes' : 'no'}; people choose their own in the chat: ${pol.choose ? 'yes' : 'no'} (admins always may); the owner assigns: ${pol.assign ? 'yes' : 'no'}.`,
    `- ${require('../../people-models/routes').RULE}`,
    '- Who assigns: the owner, to anyone but an owner; an admin (users, or a team leader whose level gives models) to people and levels strictly below their own level — never an equal, a higher level, the owner or themselves — and only models allotted to that person or level.',
    '- Every change asks the password of whoever accepts it. You only propose (action propose); the person accepts the card.',
    '- Other people\'s work: a host follows the missions and work chats of others in the header\'s icon (Follow on, by default for the owner) — never on their devices.'];
  if (!person?.id || !as.isAdmin(person)) return [...lines, `- ${person?.name || 'This person'} may not assign models.`].join('\n');
  const v = require('../../people-models/routes').view(person), slot = person.role === 'owner' ? 'owner' : 'admin';
  const row = (name, t) => `  ${name}: ${slot === 'owner' ? 'your rule' : 'your rule (as an admin)'} ${words(t[slot]?.model)}${t.counts ? `; decides now: ${t.counts.none ? 'nothing assigned' : t.counts.model} (${t.counts.setBy}'s for ${t.counts.from}, by ${t.counts.byName || '—'})` : ''}${t.options?.length ? `; allotted models: ${t.options.join(', ')}` : ''}`;
  return [...lines, `- ${person.name || 'They'} may assign to:`,
    ...v.levels.map(l => row(`level ${l.name} (${l.id})`, l)), ...v.people.map(p => row(`${p.name} (${p.levelName})`, p)),
    ...(v.levels.length || v.people.length ? [] : ['  nobody — no one here is below their level.'])].join('\n');
}

module.exports = [
  {
    name: 'people_models',
    description: 'Which models the people of this hub run on, and assigning one when a person asks ("give Marco the cheap model", '
      + '"nobody below me gets a model assigned"): show the policy, the rules and whom they may assign; propose the exact change — '
      + 'it waits as a card here for their Accept and password, and nothing changes before.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['show', 'propose'] },
      reason: { type: 'string', description: 'propose: one line, in the person\'s words.' },
      changes: { type: 'array', description: 'propose: each names a person (name or e-mail), a level (id or name), or everyone_below: true (every level below theirs).', items: { type: 'object', properties: {
        person: { type: 'string' }, level: { type: 'string' }, everyone_below: { type: 'boolean' },
        model: { type: 'string', description: 'provider/model (from show\'s allotted models), "nothing" (nothing assigned: broader rules stop reaching them), or "not set" (the next rule decides).' },
      } } },
    }, required: ['action'] },
    run: ({ action, changes, reason }, ctx = {}) => {
      const person = ctx.user?.id ? ctx.user : null;
      if (action === 'show') return show(person);
      if (action !== 'propose') return 'Error: action is show or propose.';
      try {
        const p = require('../../people-models/propose').propose(person, { changes, reason }, { sessionId: ctx.sessionId });
        return `Proposed (${p.id}) — it waits here as a card; it changes only when they accept it with their password:\n`
          + `${p.changes.map(c => `  ${c.path}: ${c.from} → ${c.to}`).join('\n')}\nTell them what you proposed, then stop.`;
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
];

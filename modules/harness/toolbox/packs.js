'use strict';

/**
 * The `pack` tool (TODO H4.5, "whatever the agent saves is a pack"): what the agent made — skills, recipes,
 * specialists — kept together in the library as one pack another hive can bring in. Saving applies nothing and sends
 * nothing: sending it to another hub and bringing packs in are a host's (Settings → Packs).
 */
module.exports = [
  {
    name: 'pack',
    description: 'Keep skills, recipes and specialists you made together as one pack in the library, so the owner can send it to another '
      + 'DOCA or share it (a .dpack: each part in its own world\'s format). save: name, and the ids to put in; list: what the library holds. '
      + 'Saving applies nothing and sends nothing — sending and bringing packs in are the owner\'s, in Settings → Packs.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'list'], description: 'save (default) or list.' },
        name: { type: 'string', description: 'save: what the pack is, in a few words.' },
        description: { type: 'string', description: 'save: one or two sentences: what it does and when to use it.' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Skill names (their recipes come along).' },
        recipes: { type: 'array', items: { type: 'string' }, description: 'Recipe ids.' },
        specialists: { type: 'array', items: { type: 'string' }, description: 'Specialist ids.' },
      },
    },
    run: ({ action = 'save', name, description, skills = [], recipes = [], specialists = [] }) => {
      const lib = require('../../packs/library');
      if (action === 'list') {
        const all = lib.list();
        return all.length ? all.map(p => `- ${p.id} "${p.name}" (${p.origin}${p.from ? ` from ${p.from}` : ''}, ${p.savedAt.slice(0, 10)}): ${p.contents.map(c => `${c.kind} ${c.id || ''}`.trim()).join(', ')}`).join('\n') : 'The library is empty.';
      }
      if (!String(name || '').trim()) return 'Error: a pack needs a name.';
      const { buffer } = require('../../packs/export').build({ name, description, skills, recipes, specialists });
      const meta = lib.save(buffer, { origin: 'agent', from: 'the agent' });
      return `Kept "${meta.name}" in the library as ${meta.id}: ${meta.contents.map(c => `${c.kind} ${c.id || ''}`.trim()).join(', ')}. `
        + 'The owner can send it to another hub or download it from Settings → Packs.';
    },
  },
];

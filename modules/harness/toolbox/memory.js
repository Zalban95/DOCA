'use strict';

/**
 * Durable memory and the rules it is kept by.
 */

const memory   = require('../memory');
const { clip } = require('./common');

module.exports = [
  {
    name: 'memory_write',
    description: 'Remember something for good, following the memory rules in your context. Use it for facts '
      + 'about this machine, paths, ports, hardware, and the user\'s standing preferences — anything you would '
      + 'want to know at the start of a future conversation. Writing an existing key overwrites it, keeping the '
      + 'previous value as history. An entry the user has locked cannot be overwritten here: flag it with '
      + 'memory_flag instead. Never store secrets.',
    parameters: {
      type: 'object',
      properties: {
        key:      { type: 'string', description: 'Short stable identifier, e.g. "gpu" or "models-dir".' },
        value:    { type: 'string', description: 'The fact itself, in one or two sentences.' },
        category: { type: 'string', description: 'One of your memory categories, listed in your context.' },
        tags:     { type: 'array', items: { type: 'string' }, description: 'Optional keywords to help you find it later.' },
        pinned:   { type: 'boolean', description: 'Pin to always include it in your context.' },
      },
      required: ['key', 'value'],
    },
    run: ({ key, value, tags, pinned, category }) => {
      const e = memory.memWrite({ key, value, tags, pinned, category, source: 'agent' });
      return `Remembered "${e.key}"${e.category ? ` under ${e.category}` : ''}${e.pinned ? ', pinned' : ''}.`;
    },
  },
  {
    name: 'memory_rules_write',
    description: 'Change how you keep your own memory: the categories facts are filed under and the rules you '
      + 'follow when writing them. Both are in your context every turn. Use it when you find a better way to '
      + 'keep this memory, or when the user tells you one. Prefer add/remove/replace, which change one rule and '
      + 'leave the rest alone; the full "rules" and "categories" lists replace everything and silently delete any '
      + 'rule you did not retype.',
    parameters: {
      type: 'object',
      properties: {
        add: {
          type: 'array', items: { type: 'string' },
          description: 'Rules to append, leaving every existing rule in place. This is usually what you want.',
        },
        remove: {
          type: 'array', items: { type: 'string' },
          description: 'Rules to drop, each either its number in the list you were shown or its exact text.',
        },
        replace: {
          type: 'array',
          description: 'Rules to rewrite in place, leaving the others alone.',
          items: {
            type: 'object',
            properties: {
              index: { type: 'integer', description: 'Which rule, numbered from 1 as shown in your context.' },
              text:  { type: 'string',  description: 'What it should say instead.' },
            },
            required: ['index', 'text'],
          },
        },
        addCategories: {
          type: 'array',
          description: 'Categories to add, leaving the existing ones alone.',
          items: {
            type: 'object',
            properties: {
              id:          { type: 'string', description: 'Short lower-case name, e.g. "machine".' },
              description: { type: 'string', description: 'What belongs in it.' },
            },
            required: ['id'],
          },
        },
        removeCategories: { type: 'array', items: { type: 'string' }, description: 'Category ids to drop.' },
        categories: {
          type: 'array',
          description: 'The complete new category list, replacing the old one. Only for a deliberate rewrite.',
          items: {
            type: 'object',
            properties: {
              id:          { type: 'string', description: 'Short lower-case name, e.g. "machine".' },
              description: { type: 'string', description: 'What belongs in it.' },
            },
            required: ['id'],
          },
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          description: 'The complete new rule list, replacing the old one. Every rule you omit is deleted, so '
            + 'use add/remove/replace unless you mean to rewrite the whole rulebook.',
        },
      },
    },
    run: ({ categories, rules, add, remove, replace, addCategories, removeCategories }) => {
      const selective = [add, remove, replace, addCategories, removeCategories].some(x => x !== undefined);
      if (selective) {
        const doc = memory.rulesPatch({ add, remove, replace, addCategories, removeCategories, source: 'agent' });
        return `Memory rules updated in place: ${doc.categories.length} categories, ${doc.rules.length} rules. `
          + 'Everything you did not name was left as it was.';
      }
      if (categories === undefined && rules === undefined)
        return 'Error: pass add, remove, replace, addCategories, removeCategories, categories or rules.';
      const doc = memory.rulesWrite({ categories, rules, source: 'agent' });
      return `Memory rules replaced: ${doc.categories.length} categories, ${doc.rules.length} rules. `
        + 'Anything not in the list you sent is gone.';
    },
  },
  {
    name: 'memory_search',
    description: 'Search your durable memory by keyword. Do this before answering a question that depends on '
      + 'something you were told in an earlier conversation.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to look for.' },
        limit: { type: 'integer', description: 'Maximum entries to return (default 8).' },
      },
      required: ['query'],
    },
    run: ({ query, limit }) => {
      const hits = memory.memSearch(query, Math.min(Number(limit) || 8, 30));
      memory.memTouch(hits);
      if (!hits.length) return `Nothing in memory matches "${query}".`;
      return clip(hits.map(e => `- ${e.key}: ${e.value}`).join('\n'));
    },
  },
  {
    name: 'memory_list',
    description: 'List your durable memory keys, categories, pinned/locked/disputed flags, and the first line '
      + 'of each value. Use this inventory to find an existing key before creating a near-duplicate. '
      + 'Read-only; use memory_search for full values.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Exact category, case-insensitive. Omit for all categories; empty string for uncategorized entries.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Entries per page, default 50, maximum 100.' },
        offset: { type: 'integer', minimum: 0, description: 'Entries to skip, default 0. Use the next offset in the result to continue.' },
      },
    },
    run: ({ category, limit = 50, offset = 0 }) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a nonnegative integer');
      const wanted = category === undefined ? null : String(category).trim().toLowerCase();
      const entries = memory.memList().filter(e => wanted === null || (e.category || '').toLowerCase() === wanted);
      const page = entries.slice(offset, offset + limit);
      const rows = page.map(e => {
        const first = String(e.value || '').split(/\r?\n/, 1)[0];
        const flags = ['pinned', 'locked', 'disputed'].filter(k => e[k]);
        return `- ${JSON.stringify(e.key)} [${e.category || 'uncategorized'}${flags.length ? `; ${flags.join(', ')}` : ''}]: `
          + first.slice(0, 200) + (first.length > 200 ? '…' : '');
      });
      return clip(`${page.length} of ${entries.length} memory entries (offset ${offset})${wanted === null ? '' : ` in category ${JSON.stringify(category)}`}.\n`
        + rows.join('\n')
        + (offset + page.length < entries.length ? `\nMore entries: call memory_list with offset ${offset + page.length} and the same category.` : ''));
    },
  },
  {
    name: 'memory_forget',
    description: 'Delete a memory entry by key once it is wrong AND you know what the right answer is. While you '
      + 'only know it is wrong, use memory_flag instead — a fact known to be false is still worth having, and '
      + 'deleting it means the next conversation rediscovers it the hard way. Locked entries cannot be deleted here.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'The key to forget.' } },
      required: ['key'],
    },
    run: ({ key }) => { memory.memForget(key, { source: 'agent' }); return `Forgot "${key}".`; },
  },
  {
    name: 'memory_flag',
    description: 'Record that something contradicted a remembered fact, without deleting it. Use it the moment '
      + 'reality disagrees with your memory — the documented port is closed, the path has moved, the command the '
      + 'user preferred now fails. The entry stays, marked, with what you saw; correct it with memory_write once '
      + 'you know what is true instead. This is the only way to dispute an entry the user has locked.',
    parameters: {
      type: 'object',
      properties: {
        key:  { type: 'string', description: 'The key that turned out to be wrong.' },
        note: { type: 'string', description: 'What contradicted it — what you ran or read, and what happened.' },
      },
      required: ['key', 'note'],
    },
    run: ({ key, note }) => {
      const e = memory.memDispute(key, { note, source: 'agent' });
      return `Flagged "${e.key}" as contradicted. It stays in memory, marked, until it is corrected`
        + `${e.locked ? ' — it is locked, so the user decides what it says next.' : '.'}`;
    },
  },
];

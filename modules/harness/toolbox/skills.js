'use strict';

/** Skills (harness/skills.js): load a procedure when the task matches it; keep one learned. */
module.exports = [
  {
    // Tools sent by tier (turn/tool-tiers.js): absent when every tool is sent in full (toolsLoading: all, tool-shape.js).
    name: 'tools_more',
    description: 'Load tools you hold that are not loaded yet (listed under "More tools" in Your tools) — use it before you need one of them. '
      + 'names: tool names, or mcp:<server> for all of a server\'s tools. They stay loaded for this conversation from your next step.',
    parameters: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' }, description: 'Tool names, or mcp:<server id>.' } },
      required: ['names'],
    },
    run: ({ names = [] }, ctx = {}) => {
      const tiers = require('../turn/tool-tiers');
      const held = new Set(require('../tools').schemas().map(x => x.function.name));
      const ok = (Array.isArray(names) ? names : [names]).map(String).filter(n => held.has(n)
        || (n.startsWith('mcp:') && [...held].some(h => tiers.serverOf(h) === n.slice(4))));
      const unknown = (Array.isArray(names) ? names : [names]).map(String).filter(n => !ok.includes(n));
      const fresh = tiers.attach(ctx.sessionId, ok);
      return (ok.length ? `Loaded from your next step: ${ok.join(', ')}${fresh.length < ok.length ? ' (some were already loaded)' : ''}.` : 'Nothing loaded.')
        + (unknown.length ? ` Not tools you hold: ${unknown.join(', ')}.` : '');
    },
  },
  {
    name: 'tool_note',
    description: 'Propose a note about one of your tools — something this install taught you about it that its description does not say '
      + '(a quirk, a limit, the retry that works). The person accepts it with a click, like a setting; then it is added to that '
      + 'tool\'s description for every later step. One or two sentences, about the tool, never a person\'s data. list shows the notes kept.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['propose', 'list'] },
        tool:   { type: 'string', description: 'The tool\'s exact name.' },
        note:   { type: 'string', description: 'For propose: the note, at most 500 characters.' },
        reason: { type: 'string', description: 'For propose: what happened that taught you this, in one line.' },
      },
      required: ['action'],
    },
    run: (a, ctx = {}) => {
      const notes = require('../tool-notes');
      if (a.action === 'list') return Object.entries(notes.all()).map(([t, n]) => `${t}: ${n?.text}`).join('\n') || 'No tool notes yet.';
      const tool = require('../tools').schemas([]).find(s => s.function.name === a.tool);
      if (!tool) throw new Error(`No tool called "${a.tool}".`);
      const raw = [...require('../tools').TOOLS].find(t => t.name === a.tool)?.description ?? tool.function.description.split('\nNote from this install')[0];
      const value = notes.noteValue(a.tool, a.note, raw);
      const r = require('../settings').propose({ changes: [{ path: `toolNotes.${a.tool}`, value }], reason: a.reason || `A note about ${a.tool}`, sessionId: ctx.sessionId });
      return typeof r === 'string' ? r : `Proposed a note on ${a.tool}; it is added to its description once the person accepts it.`;
    },
  },
  {
    name: 'skill',
    description: 'Load a skill — a procedure for a kind of task — when the task matches one in the Skills list of your '
      + 'prompt: read returns its instructions and the files beside them, file one of those files, list them all. '
      + 'write keeps a procedure you worked out, on this machine, for the next time: steps, commands, what to check — '
      + 'never a person\'s or a client\'s data. search looks through every skill on this machine, other harnesses\' too, '
      + 'when none in your list fits.',
    parameters: {
      type: 'object',
      properties: {
        action:      { type: 'string', enum: ['list', 'read', 'file', 'write', 'search'] },
        query:       { type: 'string', description: 'For search: words to look for in every skill on this machine — DOCA\'s and other harnesses\' (Claude Code, Codex, Gemini CLI).' },
        name:        { type: 'string' },
        path:        { type: 'string', description: 'For file: a path inside the skill, as read lists it.' },
        description: { type: 'string', description: 'For write: when to use it, in one line.' },
        body:        { type: 'string', description: 'For write: the instructions, in markdown.' },
      },
      required: ['action'],
    },
    run: a => {
      const skills = require('../skills');
      switch (a.action) {
        case 'list': return require('../skill-use').offered().map(s => `${s.name} (${s.source}): ${s.description}`).join('\n') || 'No skills yet.';
        case 'read': {
          if (require('../skill-use').isOff(a.name)) return `The skill ${a.name} is switched off on this hub (Settings → Harness → Skills): the person can switch it back on, or attach it to this chat.`;
          const s = skills.read(a.name); return `# ${s.name}\n${s.body}${s.files.length ? `\n\nFiles beside it (skill action file): ${s.files.join(', ')}` : ''}`; }
        case 'file': return skills.file(a.name, a.path).text;
        case 'write': { const s = skills.write(a.name, a); return `Skill ${s.name} kept on this machine; it is in the Skills list from the next turn.`; }
        case 'search': {
          const hits = require('../skill-sources').search(a.query);
          return hits.length ? hits.map(h => `${h.name} — ${h.where}${h.inDoca ? '' : ' (not in DOCA: the user can import it in Settings → Harness → Skills)'}: ${h.description}`).join('\n')
            : `No skill on this machine mentions "${a.query}".`;
        }
        default: throw new Error('action is list, read, file, write or search.');
      }
    },
  },
];

'use strict';

/** Skills (harness/skills.js): load a procedure when the task matches it; keep one learned. */
module.exports = [
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
      + 'never a person\'s or a client\'s data.',
    parameters: {
      type: 'object',
      properties: {
        action:      { type: 'string', enum: ['list', 'read', 'file', 'write'] },
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
        case 'list': return skills.list().map(s => `${s.name} (${s.source}): ${s.description}`).join('\n') || 'No skills yet.';
        case 'read': { const s = skills.read(a.name); return `# ${s.name}\n${s.body}${s.files.length ? `\n\nFiles beside it (skill action file): ${s.files.join(', ')}` : ''}`; }
        case 'file': return skills.file(a.name, a.path).text;
        case 'write': { const s = skills.write(a.name, a); return `Skill ${s.name} kept on this machine; it is in the Skills list from the next turn.`; }
        default: throw new Error('action is list, read, file or write.');
      }
    },
  },
];

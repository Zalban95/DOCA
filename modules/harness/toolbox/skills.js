'use strict';

/** Skills (harness/skills.js): load a procedure when the task matches it; keep one learned. */
module.exports = [
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

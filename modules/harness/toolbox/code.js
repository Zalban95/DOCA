'use strict';

/** `run_code` (experiment codeCalls): a short script that calls several tools in one step, each through the turn's gates. */
module.exports = [
  {
    name: 'run_code',
    description: 'Run a short JavaScript script that calls your tools in one step — `const t = await tools.read_file({ path: '
      + '"a.js" })`, loops and conditions between calls — when one plan needs many calls whose arguments follow from '
      + 'earlier results (read many files and write a summary, run a command over every level, one edit across modules). '
      + 'Every call it makes passes your approvals and rules as if you made it, and is kept in a conversation of its own; '
      + 'console.log is its output and what it returns its value. Not for a single call — call that tool — and never to '
      + 'get around a refusal.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The body of an async function. `tools.<name>(args)` and `call(name, args)` return each tool\'s result text.' },
        timeoutSec: { type: 'integer', description: 'Time limit, 5–600 seconds (default 120).' },
      },
      required: ['code'],
    },
    danger: true,
    run: (a, ctx = {}) => require('../code-calls').run(a, ctx),
  },
];

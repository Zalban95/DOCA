'use strict';

/**
 * A repository's rules and state, read before the first change (charter rule 16).
 */

const repo = require('../repo');
const { resolvePath } = require('./common');

module.exports = [
  {
    name: 'repo_rules',
    description: 'Read the rules of the git repository a path is in — its AGENTS.md, CLAUDE.md, .cursor/rules, '
      + 'CONTRIBUTING.md, and any AGENTS.md closer to that path — together with its current branch and '
      + 'uncommitted changes. Call it before your first change in a repository; write_file refuses until you have.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'A file or directory inside the repository (the one you are about to change).' } },
      required: ['path'],
    },
    run: ({ path: p }, ctx = {}) => repo.brief(ctx.sessionId, resolvePath(p)),
  },
];

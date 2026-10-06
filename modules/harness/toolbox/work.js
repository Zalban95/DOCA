'use strict';

/**
 * The three-level workspace: work chats and their plans.
 */


module.exports = [
  {
    name: 'work_chats',
    description: 'Manage the three-level workspace. List/read the conversations in your line and their archived work; read transcripts only on demand. '
      + 'The Orchestrator creates work chats (planning:true for detailed planning), optionally starting a task with message. '
      + 'Send gives a subordinate a task in the background; it returns immediately, and the work chat carries it to the end on its own. '
      + 'Report records your brief and informs superiors; with outcome done, failed, blocked or question it ends your job and wakes the Orchestrator, '
      + 'without an outcome it is progress and wakes nobody. List shows every job\'s state. Archive retains transcripts; recall reopens them. '
      + 'Restart or drop a work chat a person STOPPED (Stopped work in your prompt) — only with their answer.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'read', 'create', 'send', 'stop', 'report', 'archive', 'recall', 'restart', 'drop'] },
      sessionId: { type: 'string' }, title: { type: 'string' }, message: { type: 'string' },
      planning: { type: 'boolean' }, all: { type: 'boolean', description: 'Include archives in list.' },
      outcome: { type: 'string', enum: ['done', 'failed', 'blocked', 'question'],
        description: 'With report, from a work chat: the job is over (done/failed), cannot go on without a decision from above (blocked), or needs the owner (question).' },
      transcript: { type: 'boolean' }, offset: { type: 'integer' }, limit: { type: 'integer' },
    }, required: ['action'] },
    run: async (args, ctx) => JSON.stringify(['restart', 'drop'].includes(args.action)
      ? require('../stopped-work').decide(args.sessionId, args.action === 'restart', ctx) : await require('../organization').tool(args, ctx)),
  },
  {
    name: 'work_plan',
    description: 'Read, draft or propose a durable plan for this conversation or a subordinate. '
      + 'Draft needs title and steps, and replaces the current revision (requiring fresh approval). '
      + 'Propose opens it in a window in front of the user, with Approve and Reject, and offers it on their phone; '
      + 'you cannot approve it, so end your turn after proposing and wait for their decision. '
      + 'Their approval starts the work here, with a message telling you to carry it out. Progress marks a numbered step without changing the approved scope. '
      + 'Use mission_plan for specialist mission progress.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['read', 'draft', 'propose', 'progress'] }, sessionId: { type: 'string' },
      title: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, note: { type: 'string' },
      step: { type: 'integer', description: 'One-based step number for progress.' },
      state: { type: 'string', enum: ['queued', 'running', 'done', 'blocked'] },
    }, required: ['action'] },
    run: (args, ctx) => {
      const org = require('../organization'), id = args.sessionId || ctx.sessionId;
      if (args.action !== 'read' && !org.canManage(ctx.sessionId, id)) throw new Error('You may edit only your own plan or a subordinate\'s.');
      const plan = org.plan(id, args);
      if (args.action !== 'propose') return JSON.stringify(plan);
      // A proposal is a question to a person, so it goes where people look (plan-doc.js).
      const shown = require('../plan-doc').show(id, plan, ctx);
      return JSON.stringify({ ...plan, shown: shown
        ? 'Opened in front of the user as a window with Approve and Reject. Do not start the work until they approve — their approval arrives here as a message to carry it out; end this turn and say in one line what you are waiting for.'
        : 'Recorded; the user sees it in the Harness tab.' });
    },
  },
];

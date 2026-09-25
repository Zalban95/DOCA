'use strict';

/**
 * The three-level workspace: work chats and their plans.
 */


module.exports = [
  {
    name: 'work_chats',
    description: 'Manage the three-level workspace. List/read the conversations in your line and their archived work; read transcripts only on demand. '
      + 'The Orchestrator creates work chats (planning:true for detailed planning), optionally starting a task with message. '
      + 'Send continues a subordinate in the background; it returns immediately. Report records your brief and informs superiors. '
      + 'Archive retains transcripts; recall reopens them. Reports are shown on the superior\'s next turn, without starting a model call.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'read', 'create', 'send', 'stop', 'report', 'archive', 'recall'] },
      sessionId: { type: 'string' }, title: { type: 'string' }, message: { type: 'string' },
      planning: { type: 'boolean' }, all: { type: 'boolean', description: 'Include archives in list.' },
      transcript: { type: 'boolean' }, offset: { type: 'integer' }, limit: { type: 'integer' },
    }, required: ['action'] },
    run: async (args, ctx) => JSON.stringify(await require('../organization').tool(args, ctx)),
  },
  {
    name: 'work_plan',
    description: 'Read, draft or propose a durable plan for this conversation or a subordinate. '
      + 'Draft needs title and steps, and replaces the current revision (requiring fresh approval). '
      + 'Propose presents it in the Harness for the user to approve/reject. You cannot approve it. '
      + 'Approval records a decision, never launches work. Progress marks a numbered step without changing the approved scope. '
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
      return JSON.stringify(org.plan(id, args));
    },
  },
];

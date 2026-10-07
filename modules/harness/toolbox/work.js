'use strict';

/**
 * The three-level workspace: work chats and their plans.
 */


const WORK_NEEDS = { create: ['title'], send: ['sessionId', 'message'], report: ['message'], stop: ['sessionId'],
  archive: ['sessionId'], recall: ['sessionId'], restart: ['sessionId'], drop: ['sessionId'] };

module.exports = [
  {
    name: 'work_chats',
    description: 'Manage the three-level workspace. List/read the conversations in your line and their archived work; read transcripts only on demand. '
      + 'Only the Orchestrator creates work chats (planning:true for detailed planning), optionally starting a task with message; a work chat cannot. '
      + 'Send gives a subordinate a task in the background; it returns immediately, and the work chat carries it to the end on its own. '
      + 'Report records your brief and informs superiors; with outcome done, failed, blocked or question it ends your job and wakes the Orchestrator, '
      + 'without an outcome it is progress and wakes nobody. List shows every job\'s state. Archive retains transcripts; recall reopens them. '
      + 'Restart or drop a work chat a person STOPPED (Stopped work in your prompt) — only with their answer.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'read', 'create', 'send', 'stop', 'report', 'archive', 'recall', 'restart', 'drop'] },
      sessionId: { type: 'string', description: 'The work chat: needed by send, stop, archive, recall, restart and drop; for read, default your own.' },
      title: { type: 'string', description: 'create: the job in a few words.' },
      message: { type: 'string', description: 'create: the task to start with (what is known, what done looks like); send: the task; report: your brief.' },
      planning: { type: 'boolean', description: 'create: a work chat that plans and proposes, not one that carries out.' },
      all: { type: 'boolean', description: 'Include archives in list.' },
      outcome: { type: 'string', enum: ['done', 'failed', 'blocked', 'question'],
        description: 'With report, from a work chat: the job is over (done/failed), cannot go on without a decision from above (blocked), or needs the owner (question).' },
      transcript: { type: 'boolean', description: 'read: include the messages, not only briefs and reports.' },
      offset: { type: 'integer', description: 'read: where to start (reports or messages).' }, limit: { type: 'integer', description: 'list: how many.' },
    }, required: ['action'] },
    run: async (args, ctx) => require('./common').needs('work_chats', args, WORK_NEEDS) || JSON.stringify(['restart', 'drop'].includes(args.action)
      ? require('../stopped-work').decide(args.sessionId, args.action === 'restart', ctx) : await require('../organization').tool(args, ctx)),
  },
  {
    name: 'work_plan',
    description: 'Read, draft or propose a durable plan for this conversation or a subordinate. '
      + 'Draft needs title and steps, and replaces the current revision (requiring fresh approval). '
      + 'Propose opens it in a window in front of the user, with Approve and Reject, and offers it on their phone; '
      + 'you cannot approve it, so end your turn after proposing and wait for their decision. '
      + 'Their approval starts the work here, with a message telling you to carry it out. Progress marks a numbered step without changing the approved scope. '
      + 'Give each step its contract in contracts (same order: {done: "done when …", check}) so finished means every contract holds: marking a step done runs '
      + 'its check first ({file}, {file, contains}, {url}, {page, contains, selector, noErrors} — the page as rendered —, {absent} or {free: port}; run tests yourself), and the plan reads fulfilled when all are done. '
      + 'Use mission_plan for specialist mission progress.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['read', 'draft', 'propose', 'progress'] }, sessionId: { type: 'string' },
      title: { type: 'string' }, note: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' } },
      contracts: { type: 'array', description: 'draft: one per step, in order — {done: "done when …", check?: {file} | {file, contains} | {url}}; {} for a step without one.',
        items: { type: 'object', properties: { done: { type: 'string' }, check: { type: 'object' } } } },
      step: { type: 'integer', description: 'One-based step number for progress.' },
      state: { type: 'string', enum: ['queued', 'running', 'done', 'blocked'] },
    }, required: ['action'] },
    run: async (args, ctx) => {
      const org = require('../organization'), id = args.sessionId || ctx.sessionId;
      if (args.action !== 'read' && !org.canManage(ctx.sessionId, id)) throw new Error('You may edit only your own plan or a subordinate\'s.');
      // A step marked done is held to its contract first (plan-contracts.js): a failing check keeps it open, with why.
      if (args.action === 'progress' && args.state === 'done') {
        const cur = org.plan(id, { action: 'read' }), contract = cur?.contracts?.[args.step - 1];
        if (contract) {
          let cwd; try { cwd = require('../../projects/store').forSession(id)?.root; } catch { /* no project */ }
          const v = await require('../plan-contracts').verify(contract, { cwd });
          if (!v.ok) return JSON.stringify({ step: args.step, done: false, contract: contract.done, check: v.why,
            note: 'Not marked done: its contract does not hold yet. Finish the step, then mark it again — or revise the plan if the contract was wrong.' });
        }
      }
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

'use strict';

/**
 * Specialists: dispatch, resume, collect, and report a mission's plan.
 */


module.exports = [
  {
    name: 'agent_dispatch',
    description: 'Hand a self-contained errand to one of the specialists listed in your prompt. It runs as '
      + 'a mission in the background: this returns a mission id at once and you are NOT blocked — carry on '
      + 'talking to the user, and read the answer later with agent_results. Give it everything it needs in '
      + '`context`, because a specialist sees only what you hand it. Use it when the work is a separable '
      + 'errand (look something up, build something, check something); do it yourself when it is a '
      + 'sentence of thinking. Tell the user what you sent and to whom.',
    parameters: {
      type: 'object',
      properties: {
        agent:   { type: 'string', description: 'The specialist\'s id, from the list in your prompt.' },
        task:    { type: 'string', description: 'The errand, in full. Write it for somebody who was not in this conversation.' },
        context: { type: 'string', description: 'Anything from this conversation it needs. It sees nothing else.' },
        plan: {
          type: 'array',
          description: 'Optional. The errand broken into steps, so a phone or a watch can draw how far along it '
            + 'is. Roughly 3-12 items, each a short phrase. The specialist keeps it updated and may correct it.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'One short step, e.g. "Read the current prices".' },
              state: { type: 'string', enum: ['queued', 'running', 'done', 'failed'],
                       description: 'Almost always "queued" when you dispatch — you are planning, not reporting.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['agent', 'task'],
    },
    run: ({ agent, task, context, plan }, ctx = {}) => {
      const m = require('../../agents/missions').dispatch({ agentId: agent, task, context, plan, by: ctx.sessionId });
      // A plan is what lets every client draw progress instead of "STEP 0"
      // until the mission is already over — see missions.setPlan().
      const how = Array.isArray(plan) && plan.length
        ? ` Its plan has ${plan.length} step${plan.length === 1 ? '' : 's'}, so devices can draw progress from now.`
        : ' If you know the shape of the errand, passing `plan` lets devices draw progress from the start.';
      return `Mission ${m.id} started — ${m.label} is working on it. You are not waiting: carry on, and `
        + `read the result with agent_results when you need it.${how}`;
    },
  },
  {
    name: 'agent_resume',
    description: 'Act on the user\'s answer about a mission a restart PAUSED. continue: true picks it up where it '
      + 'stopped, in its own session; continue: false drops it. Only call this after the user has answered — '
      + 'the choice is theirs, not yours.',
    parameters: {
      type: 'object',
      properties: {
        mission:  { type: 'string', description: 'The paused mission\'s id, from the Missions list in your prompt.' },
        continue: { type: 'boolean', description: 'What the user said: true to carry on, false to drop it.' },
      },
      required: ['mission', 'continue'],
    },
    run: ({ mission, continue: go }) => {
      const m = require('../../agents/missions').resume(mission, { go: go === true });
      return m.state === 'running'
        ? `${m.id} resumed — ${m.label} is carrying on from step ${m.steps}. You are not waiting; read it later with agent_results.`
        : `${m.id} dropped, as the user asked.`;
    },
  },
  {
    name: 'agent_results',
    description: 'How a mission you dispatched is getting on, and its answer once it has one. Call it when '
      + 'you actually need the result. A work leader may set wait:true to wait up to 30 seconds for its '
      + 'own specialist without spending model calls on polling; the Orchestrator stays available. '
      + 'If still running at the deadline, report that status instead of looping.',
    parameters: {
      type: 'object',
      properties: { mission: { type: 'string', description: 'A mission id. Omit for all recent missions.' },
        wait: { type: 'boolean', description: 'Work leaders only: bounded wait for a subordinate result.' } },
    },
    run: async ({ mission, wait }, ctx = {}) => {
      const missions = require('../../agents/missions');
      if (!mission) {
        const rows = missions.list({ limit: 10 });
        if (!rows.length) return 'No missions.';
        return rows.map(m => `${m.id} (${m.label}): ${m.state}`).join('\n');
      }
      let m = missions.get(mission);
      if (!m) return `No mission called "${mission}".`;
      if (wait && m.state === 'running') {
        const org = require('../organization');
        if (!ctx.sessionId || org.session(ctx.sessionId).kind !== 'work' || !org.canManage(ctx.sessionId, m.sessionId))
          return 'Only the responsible work leader may wait. The Orchestrator should remain available to the user.';
        const deadline = Date.now() + 30000;
        while (m.state === 'running' && Date.now() < deadline) {
          await require('node:timers/promises').setTimeout(250, undefined, { signal: ctx.signal });
          m = missions.get(mission);
          if (!m) return `Mission ${mission} is no longer indexed; inspect its conversation with work_chats.`;
        }
      }
      if (m.state === 'running') return `${m.id} is still running (step ${m.steps}). Carry on; ask again later.`;
      if (m.state !== 'done') return `${m.id} ${m.state}${m.error ? `: ${m.error}` : ''}.`;
      return `${m.id} (${m.label}) finished in ${m.steps} steps:\n\n${m.result}`;
    },
  },
  {
    name: 'mission_plan',
    description: 'Set out how far along this mission is, so the user\'s devices can draw progress instead of '
      + 'showing "STEP 0" until it is already over. Call it once near the start with the whole plan, then tick '
      + 'items as you finish them. It drives the mission — it does not authorise anything, so it is available '
      + 'inside a mission and not only to the agent that dispatched it.',
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'array',
          description: 'Replace the plan with this list. Send the whole thing, not a diff.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'One short step, roughly 60 characters or less.' },
              state: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
            },
            required: ['title'],
          },
        },
        tick: {
          type: 'object',
          description: 'Move one item, matched by its title, without resending the list.',
          properties: {
            title: { type: 'string', description: 'The item\'s title, exactly as you set it.' },
            state: { type: 'string', enum: ['queued', 'running', 'done', 'failed'] },
          },
          required: ['title'],
        },
      },
    },
    run: ({ set, tick }, ctx = {}) => {
      const missions = require('../../agents/missions');
      const mine = missions.forSession(ctx.sessionId);
      if (!mine) {
        // The orchestrator's own conversation is not a mission. Saying so is
        // better than "no mission called undefined" — and a specialist that
        // started with a plan is told here that it already has one.
        return 'This conversation is not a mission, so it has no plan to set. Plans belong to missions; '
          + 'dispatch one with `agent_dispatch` and pass its `plan` there.';
      }
      const plan = missions.setPlan(mine.id, { set, tick });
      if (!plan || !plan.length) return 'Plan cleared.';
      const p = missions.planProgress(plan);
      const drawn = plan.map(i => `${i.state === 'done' ? '[x]' : i.state === 'running' ? '[>]' : i.state === 'failed' ? '[!]' : '[ ]'} ${i.title}`).join('\n');
      return `${p.done}/${p.total} done (${p.percent}%):\n${drawn}`;
    },
  },
];

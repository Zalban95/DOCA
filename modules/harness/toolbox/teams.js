'use strict';

/**
 * Teams (modules/teams; docs/design/teams.md): `team` for a leader — the Orchestrator, a work chat, a person's chat —
 * and `team_note` for a specialist on a team. `team` is in registry.NEVER: a specialist never makes a team, as it
 * never dispatches. `team_note` is held only by a mission that belongs to a team (turn/tool-shape.js).
 */
const teams = () => require('../../teams');
const board = () => require('../../teams/board');

function said(v) {
  const t = v.tasks.map(x => `${x.id} ${x.title} (${x.agent}${x.missionId ? `, ${x.missionId}` : ''}): ${board().say(x)}${x.state === 'running' ? ` — ${x.percent}%` : ''}`);
  return [`${v.id} "${v.title}": ${v.state}, ${v.progress.done} of ${v.progress.total} tasks done (${v.progress.percent}%, every task counts the same)`
    + `${v.loop?.on ? `; keep going round ${v.loop.rounds || 0} of ${v.maxRounds}` : ''}.`, ...t,
  v.doc?.name ? `Its document: ${v.doc.project ? `${v.doc.project} in the project, and ` : ''}${v.doc.name} in the attachments.` : '',
  v.notes?.length ? `${v.notes.length} note${v.notes.length === 1 ? '' : 's'} from the team; the latest: ${v.notes.slice(-1)[0].from} — ${v.notes.slice(-1)[0].text.slice(0, 160)}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = [
  {
    name: 'team',
    description: 'Run a team: several errands for specialists at once, some waiting on others, each with a contract — the hub '
      + 'dispatches each task when the tasks it comes after are done, checks its contract when it finishes, and keeps a '
      + 'living document of the board. create makes one (title, goal, tasks); status reads one; stop ends every task; '
      + 'keep_going on tries failed tasks again until every contract holds or its rounds run out. You do not dispatch a '
      + 'team\'s tasks yourself, and you are not blocked: carry on, and read status when you need it.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'status', 'stop', 'keep_going'] },
        team: { type: 'string', description: 'status, stop, keep_going: the team id (status without one lists your teams).' },
        title: { type: 'string', description: 'create: a short name, e.g. "Landing page".' },
        goal: { type: 'string', description: 'create: what the whole team delivers, in a sentence.' },
        context: { type: 'string', description: 'create: what every task needs from this conversation; specialists see nothing else.' },
        tasks: {
          type: 'array',
          description: 'create: 1–12 tasks. Independent tasks run at once; a task with `after` waits until those are done '
            + 'and starts with what they delivered (their results and the files they wrote).',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short id, e.g. "design" (default t1, t2…).' },
              title: { type: 'string', description: 'One short line for the board.' },
              agent: { type: 'string', description: 'The specialist\'s id from your prompt — or "work" for a work chat (the Orchestrator only).' },
              task: { type: 'string', description: 'The errand in full, for somebody who was not in this conversation.' },
              after: { type: 'array', items: { type: 'string' }, description: 'Ids of the tasks it needs finished first.' },
              done: { type: 'string', description: 'Its contract: "done when …", in a sentence.' },
              check: { type: 'object', description: 'Optional check the hub runs when it finishes: {file}, {file, contains}, {url}, {page, contains}, {absent}, {free: port}.' },
            },
            required: ['agent', 'task'],
          },
        },
        on: { type: 'boolean', description: 'keep_going: true to try failed tasks again, false to stop trying.' },
        keep_going: { type: 'boolean', description: 'create: start with keep going on.' },
        max_rounds: { type: 'integer', description: 'create: how many retries this team has (default the setting teams.maxRounds).' },
      },
      required: ['action'],
    },
    run: async (a, ctx = {}) => {
      const t = teams();
      if (!ctx.sessionId) return 'Error: a team is led by a conversation, and this call has none.';
      if (require('../../agents/missions').forSession(ctx.sessionId)) return 'Error: a specialist does not make or run teams; report to your leader.';
      const mine = id => { const team = t.get(id); if (!team || !require('../organization').canManage(ctx.sessionId, team.by)) throw Object.assign(new Error(`No team called "${id}" in your reporting line.`), { status: 404 }); return team; };
      try {
        if (a.action === 'create') {
          const team = await t.create(a, { by: ctx.sessionId, keepGoing: a.keep_going === true, maxRounds: a.max_rounds ?? null });
          const v = t.view(team);
          if (typeof ctx.show === 'function' && team.doc?.name) ctx.show({ name: team.doc.name, mime: 'text/markdown', kind: 'doc',
            bytes: Buffer.byteLength(require('../../teams/doc').render(team, v.tasks)), caption: `Team: ${team.title} — its board, written again at every change` });
          return `Team ${team.id} made — the hub runs it from here. ${said(v)}\nTell the person what you set going; you are not waiting.`;
        }
        if (a.action === 'status') {
          if (!a.team) {
            const rows = t.visible(null).filter(r => require('../organization').canManage(ctx.sessionId, r.by)).slice(0, 10);
            return rows.length ? rows.map(r => `${r.id} "${r.title}": ${r.state}${r.progress ? `, ${r.progress.done} of ${r.progress.total} done` : ''}`).join('\n') : 'No teams.';
          }
          return said(t.view(mine(a.team)));
        }
        if (a.action === 'stop') { mine(a.team); return `Stopped. ${said(await t.stop(a.team, { why: 'stopped by its leader' }))}`; }
        if (a.action === 'keep_going') { mine(a.team); return said(await t.keepGoing(a.team, a.on !== false)); }
        return 'Error: action is create, status, stop or keep_going.';
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
  {
    name: 'team_note',
    description: 'Post a short finding to your team\'s board for your teammates — a path, a decision, a pitfall they need; '
      + 'they read it in their next step as your words, and it goes into the team\'s document. Only on a team; at most 400 characters.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The finding, in a sentence or two.' } },
      required: ['text'],
    },
    run: ({ text }, ctx = {}) => {
      const m = require('../../agents/missions').forSession(ctx.sessionId);
      if (!m) return 'Error: team_note is for a specialist on a team, and this conversation is not a mission.';
      try {
        const row = teams().note(m.id, text);
        return `Noted for your team${row.cut ? ` (cut to ${teams().NOTE_MAX} characters)` : ''}. Carry on with your task.`;
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
];

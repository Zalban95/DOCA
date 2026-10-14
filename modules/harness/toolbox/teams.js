'use strict';

/**
 * Teams (modules/teams; docs/design/teams.md): `team` for a leader — the Orchestrator, a work chat, a person's chat —
 * and `team_note` for a specialist on a team. `team` is in registry.NEVER: a specialist never makes a team, as it
 * never dispatches. `team_note` is held only by a mission that belongs to a team (turn/tool-shape.js).
 */
const teams = () => require('../../teams');
const board = () => require('../../teams/board');

function said(v) {
  const t = v.tasks.map(x => `${x.id} ${x.title} (${x.agent}${x.missionId ? `, ${x.missionId}` : ''}): ${board().say(x)}${x.state === 'running' ? ` — ${x.percent}%` : ''}${x.place?.branch ? ` [worktree ${x.place.branch}]` : ''}`);
  return [`${v.id} "${v.title}"${v.project ? ` in the project ${v.project.name}` : ''}: ${v.state}, ${v.progress.done} of ${v.progress.total} tasks done (${v.progress.percent}%, every task counts the same)`
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
      + 'keep_going on tries failed tasks again until every contract holds or its rounds run out; merge merges a task\'s branch into '
      + 'the project\'s current branch. The Orchestrator and any conversation it leads make teams — a project\'s chats too, for their project; '
      + 'a conversation a project\'s chat made (level 3) makes none. You do not dispatch a team\'s tasks yourself, and you are not blocked: carry on, and read status when you need it. '
      + 'Only when the person names an outside harness in their request (Claude Code, Codex, dsh, Gemini CLI …) may a task\'s agent be '
      + '"harness:<id>" — with asked: true — and it then works in a computer of its own on a branch of the project.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'status', 'stop', 'keep_going', 'merge'] },
        asked: { type: 'boolean', description: 'create: true only when the person named the outside harness in their own words — "use Claude Code", "5 Claude on Opus", "with dsh". Never on your own initiative.' },
        task: { type: 'string', description: 'merge: the task whose branch goes into the project\'s current branch.' },
        team: { type: 'string', description: 'status, stop, keep_going: the team id (status without one lists your teams).' },
        title: { type: 'string', description: 'create: a short name, e.g. "Landing page".' },
        goal: { type: 'string', description: 'create: what the whole team delivers, in a sentence.' },
        context: { type: 'string', description: 'create: what every task needs from this conversation; specialists see nothing else.' },
        project: { type: 'string', description: 'create: the project it works on, by id or name (default: the one this conversation works in). Every task works in it — a task that changes files while another does gets a git worktree of its own (branch team/<title>/<task>) — and the team\'s document is one of its pages.' },
        tasks: {
          type: 'array',
          description: 'create: 1–12 tasks. Independent tasks run at once; a task with `after` waits until those are done '
            + 'and starts with what they delivered (their results and the files they wrote).',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short id, e.g. "design" (default t1, t2…).' },
              title: { type: 'string', description: 'One short line for the board.' },
              agent: { type: 'string', description: 'The specialist\'s id from your prompt — or "work" for a work chat (the Orchestrator and a project\'s chats only), or "harness:<catalog id>" (harness:claude, harness:codex, harness:dsh, harness:gemini) only when the person named that harness.' },
              model: { type: 'string', description: 'For a harness: that CLI\'s own model id, e.g. opus (dsh takes none).' },
              count: { type: 'integer', description: 'Several alike (1–8), e.g. 5 for "five Claude Code": made into tasks <id>-1 … <id>-N sharing the plan.' },
              task: { type: 'string', description: 'The errand in full, for somebody who was not in this conversation.' },
              after: { type: 'array', items: { type: 'string' }, description: 'Ids of the tasks it needs finished first.' },
              done: { type: 'string', description: 'Its contract: "done when …", in a sentence.' },
              check: { type: 'object', description: 'Optional check the hub runs when it finishes: {file}, {file, contains}, {url}, {page, contains}, {absent}, {free: port}.' },
              worktree: { type: 'boolean', description: 'In a project: true for a git worktree of its own, false to share the project\'s folder (default: its own when it changes files while another task of the team may too).' },
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
          const team = await t.create(a, { by: ctx.sessionId, keepGoing: a.keep_going === true, maxRounds: a.max_rounds ?? null,
            asked: a.asked === true && !!ctx.byPerson, person: ctx.user || null });   // an outside harness: only the person's own ask (teams/outside.js)
          const v = t.view(team);
          ctx.mention?.(require('../mentions').team(team));   // a chip in this transcript that opens its board (mentions.js)
          if (typeof ctx.show === 'function' && team.doc?.name) ctx.show({ name: team.doc.name, mime: 'text/markdown', kind: 'doc',
            bytes: Buffer.byteLength(require('../../teams/doc').render(team, v.tasks)), caption: `Team: ${team.title} — its board, written again at every change` });
          const manual = require('../manual-note').note(ctx.sessionId);
          return `Team ${team.id} made — the hub runs it from here. ${said(v)}\nTell the person what you set going; you are not waiting.${manual ? `\nSay this to them too, in your words:${manual}` : ''}`;
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
        if (a.action === 'merge') {
          const v = t.view(mine(a.team));
          const task = v.tasks.find(x => x.id === a.task);
          if (!task?.place?.branch || !v.project) return `Error: task ${a.task || '(none)'} of ${v.id} has no branch of its own to merge.`;
          const r = await require('../../harness-teams/branches').merge(v.project.root, task.place.branch, { by: 'the team\'s leader' });
          return `Merged ${r.merged} into ${r.into}: ${r.head}.`;
        }
        return 'Error: action is create, status, stop, keep_going or merge.';
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

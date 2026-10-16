'use strict';

/**
 * Who the Orchestrator is, and how it routes a request — said once, built from what the turn holds
 * (audit 2026-10-06, aw 1–2, 11–12, 26–27; TODO B1). CONSTITUTION V8: the panel chooses its tools, so the choice is
 * written as one table a small model can follow rather than spread over four blocks.
 */

/** The role: the person's main contact, which coordinates. Who it is in voice is the persona, not this. */
const ROLE = 'You are the Orchestrator: the person\'s main contact in this panel (level 1). You keep this '
  + 'conversation to goals, decisions, plans and results, and you stay free for the person while work runs. '
  + 'Work chats (level 2) carry jobs to the end on their own and may send specialists (level 3); you are woken '
  + 'when one reports its outcome or has a question for the person. Read their briefs and reports, not their '
  + 'transcripts; never claim work finished before its result arrives. Approving a plan starts its work in the '
  + 'conversation that proposed it. A message the person writes while you work reaches you before your next '
  + 'step: answer it briefly, then carry on or change course.';

/** The outside harnesses and their switches (harness-teams/harnesses.js mode): [{row, mode}], [] when unreadable. */
const outside = () => { try { const h = require('../harness-teams/harnesses'); return h.all().map(row => ({ row, mode: h.mode(row) })); } catch { return []; } };

/** A row per outside harness that says when it fits: offer it (ask) or start it (free). */
function fitting(team) {
  if (!team) return [];
  return outside().filter(x => x.row.team.when && x.mode !== 'never').map(({ row, mode }) => (mode === 'free'
    ? `${row.label} — ${row.team.when}. Its switch is "On its own": start it yourself, a \`team\` in the project with agent \`harness:${row.id}\` (no asked needed), `
      + 'each try in a computer of its own on this hub\'s model through the model relay, its branch back for the person; then say in one line that you started it and why.'
    : `${row.label} — ${row.team.when}. Offer it in one line, naming it and saying it runs in a computer of its own on this hub's model, through the relay. On their yes: `
      + `a \`team\` in the project with agent \`harness:${row.id}\` (count for parallel tries), asked: true — its branch and record come back for them.`));
}

/** Outside harnesses without a rule of their own whose switch is "On its own". */
function freeRow(team) {
  const free = team ? outside().filter(x => x.mode === 'free' && !x.row.team.when).map(x => `${x.row.label} (harness:${x.row.id})`) : [];
  return free.length ? [`Outside harnesses you may start yourself — their switch is "On its own": ${free.join(', ')}. For a coding task in a git project that one fits better than a work chat: `
    + 'a `team` with that agent (no asked needed), in computers of their own; then say in one line that you started it and why.'] : [];
}

/**
 * The routing table: the first row that fits wins. A row is there only when the turn holds what it names, so the
 * table never points at a tool the prompt does not have (aw 29).
 */
function routing({ held = new Set(), skills = 0, recipes = 0, specialists = [], workSteps = 3, free = false } = {}) {
  const has = n => held.has(n);
  const rows = [
    'Answer — you know it, or this prompt or memory says it. No tool.',
    'One tool — a single read or action whose result you need now: a file, a status, a setting'
      // 2026-10-08: asked to send files to Telegram, the agent wrote a script around the channel; this is the tool.
      + (has('tell_device') ? '. Files or a notice for their phone, watch or chat (Telegram, Matrix, Slack, mail) go with `tell_device`, never a script.' : '.')
      // 2026-10-10: with tools loaded on demand, a request whose tool was only named got a shell, a raw request or a promise.
      + ' A tool not loaded yet counts: Your tools lists each with its job — use the one made for the job rather than improvising'
      + (has('features') ? ', and look it up with `features` before saying something cannot be done.' : '.'),
    has('recipe') && recipes ? `A recipe — one of the ${recipes} saved recipes does exactly this: \`recipe\` run, no reasoning needed.` : '',
    has('skill') && skills ? 'A skill — a listed skill covers the task: `skill` read it, then follow it.' : '',
    // Outside harnesses with a "when it fits" rule (catalog `team.when`; asked 2026-10-16): offered on `ask`, started on `free`,
    // before a work chat would take the job. Each runs only in agents' computers; its switch is teams.outside.use.
    ...fitting(has('team')),
    has('work_chats') ? 'A work chat — anything with several steps (a build, a refactor, an install with checks, research): '
      + '`work_chats` create with the request, what is known and what done looks like; tell the person, and stay free.' : '',
    has('agent_dispatch') && specialists.length ? `A specialist — a self-contained errand one of them fits (${specialists.join(', ')}): \`agent_dispatch\`; `
      + 'it runs in the background and you read the result with `agent_results`. Send independent errands in parallel; one that needs another\'s result waits for it with `after`.' : '',
    has('team') && specialists.length ? 'A team — several errands for different specialists, some needing others\' results, each with a "done when": `team` create once, '
      + 'with every task, its `after` and its contract; the hub dispatches them in order, checks each contract and keeps the team\'s document. Stay free.' : '',
    has('team') && outside().some(r => r.mode !== 'never') ? 'A named outside harness — when the person names one in their request (Claude Code, Codex, dsh, Gemini CLI; "5 Claude on Opus"): a `team` '
      + 'in a project whose tasks\' agent is `harness:<id>` (model, count), with asked: true — each works in a computer of its own on a branch, and the branches come back for the person to merge. '
      + 'Never on your own initiative, except one whose switch is "On its own".' : '',
    ...freeRow(has('team')),
    'Ask — the choice is the person\'s (money, something outward or irreversible, a matter of taste): ask once, with the options.',
  ].filter(Boolean);
  // The premise's ladder (CONSTITUTION §0; TODO P0.2): the person's way, then the proven way, then a way found and kept.
  const keep = has('recipe') ? `After a way that nothing above covered has worked, keep it — \`recipe\` save_last${has('skill') ? ', or a skill' : ''} — so next time it is a recipe, not fresh reasoning`
    + (has('pack') && sharingOn() ? '; and `pack` save it, so the owner can offer it to the project.' : '.') : '';
  return ['# How to route a request', 'If the person said how to do it, do it their way. Otherwise take the first that fits:', ...rows.map((r, i) => `${i + 1}. ${r}`), keep,
    // Experiment alwaysFree (turn/route.js, turn/handoff.js): no work of its own, said as it is.
    free && has('work_chats') ? 'You do no real work in this conversation: a clear job goes to a work chat before you are asked, and your first call that is '
      + 'real work moves the job there by itself — except one quick visible action (a reminder, a device or home tool, a recipe of a step or two). Talk, look, '
      + 'apply what the person asked of the panel' + (has('background') ? ', and steer what runs with `background` — "also …" is `background add`, "skip …" `cancel`, "stop that" `stop`.' : '.')
    : has('work_chats') && workSteps > 0
      ? `After ${workSteps} steps of real work in your own turn — up to ${Math.max(workSteps, 6)} for a small request, ${Math.min(workSteps, 1)} for a large one — the job moves to a work chat by itself; hand it over before that.`
      : '',
  ].filter(Boolean).join('\n');
}

const sharingOn = () => { try { return require('../sharing').state().contribute; } catch { return false; } };

module.exports = { ROLE, routing };

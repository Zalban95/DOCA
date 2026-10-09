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

/**
 * The routing table: the first row that fits wins. A row is there only when the turn holds what it names, so the
 * table never points at a tool the prompt does not have (aw 29).
 */
function routing({ held = new Set(), skills = 0, recipes = 0, specialists = [], workSteps = 3 } = {}) {
  const has = n => held.has(n);
  const rows = [
    'Answer — you know it, or this prompt or memory says it. No tool.',
    'One tool — a single read or action whose result you need now: a file, a status, a setting'
      // 2026-10-08: asked to send files to Telegram, the agent wrote a script around the channel; this is the tool.
      + (has('tell_device') ? '. Files or a notice for their phone, watch or chat (Telegram, Matrix, Slack, mail) go with `tell_device`, never a script.' : '.'),
    has('recipe') && recipes ? `A recipe — one of the ${recipes} saved recipes does exactly this: \`recipe\` run, no reasoning needed.` : '',
    has('skill') && skills ? 'A skill — a listed skill covers the task: `skill` read it, then follow it.' : '',
    has('work_chats') ? 'A work chat — anything with several steps (a build, a refactor, an install with checks, research): '
      + '`work_chats` create with the request, what is known and what done looks like; tell the person, and stay free.' : '',
    has('agent_dispatch') && specialists.length ? `A specialist — a self-contained errand one of them fits (${specialists.join(', ')}): \`agent_dispatch\`; `
      + 'it runs in the background and you read the result with `agent_results`. Send independent errands in parallel; one that needs another\'s result waits for it with `after`.' : '',
    has('team') && specialists.length ? 'A team — several errands for different specialists, some needing others\' results, each with a "done when": `team` create once, '
      + 'with every task, its `after` and its contract; the hub dispatches them in order, checks each contract and keeps the team\'s document. Stay free.' : '',
    'Ask — the choice is the person\'s (money, something outward or irreversible, a matter of taste): ask once, with the options.',
  ].filter(Boolean);
  // The premise's ladder (CONSTITUTION §0; TODO P0.2): the person's way, then the proven way, then a way found and kept.
  const keep = has('recipe') ? `After a way that nothing above covered has worked, keep it — \`recipe\` save_last${has('skill') ? ', or a skill' : ''} — so next time it is a recipe, not fresh reasoning`
    + (has('pack') && sharingOn() ? '; and `pack` save it, so the owner can offer it to the project.' : '.') : '';
  return ['# How to route a request', 'If the person said how to do it, do it their way. Otherwise take the first that fits:', ...rows.map((r, i) => `${i + 1}. ${r}`), keep,
    has('work_chats') && workSteps > 0
      ? `After ${workSteps} steps of real work in your own turn the job moves to a work chat by itself; hand it over before that.`
      : '',
  ].filter(Boolean).join('\n');
}

const sharingOn = () => { try { return require('../sharing').state().contribute; } catch { return false; } };

module.exports = { ROLE, routing };

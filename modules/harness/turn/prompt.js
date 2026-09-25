'use strict';

/**
 * Prompt assembly: the system prompt a turn is sent with, built from
 * instructions, the live environment, memory, the client and the missions.
 */

const budget      = require('../budget');
const environment = require('../environment');
const memory      = require('../memory');
const providers   = require('../providers');
const approval    = require('../approval');
const settings    = require('../settings');
const installs    = require('../installs');
const tools       = require('../tools');

const { clientBlock, placeBlock } = require('./client');

// Required lazily inside the functions that use them: modules/agents requires
// the harness back, and a load-time cycle would leave one of the two half-built.
const agents   = { block: () => require('../../agents/registry').block() };
const missions = {
  block: opts => require('../../agents/missions').block(opts),
  notices: sessionId => require('../../agents/missions').notices(sessionId),
  acknowledgeNotices: shown => require('../../agents/missions').acknowledgeNotices(shown),
};

/* ── Prompt assembly ──────────────────────────────────── */

/**
 * Memory relevant to this turn: everything pinned, plus the best keyword
 * matches for what the user just said, up to `memoryLimit` entries and a
 * token budget. A high count cap must not dump the whole file.
 */
const MEMORY_BLOCK_CHARS = 8000;   // ~2k tokens; the rest stays behind memory_search

function memoryBlock(userText, limit) {
  const pinned = memory.memList().filter(e => e.pinned);
  const hits   = memory.memSearch(userText, limit);
  const seen   = new Set();
  const ranked = [...pinned, ...hits].filter(e => !seen.has(e.id) && seen.add(e.id)).slice(0, limit);
  if (!ranked.length) return '';

  // A fact the user settled and a fact something contradicted are both still
  // facts, and the agent has to be able to tell them from the ordinary ones:
  // one it may not overwrite, the other it may not lean on.
  const line = e => {
    const marks = [e.category ? `[${e.category}]` : '', e.locked ? '(locked)' : ''].filter(Boolean).join(' ');
    const head  = `- ${e.key}${marks ? ` ${marks}` : ''}: ${e.value}`;
    return e.disputed
      ? `${head}\n    ⚠ contradicted ${e.disputed.at.slice(0, 10)}: ${e.disputed.note} `
        + '— check this before relying on it, and correct it when you know better.'
      : head;
  };

  const chosen = [];
  let chars = 0;
  for (const e of ranked) {
    const text = line(e);
    if (chosen.length && chars + text.length > MEMORY_BLOCK_CHARS) break;
    chosen.push(e);
    chars += text.length;
  }
  memory.memTouch(hits.filter(e => chosen.includes(e)));

  return ['# What you remember', ...chosen.map(line),
    chosen.some(e => e.locked)
      ? 'Locked entries are the user\'s settled answers: dispute them with memory_flag if you find otherwise, '
        + 'but do not overwrite or work around them.'
      : '',
  ].filter(Boolean).join('\n');
}

/** The agent's own filing system, so it can follow it and change it. */
function rulesBlock() {
  const doc = memory.rules();
  return [
    '# How you keep your memory',
    'Categories:',
    ...doc.categories.map(c => `- ${c.id}${c.description ? `: ${c.description}` : ''}`),
    'Rules:',
    ...doc.rules.map(r => `- ${r}`),
    'These are yours to improve with memory_rules_write. The standing rules above are not.',
  ].join('\n');
}

/**
 * The whole system prompt, in the order it is read.
 *
 * The charter goes first and comes from code, so the panel's rules are the first
 * thing in context and the last thing anybody can edit away. `p.systemPrompt` —
 * which the user does own — follows it, then the facts, then what the agent
 * knows, then where this conversation had got to.
 */
function systemPrompt({ p, userText, summary, toolCount, disabledCount, client, profile }) {
  if (profile?.level === 'orchestrator') return [
    providers.SAFETY_CHARTER, profile.systemPrompt,
    p.coordinatorInstructions || providers.DEFAULT_SYSTEM_PROMPT,
    environmentBrief(p, toolCount), clientBlock(client), rulesBlock(),
    memoryBlock(userText, Math.min(3, Math.max(0, Number(p.memoryLimit) || 0))),
    settings.block(), installs.block(),
    summary ? `# Earlier decisions\n${summary}` : '',
  ].filter(Boolean).join('\n\n');
  // A specialist's prompt is mostly what is left out of it. The charter is not
  // one of those things: it goes first here exactly as it does for the
  // orchestrator, and a definition has no way to drop it.
  if (profile) {
    return [
      providers.SAFETY_CHARTER,
      profile.systemPrompt,
      clientBlock(client),
      `You are "${profile.label || profile.id}", working on one errand handed to you by the agent the `
        + 'user is talking to. You cannot change settings, install anything, or dispatch another agent. '
        + 'When you are done, answer with the result — that answer is the whole of what gets back. If '
        + 'something is in your way that only the user can clear, say so plainly and stop rather than '
        + 'working around it.',
      // A specialist always has `mission_plan`, whatever its definition lists,
      // and nothing here used to say so — so the plan stayed empty and every
      // client drew "STEP 0" until the mission was already over. The tool's own
      // description explains how; this is what makes it expected.
      'Say what you are going to do before you do it: call `mission_plan` once at the start with the '
        + 'few steps you intend to take, and tick each one as you finish it. Nobody is watching you work, '
        + 'so that list is the only thing a phone or a watch can draw while you are running.',
      profile.environment === 'full'
        ? environment.block({ provider: p.provider, model: p.model, toolCount, disabledCount })
        : environmentBrief(p, toolCount),
      profile.memory ? memoryBlock(userText, Math.max(0, Number(p.memoryLimit) || 0)) : '',
      summary ? `# Earlier in this mission\n${summary}` : '',
    ].filter(Boolean).join('\n\n');
  }

  return [
    providers.SAFETY_CHARTER,
    p.systemPrompt || providers.DEFAULT_SYSTEM_PROMPT,
    environment.block({ provider: p.provider, model: p.model, toolCount, disabledCount }),
    clientBlock(client),
    placeBlock(client),
    rulesBlock(),
    memoryBlock(userText, Math.max(0, Number(p.memoryLimit) || 0)),
    settings.block(),
    installs.block(),
    agents.block(),
    summary ? `# Earlier in this conversation\n${summary}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * The readings, sent after the history rather than inside the system prompt.
 *
 * Everything here changes between steps — the clock, the load, the running
 * ledger — and a provider's prefix cache stops at the first byte that differs.
 * With these inside the system prompt, the cacheable prefix was pinned at 1,152
 * tokens and never grew, so a four-step turn re-billed the entire transcript
 * four times (ISSUES.md H-9).
 *
 * Position is the whole fix; nothing was removed. Every fact the model was
 * given before it is given again, in the same words, as the last thing it
 * reads. What changed is that the head of the request — charter, system prompt,
 * environment facts, memory, limits, settings — is now byte-identical from step
 * to step, so the cached prefix grows with the transcript instead of being
 * truncated on the first line that moves.
 *
 * It is returned separately rather than appended here because the caller knows
 * where the history ends; this function does not.
 */
/**
 * Tools every specialist has, whatever its definition lists.
 *
 * A definition's `tools` is an allowlist, and `registry.NEVER` is subtracted
 * from it — so a tool that is "not forbidden" is still unreachable unless the
 * definition happens to name it. `mission_plan` was written on that assumption
 * and it was wrong: the `archivist` definition lists `memory_search` and
 * nothing else, so no specialist could tick its own plan, and a plan is
 * write-once (set by the orchestrator at dispatch) and stays all-`queued`
 * forever. The progress bar the plan exists to draw would never move.
 *
 * These are the tools that act on the *mission* rather than on the world.
 * Driving your own errand is not a capability a definition should have to opt
 * into any more than the charter is — see `registry.NEVER` for the other side
 * of the same list, and note that this one is asserted by a test that a
 * specialist really is offered it.
 */
const ALWAYS_FOR_SPECIALISTS = ['mission_plan', 'work_chats', 'work_plan'];

/**
 * A tool that another tool's guard sends you to, given with it. `write_file`
 * refuses a repository whose rules are unread and says "call repo_rules"; a
 * specialist allowed to write but not to read the rules would be told to use a
 * tool it does not have, and could not finish its errand at all.
 */
const COMES_WITH = { repo_rules: ['write_file'] };

/**
 * Which tools are off for this turn — one implementation, because there were
 * two and a fix belongs in both.
 *
 * That is not hypothetical: `mission_plan` was added to `turn()`'s copy and
 * `preview()` kept the old rule, so the prompt the panel shows and the prompt
 * the model gets would have disagreed about a tool. The whole point of
 * `preview()` is that it is what the tests assert against.
 */
function disabledFor(profile, p) {
  if (profile && Array.isArray(profile.tools))
    return tools.describe().map(t => t.name)
      .filter(n => (p.disabledTools || []).includes(n) ||
        (!profile.tools.includes(n) && !(profile.level !== 'orchestrator' && ALWAYS_FOR_SPECIALISTS.includes(n))
          && !(COMES_WITH[n] || []).some(t => profile.tools.includes(t))));
  return Array.isArray(p.disabledTools) ? p.disabledTools : [];
}

/**
 * Whether this turn is a mission rather than a level that owns missions.
 *
 * One implementation, for the reason `disabledFor` gives above: `turn()` sends
 * the mission block and `breakdown()` measures what was sent, so two copies of
 * this question would let the panel report a prompt the model never received.
 *
 * Mission state belongs to the levels that dispatch. A specialist is inside one
 * errand — it does not dispatch and cannot be a mission's `by`, while the
 * running/paused half of `missions.block()` is global, so for a narrow mission
 * that half is everybody's business rather than awareness.
 *
 * The Orchestrator owns missions and must be told about them, and it is the
 * profile's `level` that says so: `profileFor` synthesises an Orchestrator
 * profile, so a bare "has a profile" test — which is what this used to be —
 * excluded the one level that dispatches. Only the Orchestrator's profile
 * carries a level at all, because a specialist's is assembled from its
 * definition (`agents/missions.js` `profileOf`).
 */
function isMissionProfile(profile) {
  return !!profile && profile.level !== 'orchestrator';
}

/**
 * The mission block for a conversation, or `''` when it is not told about
 * missions at all.
 *
 * The three callers — the turn that sends it, the reading that measures it and
 * the panel that shows the user what was sent — all come through here, because
 * the one thing worse than a prompt the user cannot see is a panel confidently
 * describing a prompt that was never built.
 */
function missionsFor(sessionId) {
  const session = sessionId ? require('../organization').session(sessionId) : null;
  if (!session || isMissionProfile(require('../organization').profileFor(session))) return '';
  return missions.block({ sessionId: session.id });
}

function liveBlock(p, ledger) {
  return [
    environment.live(),
    budget.live(ledger, p),
    // Last-position, like every other reading: the allowlist changes mid-turn
    // the moment the user answers "always allow", so it cannot sit in the
    // cached prefix ahead of the transcript (H-9).
    approval.block(),
  ].filter(Boolean).join('\n\n');
}

/**
 * The environment, for something that only needs to know where it is standing.
 *
 * The full block lists every managed path, every provider and every MCP server,
 * which is right for an agent that might use any of them and is pure cost for
 * one with four tools. Rebuilt per step like everything else, so the saving is
 * per step too.
 *
 * The clock is not here: it belongs to `liveBlock()`, which is sent after the
 * history. A `now:` line in this brief would put a changing byte ahead of the
 * transcript for specialists exactly as it did for the orchestrator (H-9).
 */
function environmentBrief(p, toolCount) {
  const s = environment.snapshot();
  return ['# Where you are',
    `host: ${s.host.hostname} (${s.host.platform}), user ${s.host.user}, home ${s.host.home}`,
    `running on: ${p.provider} / ${p.model || '(model unset)'}${toolCount ? `, ${toolCount} tools` : ''}`,
    `workspace: ${(s.paths.find(x => x.key === 'WORKSPACE_DIR') || {}).value || '(unset)'}`,
  ].join('\n');
}

// A tool result is the same string every time it is sent.
//
// It used to be decided per call instead: walk backward from the newest result,
// keeping rows whole until 12,000 characters were spent, clipping the rest, and
// always keeping the newest whole whatever its size. So a result travelled
// verbatim on the step that produced it and became a head, a tail and a spill
// path on the next — the message array was not append-only, and a provider's
// prefix cache stops at the first byte that differs.
//
// The cost was not a small tail. The break anchored at the *oldest* result to
// change, and that result sits immediately after the system prompt, so the
// cacheable prefix was cut back to roughly the system prompt and the whole
// transcript was re-billed on every step for the rest of the turn. Measured on
// a four-step turn with large outputs: 52-60% cached against ~95% ideal, with
// the cached count growing ~640 tokens a step while the prompt grew by 12,000
// (ISSUES.md H-9b).
//
// The rule is now a function of the row alone — its length and its content —
// so a row's serialization cannot change once it has been sent. The cap is per
// row rather than shared across rows, which makes the prompt *larger* than the
// old budget did. That is deliberate and it is the whole trade: at ~95% cached
// the billed total is far smaller even though the prompt is bigger, because
// what is billed is the miss, not the prompt.
//
// The transcript on disk is not touched — this is only what the next call sees.

module.exports = { memoryBlock, rulesBlock, systemPrompt, disabledFor, isMissionProfile, missionsFor, liveBlock };

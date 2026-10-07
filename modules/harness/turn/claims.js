'use strict';

/**
 * An answer that claims an action the turn never made (experiment `claimCheck`, docs/experiments/claim-check.md;
 * TODO B7c). Measured 2026-10-07: DeepSeek answered "Written to memory as router-ip" without calling memory_write —
 * the charter says never to claim a result not seen, and saying so did not stop it. So, when a turn's final answer
 * says it saved a memory, set a reminder, proposed a setting, committed, pushed or sent something to a device, and no
 * call this turn could have done that, the turn gets one more step: a note from DOCA (not the person) naming the claim
 * and the tools that would have made it — do it now, or say it was not done. Once per turn; a heuristic, so behind a
 * flag until the routing set says it helps more than it costs.
 */

// Each claim: what an answer says, and the calls any one of which would make it true.
const CLAIMS = [
  { what: 'a memory saved', says: /\b(saved|written|wrote|stored|noted|added|recorded|put)\b[^.\n]{0,40}\bmemor(y|ies)\b|\bI(?:'ll| will) remember\b|\bremembered (that|it)\b/i, by: ['memory_write', 'memory_rules_write'] },
  { what: 'a reminder or schedule set', says: /\b(reminder (is )?(set|created|scheduled)|I(?:'ll| will) remind you|scheduled (it|this|that|a)\b)/i, by: ['remind', 'schedule', 'recipe'] },
  { what: 'a setting proposed or changed', says: /\b(proposed|suggested)\b[^.\n]{0,30}\b(setting|change)s?\b|\bsetting (is )?(now )?(changed|updated|set)\b/i, by: ['settings_propose', 'panel_layout', 'form_fill'] },
  { what: 'an install proposed', says: /\binstall(ation)? (is )?(proposed|queued|requested)\b|\bproposed (installing|an install)\b/i, by: ['install_propose', 'hub_command'] },
  { what: 'a commit or a push', says: /\b(I )?(committed|pushed)\b[^.\n]{0,30}\b(change|commit|branch|it|them)\b/i, by: ['git', 'shell', 'project'] },
  { what: 'a message sent to a device', says: /\b(sent|pushed|notified)\b[^.\n]{0,30}\b(your )?(phone|watch|device|notification)\b/i, by: ['tell_device', 'ask_device'] },
];

const on = () => require('../../experiments').on('claimCheck');

/** The tool names this turn called (rows written since `from`), MCP tools by their exposed name. */
function calledSince(rows, from) {
  const out = new Set();
  for (const r of rows.slice(from)) for (const c of r.tool_calls || []) if (c.function?.name) out.add(c.function.name);
  return out;
}

/**
 * The first claim in `text` no call made, or null. `held` (names) keeps it to claims the turn could have made true:
 * an answer saying "I'll remember" in a turn without memory_write is a sentence about a limit, not a missing call.
 */
function unmade(text, called, held = null) {
  for (const c of CLAIMS) {
    if (!c.says.test(String(text || ''))) continue;
    if (c.by.some(n => called.has(n))) continue;
    if (held && !c.by.some(n => held.has(n))) continue;
    return c;
  }
  return null;
}

/** The note the next step reads. */
function note(c) {
  return `[DOCA] Your answer says ${c.what}, but nothing this turn did that — no call to ${c.by.join(' or ')}. `
    + 'Do it now, or tell the person plainly that it was not done. Do not say it was done.';
}

/** For agent.js: the note to continue with, or null when the answer stands (flag off, nothing claimed, or already asked). */
function check({ text, rows, from, held, asked }) {
  if (asked || !on()) return null;
  const c = unmade(text, calledSince(rows, from), held);
  return c ? { claim: c.what, note: note(c) } : null;
}

module.exports = { CLAIMS, unmade, calledSince, note, check };

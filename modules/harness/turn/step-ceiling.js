'use strict';

/**
 * Lean context per step: a ceiling on what one step sends, independent of the model's window (owner's green light
 * 2026-10-16; AGENTS.md "Lean context per step").
 *
 * Measured on one design task (a printable mount, drawings, a video): DOCA on DeepSeek sent ~180k tokens a step on
 * average and grew to 277k inside one turn, where Claude Code doing the same task sent ~73k. The folds and the clearing
 * existed, but both fired against the window (1M) or `compactTokens` — which an install may well set high — so they
 * never came. A large prompt is a bill on every step and a weaker model reasoning over noise.
 *
 * So, before each step: when the request about to go out is estimated over `stepTokens`, it is shortened down to
 * LOW (60%) of it — hysteresis, so the next trip and its cache break are many steps away:
 *   1. old tool results (and long arguments of old calls) are cleared from what is sent (clear-results.js) — the
 *      newest three and everything this step returned stay whole, and every stub names the file holding the result;
 *   2. still over, the earlier turns fold into the summary (memory.pendingFold, force) — never the turn in progress,
 *      never between a call and its result.
 * What the agent saw the first time is never shortened; only what is re-sent is, and nothing is lost. Said with the
 * `compacted` event (setting `stepTokens`), or once a turn as a warning when nothing more can go.
 *
 * `stepTokens` 0 is the old behaviour: no ceiling. `resultChars` 0 keeps the old result clip (16000, every step).
 */

const memory = require('../memory');
const budget = require('../budget');
const clear  = require('./clear-results');
const { foldSummary } = require('./summary');

/** Where a trip shortens down to, as a share of the ceiling: a fixed ratio, so there is one setting to explain. */
const LOW = 0.6;

const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** The ceiling in tokens, or 0 when off. */
function ceilingFor(p) { return num(p?.stepTokens); }

/** Characters a re-sent tool result keeps (head + tail), or undefined for the old rule (messages.js). */
function resendChars(p) { return num(p?.resultChars) || undefined; }

/**
 * The request's size, the text estimate corrected by how far the last step's estimate was from what the provider
 * counted (bounded, so one odd reading cannot make it fire or never fire).
 */
function sizeOf(messages, schemas, led) {
  const est = budget.estimateRequest({ messages, tools: schemas });
  const ratio = led?.lastPrompt > 0 && led?.lastEstimate > 0 ? Math.min(2, Math.max(0.5, led.lastPrompt / led.lastEstimate)) : 1;
  return Math.round(est * ratio);
}

/**
 * The step's request, under the ceiling when it can be. `build(summary)` makes the request (step-request.js).
 * @returns {{ req, summary }}
 */
async function fit({ p, ep, session, signal, say = () => {}, step, led, schemas, summary, build }) {
  let req = build(summary);
  const at = ceilingFor(p);
  if (!at) return { req, summary };
  let size = sizeOf(req.messages, schemas, led);
  if (size < at) return { req, summary };
  const before = size;
  // Hysteresis: once tripped, shorten down to LOW of the ceiling — clearing takes every old result but the newest three
  // at once, and the fold runs while the request is still over the target, not just over the ceiling — so the next
  // trip, and the cache break it costs, is many steps away (lean-bench: one trip in a 45-step replay).
  const target = Math.floor(at * LOW);
  const cleared = clear.clearOld(session.id);
  if (cleared) { req = build(summary); size = sizeOf(req.messages, schemas, led); }
  let folded = false;
  if (size > target && !p.compactOff) {   // a chat set to fold nothing early (compact-choice.js) is only cleared
    const s = await foldSummary({ session: memory.getSession(session.id), p, ep, signal, force: true });
    if (s !== summary) { summary = s; folded = true; req = build(summary); size = sizeOf(req.messages, schemas, led); }
  }
  if (cleared || folded) {
    say({ type: 'compacted', at: step, contextTokens: before, after: size, contextWindow: budget.windowFor(p) || null,
      setting: 'stepTokens', threshold: at, target, ...(cleared ? { cleared } : {}), ...(folded ? { folded: true } : {}) });
  }
  if (size >= at && led && !led.ceilingWarned) {
    led.ceilingWarned = true;
    say({ type: 'warning', step, kind: 'step-ceiling', tokens: size, threshold: at,
      text: `This step's request is about ${size} tokens, over harness.config.doca.stepTokens (${at}); nothing more can be `
        + 'left out without cutting into this turn\'s newest work, so it is sent as it is.' });
  }
  return { req, summary };
}

/** What is left out of a step's request, and how to read it back: the agent's `# Your limits` (budget.block). */
function lines(p) {
  const at = ceilingFor(p);
  const chars = resendChars(p);
  return [
    at ? `per-step ceiling: ${at} tokens a request (harness.config.doca.stepTokens) — over it, what is sent is shortened `
      + `down to ${Math.round(LOW * 100)}% of it: older tool results are cleared first, then `
      + `earlier turns fold into the summary; never results you have not read yet nor the turn's request`
      : 'per-step ceiling: off (harness.config.doca.stepTokens is 0)',
    `tool results: ${chars ? `sent whole on the step they arrive, then as head + tail (${chars} characters; read_file `
      + `results ${Math.max(chars, require('./messages').TOOL_MAX_CHARS)}) on later steps (harness.config.doca.resultChars)`
      : `over ${require('./messages').TOOL_MAX_CHARS} characters sent as head + tail on every step`}. `
      + `Under pressure, results over ${clear.MIN_CHARS} characters except your newest ${clear.KEEP} are cleared from what you are sent, `
      + 'and long arguments of old calls too. Nothing is lost: each shortened result names the file holding all of it — '
      + 'read_file that path (offset, maxLength) rather than running the tool again',
  ];
}

module.exports = { fit, ceilingFor, resendChars, sizeOf, lines, LOW };

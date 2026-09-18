'use strict';

/**
 * "Can this model call tools?"
 *
 * A fallback that answers in prose is not a fallback for an agent. When the
 * primary model goes quiet and the chain hands the turn to a rung that cannot
 * call tools, the turn does not fail loudly — it produces an assistant message
 * that talks about running a command instead of running it. That is worse than
 * no fallback, and nothing in `/models` says which models are like that:
 * `providers.js` is explicit that capability is not discoverable from a model
 * list, so the only way to know is to ask the model.
 *
 * So this is one cheap question with a tool in it. Two attempts, because the
 * two ways a model can fail this are different things:
 *
 *   - It answers in prose when tools are available → not proof it *cannot*.
 *     Many models chat about the tool instead of calling it. So ask again with
 *     the call required, and only a second prose answer is a verdict.
 *   - It errors on a request that contains `tools` at all → that is a verdict
 *     too, and the provider said so itself.
 *
 * Everything else — a rejected key, a wrong address, a provider that goes
 * quiet — is **not** a verdict about tool calling, and reporting it as one
 * would slander a model this never reached. Those come back `null` with the
 * same sentence a failed turn would have shown (`budget.explain`).
 *
 * The call goes through `agent.complete`, so it is an ordinary request to the
 * provider with the same headers and the same 400-retries as a real turn, and
 * it lands in the usage ledger under `kind: 'probe'` — a setting that spends
 * money should be visible in the place that counts it.
 */
const providers = require('./providers');
const agent     = require('./agent');

/* ── The question ─────────────────────────────────────── */

// Deliberately the smallest useful tool: one string in, nothing out. A probe
// that asked the model to do something with a real tool would be measuring the
// model's judgement, and the question here is only the transport.
const PROBE_TOOL = {
  type: 'function',
  function: {
    name: 'doca_probe',
    description: 'Report a word back unchanged. Call this when asked to.',
    parameters: {
      type: 'object',
      properties: { word: { type: 'string', description: 'The word to report.' } },
      required: ['word'],
    },
  },
};

const PROBE_SYSTEM = 'You are being checked for tool-calling support. When a tool is available, '
  + 'call it. Do not reply in prose.';
const PROBE_USER = 'Call doca_probe with the word "ok".';

/**
 * The longest a probe will wait for a first token.
 *
 * A turn's deadline is the user's and can be minutes; this one is a settings
 * box someone is looking at. A check that hangs for ninety seconds is worse
 * than one that says it could not tell — and "could not tell" is a real answer
 * here, so waiting longer buys nothing.
 */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * The whole check, both attempts, will not outlive this.
 *
 * The first-token deadline above covers a provider that says nothing. This one
 * covers the other shape: a provider that answers, so the deadline is disarmed,
 * and then never finishes the body. A probe is still something a user is
 * waiting on, so it ends either way.
 */
const PROBE_BUDGET_MS = 45_000;

/**
 * An abort signal that fires on the caller's abort or on our own deadline,
 * whichever comes first.
 *
 * `AbortSignal.any` would say this in one line, but it landed in Node 20.3 and
 * `package.json` promises 18. The reason is carried through as an `Error`
 * rather than a bare abort so that the message the user ends up reading is the
 * sentence below rather than "This operation was aborted".
 */
function budgetSignal(outer) {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error(`The tool check on ${PROBE_BUDGET_MS / 1000} s was still waiting for an answer.`)),
    PROBE_BUDGET_MS);
  timer.unref?.();

  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true });
  }
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return ctrl.signal;
}

/**
 * The harness settings, with the two that would make this answer a different
 * question than the one it was asked.
 *
 * - **One rung.** A probe is about the model in the box on screen. Falling down
 *   the configured chain from here would test a model the user did not ask
 *   about and report the result under this rung's name.
 * - **A short deadline.** See above.
 */
function probeParams(p) {
  return {
    ...(p || {}),
    fallbackChain: [],
    firstTokenTimeoutMs: Math.min(Number(p?.firstTokenTimeoutMs) || PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS),
  };
}

/**
 * One request with a tool in it.
 * @param {boolean} force  require the call instead of merely offering the tool
 */
function attempt({ ep, model, p, force, signal }) {
  return agent.complete({
    ep,
    p,
    signal,
    meta: { kind: 'probe' },
    body: {
      model,
      stream: false,
      temperature: 0,
      max_tokens: 64,
      messages: [
        { role: 'system', content: PROBE_SYSTEM },
        { role: 'user',   content: PROBE_USER },
      ],
      tools: [PROBE_TOOL],
      tool_choice: force
        ? { type: 'function', function: { name: 'doca_probe' } }
        : 'auto',
    },
  });
}

/* ── Reading the answer ───────────────────────────────── */

/**
 * The provider's own words out of a `budget.explain` sentence.
 *
 * `explain` returns prose with the vendor's text quoted at the end — and the
 * prose itself names the provider, which a provider id is not guaranteed not to
 * contain the word "tool" in. The classification below reads the vendor's text
 * only, so that a provider called `tools-r-us` with a bad key cannot be mistaken
 * for a model that refused `tools`.
 */
function vendorSaid(message) {
  const m = /[\s\S]*?\bsaid:\s*([\s\S]*)$/.exec(String(message || ''));
  return m ? m[1] : String(message || '');
}

/** Does this refusal mean "no tools here"? The provider's words, not ours. */
const TOOL_REFUSAL = /\btools?\b|tool_choice|function[_ ]?call/i;

/* ── The check ────────────────────────────────────────── */

/**
 * Ask a provider's model whether it will call a tool.
 *
 * @param {{provider?: string, model?: string, signal?: AbortSignal}} opts
 * @returns {Promise<{ supported: boolean|null, detail: string, attempts: string[] }>}
 *   `true`  — it called the tool.
 *   `false` — it answered prose twice, or refused the request because of `tools`.
 *   `null`  — the question could not be put to it. The detail says why.
 */
async function check({ provider, model, signal } = {}) {
  const id    = String(provider || '').trim();
  const name  = String(model || '').trim();
  const no    = (detail) => ({ supported: null, detail, attempts: [] });

  if (!id) return no('No provider is chosen for this rung.');
  if (!name) return no('No model is chosen for this rung — there is nothing to check yet.');

  let ep;
  try { ep = providers.endpoint(id); }
  catch (e) { return no(e.message); }

  const p        = probeParams(agent.params());
  const stop     = budgetSignal(signal);
  const attempts = [];

  for (const force of [false, true]) {
    let reply;
    try {
      reply = await attempt({ ep, model: name, p, force, signal: stop });
    } catch (e) {
      // The provider refused the request itself. If it named `tools`, that is
      // the answer to the question and it is a no; anything else is the check
      // failing to reach the model, which is not a fact about the model.
      const said = vendorSaid(e.message);
      if (!e.stalled && TOOL_REFUSAL.test(said)) {
        return { supported: false, detail: `the provider refused a request carrying tools — ${said.trim()}`.slice(0, 600), attempts };
      }
      return { supported: null, detail: e.message, attempts };
    }

    attempts.push(force ? 'forced' : 'auto');
    if ((reply.tool_calls || []).length) {
      return {
        supported: true,
        detail: force
          ? 'it only calls a tool when the call is required, so a turn has to insist'
          : 'it called the tool as soon as one was offered',
        attempts,
      };
    }
  }

  return {
    supported: false,
    detail: 'it answered in prose when the tool was offered, and again when the call was required',
    attempts,
  };
}

module.exports = { check, PROBE_TOOL, PROBE_TIMEOUT_MS };

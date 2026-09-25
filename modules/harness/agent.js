'use strict';

/**
 * The built-in harness: one agent turn, from a user message to a final answer.
 *
 * Per turn it assembles the system prompt (instructions + live environment +
 * relevant durable memory + the rolling summary of this conversation), streams
 * the model's reply, and keeps running tools and feeding their output back in
 * until the model answers without asking for another one — capped by `maxSteps`
 * so a confused model cannot loop forever.
 *
 * Every message, tool call and tool result is appended to the session
 * transcript, so a reload or a restart resumes exactly where it left off.
 */


const budget      = require('./budget');
const memory      = require('./memory');
const providers   = require('./providers');
const approval    = require('./approval');
const settings    = require('./settings');
const attachments = require('../attachments');
const tools       = require('./tools');
// Required lazily inside the functions that use them: modules/agents requires
// this file back, and a load-time cycle would leave one of the two half-built.
const missions = {
  block: opts => require('../agents/missions').block(opts),
  notices: sessionId => require('../agents/missions').notices(sessionId),
  acknowledgeNotices: shown => require('../agents/missions').acknowledgeNotices(shown),
};

// The turn's parts, one idea per file under ./turn. This file runs the turn;
// the rest is imported, and re-exported where other modules already use it.
const { params, turnParams } = require('./turn/params');
const { disabledFor, isMissionProfile, liveBlock, missionsFor, systemPrompt } = require('./turn/prompt');
const { toApiMessages } = require('./turn/messages');
const { DEGRADED_MS, rungsFor, markDegraded, forgetDegraded, openingHop, hopText } = require('./turn/fallback');
const { ask, complete } = require('./turn/transport');
const { foldSummary } = require('./turn/summary');
const { preview, breakdown, contextOf, status } = require('./turn/introspect');
const { events, running, isRunning, cancel, changed } = require('./turn/lifecycle');

/* ── The turn ─────────────────────────────────────────── */

/**
 * Run one turn of the built-in harness.
 *
 * @param {{ message: string, sessionId?: string, emit: (evt: object) => void, signal?: AbortSignal,
 *           client?: { id?: string, name: string, kind?: string, label?: string, formFactor?: string,
 *                      screen?: object, input?: object } }} opts
 * @returns {Promise<{ sessionId: string, text: string, steps: number }>}
 */
async function turn(options) {
  const organization = require('./organization');
  const id = options.sessionId || memory.activeSession().id;
  const session = organization.session(id);
  if (session.archivedAt) throw Object.assign(new Error('Recall this archived conversation before continuing.'), { status: 409 });
  if (running.has(id)) throw Object.assign(new Error('A turn is already running in this conversation.'), { status: 409 });
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) ctrl.abort();
  running.set(id, ctrl);
  try {
    const profile = session.kind === 'specialist' ? session.profile || options.profile
      : options.profile || organization.profileFor(session);
    if (profile && session.kind === 'specialist') {
      profile.tools = (profile.tools || []).filter(n => !require('../agents/registry').NEVER.includes(n));
    }
    memory.updateSession(id, { state: 'running', lastError: null });
    changed(id);
    if (options.client && options.client.kind !== 'agent')
      organization.report(id, 'user intervention', options.message, options.client.name || 'user');
    const result = await runTurn({ ...options, sessionId: id, signal: ctrl.signal, profile });
    const state = ctrl.signal.aborted ? 'cancelled' : 'idle';
    memory.updateSession(id, { state, brief: String(result.text || '').slice(0, 600) });
    organization.report(id, state === 'cancelled' ? state : 'turn completed', result.text);
    return result;
  } catch (e) {
    const state = ctrl.signal.aborted ? 'cancelled' : 'failed';
    memory.updateSession(id, { state, lastError: String(e.message).slice(0, 600) });
    organization.report(id, state, e.message);
    throw e;
  } finally {
    running.delete(id);
    changed(id);
    options.signal?.removeEventListener('abort', abort);
  }
}


async function runTurn({ message, sessionId, emit, signal, client, attachments: attached, profile }) {
  const say = evt => {
    try { emit(evt); } catch {}
    try { events.emit('event', evt); } catch {}
  };
  const p = turnParams(profile);
  const ep  = providers.endpoint(p.provider);
  if (!p.model)
    throw Object.assign(new Error(
      'No model chosen for the DOCA harness — pick one with ⚙ on the harness row in Controls.'), { status: 400 });

  const session = sessionId ? memory.getSession(sessionId) : memory.activeSession();
  if (!session) throw Object.assign(new Error('Unknown session'), { status: 404 });
  say({ type: 'session', sessionId: session.id });

  // Provenance stays on the row, not in the text: `toApiMessages` maps the
  // fields the API takes, so a client can render "you asked this from the watch"
  // without the model ever seeing a tag glued to the user's own words.
  const files = attachments.resolve(attached || []);
  memory.append(session.id, {
    role: 'user', content: message,
    ...(files.length ? { attachments: files } : {}),
    ...(client ? { from: { id: client.id || null, name: client.name, formFactor: client.formFactor || client.kind || null } } : {}),
  });

  let summary = await foldSummary({ session: memory.getSession(session.id), p, ep, signal });
  // An allowlist is expressed as its complement, because `schemas()` filters by
  // what is switched off and there is no second mechanism worth adding. A
  // profile with no list gets the user's ordinary disabled-tools setting.
  const disabled = disabledFor(profile, p);

  const base = {
    model:       p.model,
    stream:      true,
    temperature: Number(p.temperature),
    top_p:       Number(p.topP),
    // Ask for the usage frame. Providers that do not know the field have it
    // stripped and retried once in `post()`, so the ledger degrades to estimates
    // rather than the turn failing.
    stream_options: { include_usage: true },
    ...(Number(p.maxTokens) > 0 ? { max_tokens: Number(p.maxTokens) } : {}),
  };

  const maxSteps = Math.max(1, Number(p.maxSteps) || 1);
  const led      = budget.ledger();
  let warned     = false;
  let text = '';

  // Proposals already waiting when the turn started are on screen already; only
  // the ones this turn creates need announcing.
  const announced = new Set(settings.list().pending.map(x => x.id));

  let toolCount = null;
  // Every hop this turn made, so the answer can be told apart from one the
  // chosen model gave. The event announces it while it happens; this is for the
  // surfaces that only ever see the outcome — a device that was asleep, a log
  // read tomorrow — and would otherwise read the backup's words as the primary's.
  const fallbacks = [];
  const contextSkips = new Map();

  for (let step = 1; step <= maxSteps; step++) {
    // Rebuilt every step, not once per turn.
    //
    // Only running MCP servers contribute tools, and a turn is exactly when a
    // server starts — the agent asks a client to start its listener, or starts
    // one itself, and then cannot use what it just started until the next turn.
    // Faced with that, the agent does not wait: it writes a script and speaks
    // JSON-RPC to the listener through `shell`, which works, is reasonable, and
    // routes around the tool layer along with every switch and label on it.
    // Three separate turns did this before anyone noticed. Recomputing the list
    // is an in-process registry read, so the honest path is now also the cheap
    // one.
    const stepDisabled = disabledFor(profile, p);
    const schemas = tools.schemas(stepDisabled);
    if (toolCount !== null && schemas.length !== toolCount)
      say({ type: 'tools', count: schemas.length, was: toolCount, step });
    toolCount = schemas.length;

    const { rows } = memory.window(session.id, Number(p.historyTurns) || 0);
    const messages = [
      {
        role: 'system',
        content: systemPrompt({
          p, userText: message, summary, client, profile,
          toolCount: schemas.length, disabledCount: disabled.length,
        }),
      },
      // `provider` is the one this request is addressed to, which decides which
      // echoes travel — see `toApiMessages`.
      ...toApiMessages(rows, { sessionId: session.id, provider: ep.id }),
    ];

    // The readings go last, after the history. Everything above is now
    // byte-identical from one step to the next, so the cached prefix grows with
    // the transcript instead of being cut off at the first line that moves —
    // and a per-step line inside the system prompt is exactly what did the
    // cutting (ISSUES.md H-9). Not persisted: this is this step's reading, and
    // the next step generates its own.
    // Sent as `user`, not as a second `system`. A chat template is entitled to
    // refuse a system message that is not the first one, and Qwen's does:
    // llama.cpp with `--jinja` answers `500 Jinja Exception: System message must
    // be at the beginning`, which killed every llamacpp-served turn on its first
    // step from the moment the readings moved down here (H-9). The position is
    // what H-9 was protecting, not the role, so the cached prefix is unaffected.
    // It says whose words these are, because a bare block at the end of a
    // conversation reads as the user's.
    const isMission = isMissionProfile(profile);
    const completed = isMission ? [] : missions.notices(session.id);
    const organization = require('./organization');
    const reports = organization.notices(session.id).slice(0, 10);
    const live = [liveBlock(p, led), isMission ? '' : missions.block({ sessionId: session.id, completed }),
      organization.block(session.id, reports),
      ...contextSkips.values()].filter(Boolean).join('\n');
    if (live) messages.push({ role: 'user', content: `[panel readings, not from the user]\n${live}` });

    // Measured when the provider answers with a usage frame, estimated when it
    // does not. Both are recorded; only one is called a measurement.
    const promptEstimate = budget.estimateRequest({ messages, tools: schemas });

    // Model time for this step, which is what a tokens-per-second figure is
    // about. Measured around the call and nothing else: the tool that runs
    // after it belongs to the machine, not to the model's speed.
    const startedAt = Date.now();
    const reply = await complete({
      ep, signal, p, meta: { kind: 'step', sessionId: session.id, agent: profile?.id },
      body: { ...base, messages, ...(schemas.length ? { tools: schemas, tool_choice: 'auto' } : {}) },
      onText: t => { text += t; say({ type: 'text', text: t }); },
      onThinking: t => say({ type: 'thinking', text: t }),
      // Silence is a state worth drawing. Without this the console shows the
      // session line and then nothing at all, which reads as a broken panel
      // rather than as a provider that has not started answering.
      onWaiting: w => say({ type: 'waiting', step, provider: ep.label || ep.id, ...w }),
      onSkip: skipped => {
        contextSkips.set(`${skipped.provider}/${skipped.model}`, skipped.text);
        say({ type: 'warning', step, kind: 'context-preflight', text: skipped.text });
      },
      // Announced, never quiet. A fallback that happens silently is a worse bug
      // than the outage it hides: the user reads a smaller model's answers as
      // the big one's, and the next investigation starts from a false premise.
      // So this reaches the chat as its own row and the log at warn, naming
      // what stalled, for how long, and what is answering instead — including
      // the hop a turn makes before its first token, when the model the
      // settings name was passed over for one that stalled a moment ago
      // (`openingHop`).
      onHop: h => {
        fallbacks.push({
          step, from: h.from.provider, fromModel: h.from.model,
          to: h.to.provider, toModel: h.to.model, seconds: h.seconds,
        });
        say({
          type: 'failover', step,
          from: h.from.label || h.from.provider, to: h.to.label || h.to.provider,
          fromModel: h.from.model, toModel: h.to.model,
          seconds: h.seconds, frames: h.frames, remaining: h.remaining,
          text: hopText(h),
        });
      },
    });
    const stepMs = Date.now() - startedAt;

    if (!isMission) missions.acknowledgeNotices(completed);
    organization.acknowledge(session.id, reports);
    budget.record(led, {
      usage: reply.usage,
      promptEstimate,
      completionEstimate: budget.estimate(reply.content) + budget.estimate(JSON.stringify(reply.tool_calls || [])),
      ms: stepMs,
    });
    const spend = budget.report(led, p);
    say({ type: 'usage', step, ...spend });

    memory.append(session.id, {
      role: 'assistant',
      content: reply.content || '',
      ...(reply.tool_calls.length ? { tool_calls: reply.tool_calls } : {}),
      // What the provider thought, kept beside what it said, because the
      // provider that sent it asks for it back on every later request in this
      // conversation and refuses the turn without it (ISSUES.md H-10). Filed
      // under the rung that answered rather than the one that was asked: after
      // a hop those differ, and the field is the fallback's, not the primary's.
      // The panel reads `content` and ignores this; the browser is sent the row
      // as stored, so it is downloadable with the rest of the transcript.
      ...(reply.reasoning ? { reasoning: { provider: reply.provider || ep.id, text: reply.reasoning } } : {}),
      usage: { tokens: spend.totalTokens, prompt: led.lastPrompt, source: spend.source },
    });

    // Advisory, once per turn, to the user and to the agent. The hard stop
    // belongs to the provider; this is the part that arrives before it.
    const warn = budget.warning(led, p);
    if (warn && !warned) {
      warned = true;
      say({ type: 'warning', ...warn });
    }

    if (!reply.tool_calls.length) {
      memory.updateSession(session.id, {
        tokens: (memory.getSession(session.id)?.tokens || 0) + spend.totalTokens,
      });
      // The ordinary way a turn ends, and the one the fallback field has to be
      // on: a turn that hopped and then answered lands here, not on the return
      // at the bottom of this function.
      return {
        sessionId: session.id, text, steps: step, usage: spend,
        ...(fallbacks.length ? { fallbacks } : {}),
      };
    }

    for (const tc of reply.tool_calls) {
      const name = tc.function?.name || '(unnamed)';
      let args = {};
      try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; }
      catch { args = { _raw: tc.function?.arguments }; }

      say({ type: 'tool_call', name, args, step });

      // Manual approval, if it is on. The gate is here rather than inside
      // `tools.call` because this is where `say()` is — the question has to
      // reach the transcript the user is looking at — and because it must cover
      // MCP tools, which `tools.call` dispatches before it sees a definition.
      let refused = null;
      const gate = args._raw === undefined ? approval.gate(name, args) : null;
      if (gate) {
        if (isMission) {
          refused = approval.missionRefusal(gate);
          say({ type: 'approval', step, state: 'refused', tool: name, ...gate });
        } else {
          const { id, answer } = approval.askAnywhere(gate, { sessionId: session.id, signal, client });
          say({ type: 'approval', step, state: 'asked', id, ...gate });
          const decision = await answer;
          say({ type: 'approval', step, state: 'answered', id, decision, tool: name });
          // Anything that is not one of the three yeses — a denial, a timeout,
          // a stopped turn — stops the call and says which it was.
          if (!['once', 'always', 'always_tool'].includes(decision))
            refused = approval.refusal(decision, gate);
        }
      }

      // What a tool put in front of the user (show_image). It travels as its own
      // event and is kept on the tool row, so a reloaded transcript draws it
      // again; the model only ever reads the result text.
      const shown = [];
      const result = refused !== null
        ? refused
        : args._raw !== undefined
        ? `Error: could not parse the arguments as JSON: ${args._raw}`
        : !schemas.some(sc => sc.function.name === name)
          ? `Error: the "${name}" tool is switched off for this conversation.`
          : await tools.call(name, args, stepDisabled, { show: image => shown.push(image), sessionId: session.id, signal });
      for (const image of shown) say({ type: 'image', image, step });
      say({ type: 'tool_result', name, result, step });

      memory.append(session.id, {
        role: 'tool', tool_call_id: tc.id || name, name, content: result,
        ...(shown.length ? { images: shown } : {}),
      });

      // A settings proposal is the one tool result the user has to act on, so it
      // travels as its own event and the console draws it as a card with buttons
      // rather than as one more line of tool output to scroll past.
      for (const proposal of settings.list().pending) {
        if (announced.has(proposal.id)) continue;
        announced.add(proposal.id);
        say({ type: 'proposal', proposal });
      }
    }

    // Token pressure folds the conversation early, before the message count
    // would have. `compactTokens` is the honest trigger — a window nobody
    // declared cannot be a percentage of anything, and message count treats
    // twenty lines of chat and twenty screens of tool output as the same.
    const reason = budget.compactReason(p, led.lastPrompt);
    if (reason) {
      const folded = await foldSummary({ session: memory.getSession(session.id), p, ep, signal, force: true });
      if (folded !== summary) {
        summary = folded;
        say({ type: 'compacted', at: step, contextTokens: led.lastPrompt, contextWindow: budget.windowFor(p) || null,
          setting: reason.setting, threshold: reason.at });
      }
    }

    if (step === maxSteps) {
      // Name the limit that actually stopped it. A specialist's step cap comes
      // from its own definition file, so sending the user to the panel's
      // harness settings would be sending them somewhere that changes nothing —
      // which is charter rule 12 broken by the code that enforces it.
      const note = profile
        ? `Stopped after ${maxSteps} tool steps without a final answer — that is this specialist's own `
          + `limit, "maxSteps" in the ${profile.id} agent definition, not the model's and not the panel's. `
          + 'Raise it there, or give it a narrower errand.'
        : `Stopped after ${maxSteps} tool steps without a final answer — that is this panel's own `
          + 'limit (harness.config.doca.maxSteps), not the model\'s. Raise "Max tool steps" in the harness '
          + 'settings, or ask again more narrowly.';
      say({ type: 'text', text: `\n\n${note}` });
      memory.append(session.id, { role: 'assistant', content: note });
      text += `\n\n${note}`;
    }
  }

  memory.updateSession(session.id, {
    tokens: (memory.getSession(session.id)?.tokens || 0) + budget.report(led, p).totalTokens,
  });
  return {
    sessionId: session.id, text, steps: maxSteps, usage: budget.report(led, p),
    // Absent when nothing hopped, which is every turn on a healthy chain: the
    // field exists to mark the ones that did, not to be a null to check.
    ...(fallbacks.length ? { fallbacks } : {}),
  };
}

/**
 * The system prompt this harness would send for a message, assembled but not
 * sent.
 *
 * It exists because the prompt is the product here — the charter, the limits,
 * the memory with its locks and disputes — and until now the only way to see it
 * was to run a turn and trust the description. `GET /api/harness/environment`
 * shows the user the environment block for the same reason; this is the whole
 * of it, and it is what the prompt-order tests assert against.
 *
 * This is the system message, which is now the *stable* half of what a turn
 * sends. The per-step readings travel separately, after the history — see
 * `liveBlock()`. A caller that needs the whole request wants both.
 */

module.exports = { turn, isRunning, cancel, status, contextOf, params, ask, complete, preview, breakdown, liveBlock, events,
  toApiMessages, rungsFor, markDegraded, forgetDegraded, openingHop, missionsFor, DEGRADED_MS };

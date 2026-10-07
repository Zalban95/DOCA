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
const settings    = require('./settings');
const attachments = require('../attachments');
const tools       = require('./tools');

// The turn's parts, one idea per file under ./turn. This file runs the turn;
// the rest is imported, and re-exported where other modules already use it.
const { params, turnParams, profileForTurn } = require('./turn/params');
const { disabledFor, isMissionProfile, liveBlock, missionsFor, turnPreamble } = require('./turn/prompt');
const { stepRequest } = require('./turn/step-request');
const { runToolCalls } = require('./turn/tool-calls');
const { stepLimitNote } = require('./turn/step-limit');
const { toApiMessages } = require('./turn/messages');
const { DEGRADED_MS, rungsFor, markDegraded, forgetDegraded, openingHop, hopReporter, truncationNotice } = require('./turn/fallback');
const { ask, complete } = require('./turn/transport');
const { foldSummary } = require('./turn/summary');
const { preview, breakdown, contextOf, status } = require('./turn/introspect');
const { events, running, isRunning, isAuto, cancel, claim, changed } = require('./turn/lifecycle');

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
  const ctrl = new AbortController();
  await claim(id, ctrl, options.auto);        // an automatic turn gives way to anyone else
  const abort = () => ctrl.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) ctrl.abort();
  // One record of how this turn goes (runs.js): the mission and the conversation read the same row.
  const runId = require('./runs').begin({ sessionId: id, missionId: options.profile?.missionId || null, personId: options.client?.user?.id || null,
    detail: options.client ? { client: { id: options.client.id || null, kind: options.client.kind || null, name: options.client.name || null } } : null });   // which device asked (Chronicle)
  require('./trace').start(runId, id);   // and what it did, step by step (trace.js)
  require('../features/usage').count('turn:builtin');   // what the one-shot adapters stand beside (features/alternatives.js)
  try {
    const profile = profileForTurn(session, options.profile);
    memory.updateSession(id, { state: 'running', lastError: null, seenAt: null });   // new work waits to be opened again (seen.js)
    changed(id);
    if (options.client && options.client.kind !== 'agent')
      organization.report(id, 'user intervention', options.message, options.client.name || 'user');
    const client = require('./turn/client').withPerson(options.client, id);
    // A mission or work chat runs for the person above it: the record says so (live test 2026-10-04).
    if (!options.client?.user && client?.user) require('./runs').person(runId, client.user.id);
    const read = [];
    const result = await runTurn({ ...options, client, sessionId: id, signal: ctrl.signal, profile, read });
    for (const i of read) try { i.onAnswer?.(result); } catch { /* its sender may be gone */ }
    ctrl.steps = result.steps;
    ctrl.truncated = !!result.truncated;
    const state = ctrl.signal.aborted ? 'cancelled' : 'idle';
    memory.updateSession(id, { state, brief: String(result.text || '').slice(0, 600) });
    organization.report(id, state === 'cancelled' ? state : 'turn completed', result.text);
    const ended = state === 'cancelled' ? 'cancelled' : 'done';
    require('./runs').end(runId, { state: ended, outcome: result.text, steps: result.steps, tokens: result.usage?.totalTokens ?? null });
    if (ended === 'done') require('./runs').checkPlan(runId);
    return { ...result, ended, runId };
  } catch (e) {
    const state = ctrl.signal.aborted ? 'cancelled' : 'failed';
    if (state === 'failed') ctrl.failed = String(e.message).slice(0, 300);   // the supervisor must not rewake into the same failure
    memory.updateSession(id, { state, lastError: String(e.message).slice(0, 600) });
    organization.report(id, state, e.message);
    require('./runs').end(runId, { state, outcome: e.message });
    throw e;
  } finally {
    require('./trace').finish(id);
    running.delete(id);
    changed(id, ctrl);
    options.signal?.removeEventListener('abort', abort);
    nextWaiting(id);
  }
}

/** What is still waiting when a turn ends starts the next one, as whoever wrote it (inbox.js). */
function nextWaiting(id) {
  const inbox = require('./inbox');
  const [first, ...rest] = inbox.take(id);
  if (!first) return;
  for (const r of rest) inbox.put(id, r);   // read by the new turn before its first step
  setImmediate(() => {
    const run = first.start ? first.start() : turn({ message: first.message, sessionId: id, client: first.client, attachments: first.attachments });
    Promise.resolve(run).catch(() => { /* the turn records its own failure */ });
  });
}

/**
 * A message to a conversation: a turn of its own when it is free, or waiting
 * in its inbox when it is working (a turn the panel started by itself still
 * gives way, as before). @returns {{ queued: true, id, position } | Promise<turn result>}
 */
function send(options, waitingItem = {}) {
  const id = options.sessionId || memory.activeSession().id;
  if (running.has(id) && !(running.get(id).auto && !options.auto))
    return { queued: true, sessionId: id, ...require('./inbox').put(id, { message: options.message, client: options.client, attachments: options.attachments, ...waitingItem }) };
  return turn({ ...options, sessionId: id });
}


async function runTurn({ message, sessionId, emit, signal, client, attachments: attached, profile, read = [] }) {
  const say = evt => {
    try { emit(evt); } catch {}
    try { events.emit('event', { sessionId, ...evt }); } catch {}
  };
  // The chat's model choice; a day's token ceiling, or the person's spending budget, refuses to start (turn/ceiling.js).
  let p = await require('./turn/ceiling').check(require('./turn/choice').apply(turnParams(profile), sessionId), new Date(), { person: client?.user, sessionId });
  p = require('../auth/allot').narrowModel(p, client?.user);   // only the models allotted to the person (S13)
  if (p._allotted) say({ type: 'warning', kind: 'allotted', text: p._allotted });
  // Assistant mode (a call from the face) may have a quicker model of its own, and every turn knows its thinking effort.
  // Its model is held to the person's allotment too: not allotted, the turn keeps the narrowed one (review 2026-10-07).
  if (require('./turn/effort').spokenProfile(client) && require('../settings-schema').value('assistant.model')) {
    const quick = { ...p, provider: require('../settings-schema').value('assistant.provider') || p.provider, model: require('../settings-schema').value('assistant.model') };
    if (!client?.user?.id || require('../auth/allot').allowsModel(client.user, quick)) p = quick;
  }
  p = require('../spending').priced({ person: client?.user, sessionId }, p);   // a money budget counts only priced models
  // Limits that follow the work (experiment adaptiveLimits, turn/triage.js): null when off, and then nothing changes.
  const verdict = await require('./turn/triage').verdict({ message, client, session: memory.getSession(sessionId), p });
  if (verdict) p = { ...p, maxSteps: verdict.steps, _adaptive: verdict };
  const effort = require('./turn/triage').effort(require('./turn/effort').levelFor({ session: memory.getSession(sessionId), client, p }), verdict);
  client = client && { ...client, effort };
  const ep  = providers.endpoint(p.provider);
  if (!p.model)
    // The first thing a newcomer meets when they write before setting up: say where a model comes from.
    throw Object.assign(new Error('No model chosen for the DOCA harness yet. Settings → Set-up suggests one this machine '
      + 'can run, or takes an online provider\'s key; or pick one with ⚙ on the DOCA Harness row in Controls.'), { status: 400 });

  const session = sessionId ? memory.getSession(sessionId) : memory.activeSession();
  if (!session) throw Object.assign(new Error('Unknown session'), { status: 404 });
  say({ type: 'session', sessionId: session.id });
  if (verdict) say({ type: 'triage', ...verdict });   // a span in the trace (trace.js)

  // Provenance stays on the row, not in the text: `toApiMessages` maps the
  // fields the API takes, so a client can render "you asked this from the watch"
  // without the model ever seeing a tag glued to the user's own words.
  const userRow = (text, from, files) => memory.append(session.id, {
    role: 'user', content: text,
    ...(files.length ? { attachments: files } : {}),
    ...(from ? { from: { id: from.id || null, name: from.name, formFactor: from.formFactor || from.kind || null, ...(from.user ? { userId: from.user.id } : {}) } } : {}),
  });
  userRow(message, client, attachments.resolve(attached || []));
  const from = memory.messages(session.id).length;   // where this turn's own work starts (turn/handoff.js)
  const orchestrating = profile?.level === 'orchestrator' && Number(p.orchestratorWorkSteps) > 0;
  let workSteps = 0;

  let summary = await foldSummary({ session: memory.getSession(session.id), p, ep, signal });
  // An allowlist is expressed as its complement, because `schemas()` filters by
  // what is switched off and there is no second mechanism worth adding. A
  // profile with no list gets the user's ordinary disabled-tools setting.
  const disabled = disabledFor(profile, p, session.id);

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
    ...require('./turn/effort').fields(client ? client.effort?.level : verdict && effort.level, ep, p.model),   // how hard it thinks (turn/effort.js)
  };

  let maxSteps = Math.max(1, Number(p.maxSteps) || 1);   // extended while the turn advances (turn/extend.js)
  const planOpenAtStart = verdict ? require('./turn/triage').openPlanSteps(session) : 0;
  const led      = budget.ledger();
  let warned     = false;
  let text = '';
  let claimAsked = false;   // turn/claims.js: once per turn

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
  const { projectBrief, toolNews } = await turnPreamble({ session, profile, p });   // once per turn: project, tool changes

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
    const stepDisabled = disabledFor(profile, p, session.id);
    // Sent by tier when the toolTiers experiment is on (turn/tool-tiers.js): what is held is unchanged.
    const schemas = require('./turn/tool-tiers').split(tools.schemas(stepDisabled), { sessionId: session.id, profile, text: message }).offered;
    if (toolCount !== null && schemas.length !== toolCount)
      say({ type: 'tools', count: schemas.length, was: toolCount, step });
    toolCount = schemas.length;

    // Messages written to this conversation while it works are read now, before the next step (inbox.js).
    read.push(...require('./inbox').takeInto(session, { say, append: i => userRow(i.message, i.client, attachments.resolve(i.attachments || [])) }));

    const isMission = isMissionProfile(profile);
    const { messages, acknowledge } = stepRequest({ p, ep, message, summary, client, profile, projectBrief,
      schemas, disabled, session, led, toolNews, contextSkips });

    // Measured when the provider answers with a usage frame, estimated when it
    // does not. Both are recorded; only one is called a measurement.
    const promptEstimate = budget.estimateRequest({ messages, tools: schemas });

    // Model time for this step, which is what a tokens-per-second figure is
    // about. Measured around the call and nothing else: the tool that runs
    // after it belongs to the machine, not to the model's speed.
    const startedAt = Date.now();
    const reply = await complete({
      ep, signal, p, meta: { kind: 'step', sessionId: session.id, agent: profile?.id, person: client?.user },
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
      // Announced, never quiet (turn/fallback.hopReporter says why).
      onHop: hopReporter({ fallbacks, say, step }),
      onRetry: r => say({ type: 'warning', step, kind: 'rate-limit', text: r.text, waitMs: r.waitMs, attempt: r.attempt }),
    });
    const stepMs = Date.now() - startedAt;

    acknowledge();
    budget.record(led, {
      usage: reply.usage,
      promptEstimate,
      completionEstimate: budget.estimate(reply.content) + budget.estimate(JSON.stringify(reply.tool_calls || [])),
      ms: stepMs,
    });
    const spend = budget.report(led, p);
    say({ type: 'usage', step, ...spend });
    // What this step sent and what came back, as numbers and names: the trace's model span (trace.js).
    say({ type: 'step', step, provider: reply.provider || ep.id, model: reply.model || p.model, ms: stepMs, finish: reply.finish || null, usage: reply.usage || null,
      cached: budget.cachedOf(reply.usage), estimate: promptEstimate, messages: messages.length, tools: schemas.length,
      system: require('./trace').fingerprint(messages[0]?.content), calls: reply.tool_calls.map(c => c.function?.name).filter(Boolean) });

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
      ...(reply.finish === 'length' ? { truncated: true } : {}),
    });
    // Cut off at the reply cap: said, marked, and never passed off as the whole answer (turn/fallback.js).
    if (reply.finish === 'length') say(truncationNotice({ step, p, provider: reply.provider || ep.id }));

    // Advisory, once per turn, to the user and to the agent. The hard stop
    // belongs to the provider; this is the part that arrives before it.
    const warn = budget.warning(led, p);
    if (warn && !warned) {
      warned = true;
      say({ type: 'warning', ...warn });
    }

    // An answer claiming an action no call made gets one more step (experiment claimCheck, turn/claims.js).
    const claim = !reply.tool_calls.length && step < maxSteps && require('./turn/claims').check({ text: reply.content, rows: memory.messages(session.id),
      from, held: new Set(tools.schemas(stepDisabled).map(x => x.function?.name)), asked: claimAsked });
    if (claim) { claimAsked = true; say({ type: 'warning', step, kind: 'claim', text: `The answer says ${claim.claim}; nothing this turn did it — asked to do it or say so.` }); memory.append(session.id, { role: 'user', content: claim.note, from: { id: null, name: 'DOCA', formFactor: 'hub' } }); continue; }
    if (!reply.tool_calls.length) {
      memory.updateSession(session.id, {
        tokens: (memory.getSession(session.id)?.tokens || 0) + spend.totalTokens,
      });
      // The ordinary way a turn ends, and the one the fallback field has to be
      // on: a turn that hopped and then answered lands here, not on the return
      // at the bottom of this function.
      return {
        sessionId: session.id, text, steps: step, usage: spend,
        ...(fallbacks.length ? { fallbacks } : {}), ...(reply.finish === 'length' ? { truncated: true } : {}),
      };
    }

    // The Orchestrator does a few steps of real work at most; the rest moves to a work chat (turn/handoff.js).
    const handoff = require('./turn/handoff');
    const working = orchestrating && reply.tool_calls.some(handoff.isWork);
    if (working && workSteps >= Number(p.orchestratorWorkSteps)) {
      const note = handoff.handOff({ session, message, from, reply, say, step });
      memory.append(session.id, { role: 'assistant', content: note });
      say({ type: 'text', text: note });
      return { sessionId: session.id, text: text + note, steps: step, usage: spend, handedOff: true, ...(fallbacks.length ? { fallbacks } : {}) };
    }
    if (working) workSteps++;

    await runToolCalls({ reply, schemas, stepDisabled, session, signal, client, profile, isMission, step, say, announced });

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
      } else {
        // Nothing earlier to fold: the pressure is this turn. Clear its older tool results instead (turn/clear-results.js).
        const cleared = require('./turn/clear-results').clearOld(session.id);
        if (cleared) say({ type: 'compacted', at: step, contextTokens: led.lastPrompt, contextWindow: budget.windowFor(p) || null,
          setting: reason.setting, threshold: reason.at, cleared });
      }
    }

    if (step === maxSteps) {
      const more = require('./turn/extend').atLimit({ v: verdict, step, budget: maxSteps, sessionId: session.id, from, signal, planOpenAtStart, say });
      if (more) { maxSteps = more; continue; }
      const note = stepLimitNote(profile, maxSteps, verdict);
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

module.exports = { turn, send, isRunning, isAuto, cancel, status, contextOf, params, ask, complete, preview, breakdown, liveBlock, events,
  toApiMessages, rungsFor, markDegraded, forgetDegraded, openingHop, missionsFor, DEGRADED_MS };

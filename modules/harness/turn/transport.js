'use strict';

/**
 * Talking to the model: one request, streamed or read whole, with a
 * first-token guard and a hop down the fallback chain when a rung stalls.
 */

const budget      = require('../budget');
const providers   = require('../providers');
const usage       = require('../usage');

const { params } = require('./params');
const { withoutEcho } = require('./messages');
const { _degraded, markDegraded, openingHop, rungKey, rungsFor } = require('./fallback');

/* ── Model transport ──────────────────────────────────── */

async function post(ep, body, signal, p) {
  const headers = { 'Content-Type': 'application/json' };
  if (ep.apiKey) headers.Authorization = `Bearer ${ep.apiKey}`;

  const send = payload => fetch(`${ep.baseUrl}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(payload), signal,
  });

  let r = await send(body);

  // Two blind retries, both cheaper than asking every user to know which
  // dialect their endpoint speaks.
  if (r.status === 400) {
    const detail = await r.text();

    // Newer OpenAI models reject max_tokens and want max_completion_tokens.
    if (body.max_tokens && detail.includes('max_completion_tokens')) {
      const { max_tokens, ...rest } = body;
      r = await send({ ...rest, max_completion_tokens: max_tokens });

    // Asking for a usage frame is how the token ledger gets measured numbers
    // instead of estimates, but it is a newer field and a strict or older
    // OpenAI-compatible server may reject the whole request for it — some of
    // them without saying which field they disliked. So any 400 costs one retry
    // without it: counting tokens is worth a round trip, and is never worth a
    // failed turn. If the second attempt fails too, that error is the real one.
    } else if (body.stream_options) {
      const { stream_options, ...rest } = body;
      r = await send(rest);

    } else {
      throw Object.assign(new Error(budget.explain({ status: 400, detail, ep, p })), { status: 400 });
    }
  }
  if (!r.ok) throw Object.assign(new Error(budget.explain({ status: r.status, detail: await r.text(), ep, p })), { status: r.status });
  return r;
}

const WAITING_EVERY_MS = 15000;

/**
 * A deadline on the *first* token, not on the call.
 *
 * A provider that refuses says so with a status and `explain()` turns that into
 * a sentence. A provider that accepts, returns 200 and then sends nothing says
 * nothing at all, and the old code waited on it forever: `reader.read()` with
 * only the browser's hang-up as a signal. That is a blank screen with no error
 * in any log, and it cost an evening to find once already.
 *
 * So: arm a timer before the request, disarm it the moment anything real
 * arrives, and leave the rest of the stream unbounded — a long answer is not a
 * stall and must never be cut off. The caller's own signal is honoured
 * unchanged, and a user pressing Stop is told that, not this.
 */
function firstTokenGuard({ p, signal, onWaiting }) {
  const ms = Number(p?.firstTokenTimeoutMs) || 0;
  const ctrl = new AbortController();
  const started = Date.now();
  const state = { stalled: false, frames: 0, elapsed: () => Date.now() - started };

  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let deadline = null;
  let heartbeat = null;
  if (ms > 0) {
    deadline = setTimeout(() => { state.stalled = true; ctrl.abort(); }, ms);
    if (onWaiting) {
      // A short deadline still has to report before it fires, or the only thing
      // the user ever sees is the failure.
      const every = Math.max(50, Math.min(WAITING_EVERY_MS, Math.floor(ms / 3)));
      heartbeat = setInterval(() => {
        try { onWaiting({ seconds: Math.round(state.elapsed() / 1000), frames: state.frames, timeoutMs: ms }); }
        catch {}
      }, every);
    }
  }

  state.ms = ms;
  state.signal = ctrl.signal;
  // Called the moment the provider produces anything real. Idempotent: the
  // streaming path calls it on the first frame and again on nothing after.
  state.arrived = () => {
    if (deadline)  { clearTimeout(deadline);   deadline = null; }
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  };
  state.done = () => {
    state.arrived();
    if (signal) signal.removeEventListener('abort', onAbort);
  };
  return state;
}

/**
 * One model call. Streams text deltas through `onText` and returns the
 * assistant message. Falls back to reading a plain completion when the
 * endpoint answers with JSON despite being asked to stream.
 *
 * `provider` on the reply is the rung that actually answered — the one that
 * produced `reasoning`, which only it may be given back.
 * @returns {Promise<{ content: string, tool_calls: object[], provider: string }>}
 */
/**
 * A provider that is out of capacity, as opposed to one answering about this
 * request. Decided 2026-09-18: only unavailability moves down the fallback
 * chain — a refusal, a rate limit (429: your quota) or a failed login is an
 * answer, and hopping would hide it. A stall was the only unavailability
 * recognised; "high demand" (2026-09-25) is the other: 502/503/504/529, or a
 * 5xx that says overloaded, busy or at capacity.
 */
function unavailable(e) {
  const st = Number(e?.status);
  if ([502, 503, 504, 529].includes(st)) return true;
  return st >= 500 && /overload|high demand|busy|capacity|temporarily unavailable/i.test(String(e?.message || ''));
}

async function complete({ ep, body, signal, onText, onThinking, onWaiting, p, meta = { kind: 'ask' }, onHop, onSkip }) {
  signal?.throwIfAborted();
  const candidates = rungsFor({ ep, model: body.model, p });
  for (const m of candidates.missing || []) {
    onSkip?.({ provider: m.provider, model: m.model, text: `Fallback entry ${m.index + 1} (${m.provider} / ${m.model}) `
      + `is skipped: that provider is no longer in Settings → API Keys (${m.reason}). The fallback chain is one entry shorter until it is fixed.` });
  }
  const skipped = [];
  const rungs = candidates.filter(rung => {
    const issue = budget.preflight({ ...body, messages: rung.ep.id === ep.id
      ? body.messages : withoutEcho(body.messages) }, rung);
    if (!issue) return true;
    skipped.push(issue);
    onSkip?.({ provider: rung.provider, model: rung.model, text: issue });
    return false;
  }).map((rung, i, usable) => ({ ...rung,
    last: i === usable.length - 1,
    timeoutMs: i === usable.length - 1 ? Number(p?.firstTokenTimeoutMs) || 0
      : Number(p?.failoverAfterMs) || Number(p?.firstTokenTimeoutMs) || 0,
  }));
  if (!rungs.length) throw new Error(skipped.join('\n') || 'No model to call.');
  const opening = openingHop({ ep, model: body.model, candidates, rungs });
  if (opening) onHop?.(opening);
  let stalled = null;

  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i];
    let rungBody = rung.model === body.model ? body : { ...body, model: rung.model };
    // The messages were built for the provider this call was made for, and a
    // hop hands them to a different one. Anything in them that only the first
    // provider asked for comes out first: it means nothing to the new rung, and
    // an unknown field in a message is a refusal from a strict endpoint.
    if (rung.ep.id !== ep.id) rungBody = { ...rungBody, messages: withoutEcho(rungBody.messages) };
    // Each rung gets its own guard, so the shorter `failoverAfterMs` applies to
    // this entry rather than to the turn.
    const guard = firstTokenGuard({
      p: { ...p, firstTokenTimeoutMs: rung.timeoutMs }, signal, onWaiting,
    });

    try {
      const reply = await streamOrRead({ ep: rung.ep, body: rungBody, guard, onText, onThinking, p });
      usage.record({ ...meta, provider: rung.ep.id, model: rungBody.model, usage: reply.usage, body: rungBody, reply });
      // It answered, so whatever it was is over — including its own earlier stall.
      if (i > 0) _degraded.delete(rungKey(rung.ep, rung.model));
      return { ...reply, provider: rung.ep.id };
    } catch (e) {
      // Our abort and the user's are the same AbortError at this level; only the
      // guard knows which one fired. A deliberate Stop keeps its own meaning.
      // A provider out of capacity is the other way to be unavailable: it said
      // so instead of staying silent, and it said nothing about this request.
      const busy = !guard.stalled && unavailable(e);
      if (!guard.stalled && !busy) throw e;

      stalled = busy ? e : new Error(budget.stalled({ ep: rung.ep, ms: guard.ms, frames: guard.frames }));
      stalled.stalled = { provider: rung.ep.id, model: rungBody.model, ms: guard.ms, ...(busy ? { status: e.status } : {}) };
      markDegraded(rung.ep, rung.model);

      // One pass down the chain, then stop and report. Never loop, never restart
      // the chain, and only ever after a stall: a refusal or a bad request is an
      // answer about *this* request and moving on would hide it. The guard is
      // only ever `stalled` before the first token, so this cannot cut a stream
      // that had already started.
      if (rung.last || !onHop) throw stalled;
      onHop({ from: { provider: rung.ep.id, model: rungBody.model, label: rung.ep.label },
              to:   { provider: rungs[i + 1].ep.id, model: rungs[i + 1].model, label: rungs[i + 1].ep.label },
              seconds: Math.round(guard.ms / 1000), frames: guard.frames,
              remaining: rungs.length - i - 1 });
      continue;
    } finally {
      guard.done();
    }
  }
  throw stalled || new Error('No model to call.');
}

async function streamOrRead({ ep, body, guard, onText, onThinking, p }) {
  const r = await post(ep, body, guard.signal, p);

  if (!(r.headers.get('content-type') || '').includes('event-stream')) {
    // The non-streaming path needs the same deadline: this provider answered
    // `application/json`, sent headers in under half a second, and then never
    // sent a body at all. `r.json()` is bounded only by the signal.
    const json = await r.json();
    guard.arrived();
    const msg  = json?.choices?.[0]?.message || {};
    if (msg.reasoning_content && onThinking) onThinking(msg.reasoning_content);
    if (msg.content && onText) onText(msg.content);
    return { content: msg.content || '', tool_calls: msg.tool_calls || [], usage: json?.usage || null,
             reasoning: msg.reasoning_content || '', finish: json?.choices?.[0]?.finish_reason || null };
  }

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  const calls   = [];               // accumulated by delta index
  let content = '';
  let reasoning = '';
  let buf     = '';
  let usage   = null;
  let finish  = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      // An SSE comment is the provider saying "still here, nothing yet". It is
      // not content and must not disarm the deadline — but it is the single
      // most useful thing to report while waiting, because it distinguishes a
      // queued request from a dead socket. Counted, never silently dropped.
      if (line.startsWith(':')) { guard.frames++; continue; }
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let frame;
      try { frame = JSON.parse(payload); } catch { continue; }
      // Anything parseable is the provider answering, so the wait is over even
      // if this particular frame carries no delta.
      guard.arrived();
      // The usage frame arrives last and carries no choices — it is the only
      // measured number in the whole ledger, so it is read before the delta
      // check that would otherwise skip it.
      if (frame.usage) usage = frame.usage;
      // Why the provider stopped. "length" means it hit max_tokens: the reply
      // is cut off, and must never be stored and shown as if it were whole.
      if (frame.choices?.[0]?.finish_reason) finish = frame.choices[0].finish_reason;
      const delta = frame.choices?.[0]?.delta;
      if (!delta) continue;
      // Provider reasoning has its own live preview, never the answer channel.
      // Preserve the original field for the provider's next request (H-10).
      if (typeof delta.reasoning_content === 'string') {
        reasoning += delta.reasoning_content;
        if (onThinking) onThinking(delta.reasoning_content);
      }
      if (delta.content) { content += delta.content; if (onText) onText(delta.content); }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? calls.length;
        calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name)      calls[i].function.name      += tc.function.name;
        if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
      }
    }
  }

  return { content, tool_calls: calls.filter(Boolean), usage, reasoning, finish };
}

/**
 * One completion with no agent around it: no charter, no memory, no tools, no
 * transcript. The caller supplies both messages and gets the text back.
 *
 * This exists so that a job needing a model does not need a *turn*. The
 * quarantined reader in `research.js` depends on there being no way for its
 * prompt to grow tools by accident, and the rules review depends on the same.
 * @returns {Promise<string>}
 */
async function ask({ system, user, temperature = 0.1, signal }) {
  const p = params();
  if (!p.model) throw Object.assign(new Error('No model chosen for the DOCA harness.'), { status: 400 });
  // Streamed, like a turn, and for the same reason: the first-token guard still
  // catches a provider that never answers, and once it answers — thinking
  // included — nothing cuts it off. These calls used to wait for a whole reply
  // under a 2-minute clock and a 900-token cap, which a reasoning model spent
  // entirely on thinking (2026-09-25). The cap is now the harness's own
  // "Longest reply", the same as a turn's; the ceiling below is only a backstop.
  const deadline = signal || AbortSignal.timeout(60 * 60e3);
  const cap = Number(p.maxTokens) || 0;
  const reply = await complete({
    p, ep: providers.endpoint(p.provider), signal: deadline,
    // The fallback chain applies here too: complete() only hops for a caller
    // that takes the hop, and a button is as entitled to an answer as a turn.
    onHop: h => console.warn(`[harness] ask: ${h.from.model} unavailable — asking ${h.to.model}`),
    body: {
      model: p.model, stream: true, stream_options: { include_usage: true }, temperature,
      ...(cap > 0 ? { max_tokens: cap } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    },
  });
  const text = (reply.content || '').trim();
  if (!text) {
    throw Object.assign(new Error(`${reply.provider || p.provider} / ${p.model} returned no answer`
      + (reply.reasoning ? `: it thought, then stopped before writing one${cap ? ` — its reply is capped at ${cap} tokens by "Longest reply" in the harness settings` : ''}.` : '.')),
    { status: 502 });
  }
  return text;
}

module.exports = { ask, complete };

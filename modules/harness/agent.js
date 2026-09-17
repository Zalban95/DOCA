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
const { EventEmitter } = require('events');
const fs   = require('fs');
const path = require('path');

const budget      = require('./budget');
const environment = require('./environment');
const memory      = require('./memory');
const providers   = require('./providers');
const settings    = require('./settings');
const attachments = require('../attachments');
const installs    = require('./installs');
const store       = require('../store');
// Required lazily inside the functions that use them: modules/agents requires
// this file back, and a load-time cycle would leave one of the two half-built.
const agents   = { block: () => require('../agents/registry').block() };
const missions = { block: () => require('../agents/missions').block() };
const tools       = require('./tools');

/**
 * Every turn's events, for anything that was not the caller.
 *
 * `turn()` hands its events to whoever started it, which is right for the thing
 * waiting on the answer and no use at all to a subscriber that arrived later —
 * the Logs tab, most of all, which is open across turns and belongs to nobody's
 * request. This is the same stream, published alongside. It never affects the
 * caller: `say()` delivers to `emit` first, and a listener that throws here
 * cannot reach into the turn.
 */
const events = new EventEmitter();
events.setMaxListeners(0);   // one per open Logs stream; there is no sensible cap

/** Per-harness params, resolved lazily to avoid a require cycle with catalog. */
function params() {
  const catalog = require('./catalog');
  return catalog.configFor(catalog.BUILTIN_ID);
}

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
 * How much answer the thing in front of the user can actually hold.
 *
 * The rule lives here, not in the callers, so a watch gets the same treatment
 * whether it asked through `/api/v1` or through anything added later. It is
 * derived from what the device declared — form factor first, screen width when
 * the form factor is one we do not know — because a client that lies about its
 * screen is only lying to itself.
 */
const SHAPE = {
  watch:   'One or two short sentences. No tables, no code blocks, no lists longer than three items. Lead with the number or the verdict; offer to send the detail to a bigger screen.',
  glasses: 'One short sentence, spoken aloud rather than read. No formatting at all.',
  phone:   'A few short paragraphs. A small table is fine, a wide one is not; keep code snippets under ten lines.',
  tablet:  'Normal prose with tables and short code blocks.',
  desktop: 'Full detail is welcome: tables, long code, complete output.',
  tv:      'Very few words in large blocks. No tables, no code.',
  headless:'Complete and machine-readable. Do not shorten for a human, and do not decorate.',
};

function shapeFor(client) {
  if (client.kind === 'agent' || client.formFactor === 'headless') return SHAPE.headless;
  const named = SHAPE[client.formFactor];
  if (named) return named;
  const w = Number(client.screen?.w) || 0;
  if (!w) return SHAPE.phone;                 // unknown and undeclared: the middle is the safe guess
  if (w < 400)  return SHAPE.watch;
  if (w < 900)  return SHAPE.phone;
  return SHAPE.desktop;
}

/**
 * Who this turn came from. The agent is one mind with many windows, and the
 * windows are not interchangeable: the same answer that is right on a desktop is
 * unreadable on a watch. Every entry point names its client, so this block is
 * present on every turn rather than only on the ones somebody remembered.
 */
function clientBlock(client) {
  if (!client) return '';
  const screen = client.screen?.w && client.screen?.h
    ? `${client.screen.w}×${client.screen.h}${client.screen.shape === 'round' ? ' round' : ''}`
    : 'screen not declared';
  const can = [
    client.input?.voice && 'voice',
    client.input?.text && 'keyboard',
    client.input?.touch && 'touch',
    client.input?.camera && 'camera',
  ].filter(Boolean).join(', ');
  return [
    '# Who is asking',
    `This turn came from "${client.name}"${client.id ? ` (${client.id})` : ''} — ${client.label || client.formFactor || 'an unknown client'}, ${screen}${can ? `, input: ${can}` : ''}.`,
    `Shape the answer for it: ${shapeFor(client)}`,
    'Other devices of the same user may be reading this conversation too, so do not describe this one as if it were the only one.',
  ].join('\n');
}

/**
 * Which machine's tools to reach for, given who asked.
 *
 * Both halves of this were already in the prompt and nothing joined them: the
 * agent is told which client this turn came from (`clientBlock`) and it is told,
 * per tool, which machine that tool acts on (`mcp/tools.js::machineNote`). What
 * it was never told is that those two facts are related. So with a Blender on
 * the phone's machine and a Blender on the host, "look at my Blender scene" had
 * no rule behind it and the answer came down to whether the user happened to
 * name a machine.
 *
 * The rule is: whoever asked is probably talking about their own machine. It is
 * a default, not a constraint — the agent may reach anywhere it has tools for,
 * and the one thing it must not do is reach somewhere else silently.
 *
 * Rendered only when a client-hosted server exists, because with everything on
 * one host there is nothing to choose between and this is prompt the user pays
 * for on every step.
 */
function placeBlock(client) {
  let servers = [];
  try { servers = require('../mcp/registry').list(); } catch { return ''; }

  const running = servers.filter(s => s.state === 'running');
  const hosted  = running.filter(s => s.origin?.kind === 'client');
  if (!hosted.length) return '';

  const mine = client?.id ? hosted.filter(s => s.origin.deviceId === client.id) : [];
  const out  = ['# Whose machine to work on'];

  if (mine.length) {
    out.push(`This turn came from a device that hosts its own tools: `
      + `${mine.map(s => `mcp__${s.id}__* (${s.toolCount} tools, on ${s.originLabel})`).join(', ')}.`);
    out.push('When the request does not name a machine, that is the one it almost certainly means — '
      + 'somebody asking from their laptop about "my files" or "my Blender" means the laptop in front of them.');
  } else {
    out.push('This turn came from a device that hosts no tools of its own, so anything you do lands on '
      + 'another machine. Say which one, in the answer, whenever that could surprise them.');
  }

  const elsewhere = hosted.filter(s => !mine.includes(s));
  if (elsewhere.length)
    out.push(`Also reachable, on other machines: `
      + `${elsewhere.map(s => `mcp__${s.id}__* (${s.originLabel})`).join(', ')}.`);
  if (running.some(s => s.origin?.kind !== 'client'))
    out.push('The DOCA host\'s own servers, and your shell, act here — on the machine this panel runs on, '
      + 'which is usually not the machine that asked.');

  out.push('Two rules, and the second matters more: prefer the asking device when nothing says otherwise, '
    + 'and **name the machine you used** whenever it is not theirs. A tool that failed on one machine may '
    + 'succeed on another — offer that, do not silently substitute it.');

  return out.join('\n');
}

/**
 * The whole system prompt, in the order it is read.
 *
 * The charter goes first and comes from code, so the panel's rules are the first
 * thing in context and the last thing anybody can edit away. `p.systemPrompt` —
 * which the user does own — follows it, then the facts, then what the agent
 * knows, then where this conversation had got to.
 */
function systemPrompt({ p, userText, summary, toolCount, disabledCount, client, ledger, profile }) {
  // A specialist's prompt is mostly what is left out of it. The charter is not
  // one of those things: it goes first here exactly as it does for the
  // orchestrator, and a definition has no way to drop it.
  if (profile) {
    return [
      providers.SAFETY_CHARTER,
      profile.systemPrompt,
      `You are "${profile.label || profile.id}", working on one errand handed to you by the agent the `
        + 'user is talking to. You cannot change settings, install anything, or dispatch another agent. '
        + 'When you are done, answer with the result — that answer is the whole of what gets back. If '
        + 'something is in your way that only the user can clear, say so plainly and stop rather than '
        + 'working around it.',
      profile.environment === 'full'
        ? environment.block({ provider: p.provider, model: p.model, toolCount, disabledCount })
        : environmentBrief(p, toolCount),
      profile.memory ? memoryBlock(userText, Math.max(0, Number(p.memoryLimit) || 0)) : '',
      budget.block(p, ledger),
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
    budget.block(p, ledger),
    settings.block(),
    installs.block(),
    agents.block(),
    missions.block(),
    summary ? `# Earlier in this conversation\n${summary}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * The environment, for something that only needs to know where it is standing.
 *
 * The full block lists every managed path, every provider and every MCP server,
 * which is right for an agent that might use any of them and is pure cost for
 * one with four tools. Rebuilt per step like everything else, so the saving is
 * per step too.
 */
function environmentBrief(p, toolCount) {
  const s = environment.snapshot();
  return ['# Where you are',
    `host: ${s.host.hostname} (${s.host.platform}), user ${s.host.user}, home ${s.host.home}`,
    `now: ${new Date().toISOString()}`,
    `running on: ${p.provider} / ${p.model || '(model unset)'}${toolCount ? `, ${toolCount} tools` : ''}`,
    `workspace: ${(s.paths.find(x => x.key === 'WORKSPACE_DIR') || {}).value || '(unset)'}`,
  ].join('\n');
}

// Newest tool results stay verbatim until this many characters of them have
// been kept; older ones become a head, a tail and a path. The transcript on
// disk is not touched — this is only what the next model call sees.
const TOOL_KEEP_CHARS = 12000;
const TOOL_HEAD = 600;
const TOOL_TAIL = 200;

function safeSpillPart(s, max) {
  return String(s || 'tool').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'tool';
}

/** Write one tool result so a clipped prompt can still retrieve it with read_file. */
function spillTool(sessionId, row) {
  const dir = store.dir(path.join('harness/tool-results', sessionId || 'anon'));
  const file = path.join(dir,
    `${safeSpillPart(row.tool_call_id || row.at, 48)}-${safeSpillPart(row.name, 32)}.txt`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, String(row.content ?? ''), 'utf8');
  return file;
}

function clipToolContent(content, file) {
  const s = String(content ?? '');
  if (s.length <= TOOL_HEAD + TOOL_TAIL + 80) return s;
  return `${s.slice(0, TOOL_HEAD)}\n… [full output: ${file} — ${s.length} characters; read_file to retrieve]\n${s.slice(-TOOL_TAIL)}`;
}

/**
 * Send calls and results only in pairs, dropping either half that has lost the
 * other.
 *
 * `memory.foldBoundary` is what keeps a group on one side of every cut; this is
 * the backstop, because the cost of one broken pair getting through is a provider
 * rejecting *every* subsequent request in the session, and half a pair says
 * nothing to a model anyway — a result whose call is gone is an answer with the
 * question torn off.
 *
 * Both directions happen. A cut through a group leaves the results without the
 * call; a turn that stops between the call and the result — Stop, a crash, an
 * aborted step — leaves the call without its results, which strict providers
 * reject just as firmly. An assistant row that loses every call keeps whatever it
 * said and goes as ordinary text, or is dropped when it said nothing at all.
 */
function pairedRows(rows) {
  const list = rows || [];
  // The same fallback the result row was written with: a provider that sends no
  // call id has its results filed under the tool's name, and matching on `id`
  // alone would read every one of those pairs as two orphans.
  const callId = c => c.id || c.function?.name || '(unnamed)';
  const answered = new Set(list.filter(r => r.role === 'tool').map(r => r.tool_call_id));
  const out = [];
  let open = new Set();
  for (const r of list) {
    if (r.role === 'tool') {
      if (open.has(r.tool_call_id)) out.push(r);
      continue;
    }
    // A call is answered within the step that made it or not at all, so any
    // other row closes the group.
    open = new Set();
    if (r.role === 'assistant' && r.tool_calls?.length) {
      const kept = r.tool_calls.filter(c => answered.has(callId(c)));
      if (kept.length) {
        open = new Set(kept.map(callId));
        out.push({ ...r, tool_calls: kept });
      } else if (String(r.content || '').trim()) {
        out.push({ ...r, tool_calls: undefined });
      }
      continue;
    }
    out.push(r);
  }
  return out;
}

/**
 * Transcript rows → the message array the API expects.
 *
 * Tool output is kept in full on disk and clipped here. Walking newest-first
 * and stopping at TOOL_KEEP_CHARS is what stops a long session from re-sending
 * every `read_file` it ever did; the spill file is how the model gets the rest.
 */
function toApiMessages(allRows, { sessionId } = {}) {
  const rows = pairedRows(allRows);
  const keepFull = new Set();
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].role !== 'tool') continue;
    const len = String(rows[i].content || '').length;
    if (!keepFull.size || used + len <= TOOL_KEEP_CHARS) {
      keepFull.add(i);
      used += len;
    }
  }

  return rows.map((r, i) => {
    if (r.role === 'tool') {
      let content = r.content;
      if (!keepFull.has(i)) {
        const file = spillTool(sessionId, r);
        content = clipToolContent(r.content, file);
      }
      return { role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content };
    }
    if (r.role === 'assistant' && r.tool_calls?.length)
      return { role: 'assistant', content: r.content || null, tool_calls: r.tool_calls };
    // Attachments are rendered here and stored separately on the row, the same
    // split `from` uses — but the opposite decision about the model. Provenance
    // is metadata and stays off the text; a file the user attached is part of
    // what they said, and a path they can see in the composer and the model
    // cannot is a conversation at cross purposes.
    return { role: r.role, content: (r.content || '') + attachments.note(r.attachments) };
  });
}

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
      throw new Error(budget.explain({ status: 400, detail, ep, p }));
    }
  }
  if (!r.ok) throw new Error(budget.explain({ status: r.status, detail: await r.text(), ep, p }));
  return r;
}

/** How often a still-silent provider is reported while we wait for its first token. */
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
 * @returns {Promise<{ content: string, tool_calls: object[] }>}
 */
async function complete({ ep, body, signal, onText, onWaiting, p }) {
  const guard = firstTokenGuard({ p, signal, onWaiting });
  try {
    return await streamOrRead({ ep, body, guard, onText, p });
  } catch (e) {
    // Our abort and the user's are the same AbortError at this level; only the
    // guard knows which one fired. A deliberate Stop keeps its own meaning.
    if (guard.stalled) throw new Error(budget.stalled({ ep, ms: guard.ms, frames: guard.frames }));
    throw e;
  } finally {
    guard.done();
  }
}

async function streamOrRead({ ep, body, guard, onText, p }) {
  const r = await post(ep, body, guard.signal, p);

  if (!(r.headers.get('content-type') || '').includes('event-stream')) {
    // The non-streaming path needs the same deadline: this provider answered
    // `application/json`, sent headers in under half a second, and then never
    // sent a body at all. `r.json()` is bounded only by the signal.
    const json = await r.json();
    guard.arrived();
    const msg  = json?.choices?.[0]?.message || {};
    if (msg.content && onText) onText(msg.content);
    return { content: msg.content || '', tool_calls: msg.tool_calls || [], usage: json?.usage || null };
  }

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  const calls   = [];               // accumulated by delta index
  let content = '';
  let buf     = '';
  let usage   = null;

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
      const delta = frame.choices?.[0]?.delta;
      if (!delta) continue;
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

  return { content, tool_calls: calls.filter(Boolean), usage };
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
async function ask({ system, user, temperature = 0.1, maxTokens, signal }) {
  const p = params();
  if (!p.model) throw Object.assign(new Error('No model chosen for the DOCA harness.'), { status: 400 });
  const { content } = await complete({
    p, ep: providers.endpoint(p.provider),
    // A turn has a user watching a stream and can wait; these callers are a tool
    // call and a button, both of which have to come back or say why.
    signal: signal || AbortSignal.timeout(120_000),
    body: {
      model: p.model, stream: false, temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    },
  });
  return (content || '').trim();
}

/* ── Rolling summary ──────────────────────────────────── */

/**
 * Fold the older half of a long conversation into prose, so the window stays
 * small while nothing the user said simply vanishes.
 */
async function foldSummary({ session, p, ep, signal, force = false }) {
  const pending = memory.pendingFold(session.id, Number(p.summarizeAfter) || 0, { force });
  if (!pending) return session.summary || '';

  const transcript = pending.rows
    .map(r => `${r.role}${r.name ? `(${r.name})` : ''}: ${tools.clip(r.content || '[tool call]', 1200)}`)
    .join('\n');

  try {
    const { content } = await complete({
      ep, signal, p,
      body: {
        model: p.model, stream: false, temperature: 0.2,
        messages: [
          { role: 'system', content: 'Merge the notes and new transcript into a compact brief of this '
            + 'conversation: decisions made, facts established, work completed, and anything still open. '
            + 'Keep names, paths and numbers verbatim. Prose, under 250 words, no preamble.' },
          { role: 'user', content: `Existing notes:\n${pending.previous || '(none)'}\n\nNew transcript:\n${transcript}` },
        ],
      },
    });
    const summary = (content || '').trim() || pending.previous;
    memory.updateSession(session.id, { summary, summarizedThrough: pending.through });
    return summary;
  } catch {
    // Summarising is an optimisation. If it fails, keep the old notes and let
    // the window cap do the trimming rather than failing the user's turn.
    return pending.previous;
  }
}

/* ── The turn ─────────────────────────────────────────── */

/**
 * Run one turn of the built-in harness.
 *
 * @param {{ message: string, sessionId?: string, emit: (evt: object) => void, signal?: AbortSignal,
 *           client?: { id?: string, name: string, kind?: string, label?: string, formFactor?: string,
 *                      screen?: object, input?: object } }} opts
 * @returns {Promise<{ sessionId: string, text: string, steps: number }>}
 */
async function turn({ message, sessionId, emit, signal, client, attachments: attached, profile }) {
  const say = evt => {
    try { emit(evt); } catch {}
    try { events.emit('event', evt); } catch {}
  };
  // A profile overrides only what it names. Everything it is silent about —
  // temperature, history, the summariser — stays the panel's own setting, so a
  // specialist does not quietly acquire a second set of defaults to maintain.
  const p = profile
    ? {
      ...params(),
      ...(profile.provider      ? { provider: profile.provider }           : {}),
      ...(profile.model         ? { model: profile.model }                 : {}),
      ...(profile.maxSteps      ? { maxSteps: profile.maxSteps }           : {}),
      ...(profile.maxTokens     ? { maxTokens: profile.maxTokens }         : {}),
      ...(profile.contextWindow ? { contextWindow: profile.contextWindow } : {}),
      systemPrompt: profile.systemPrompt,
    }
    : params();
  const ep  = providers.endpoint(p.provider);
  if (!p.model)
    throw Object.assign(new Error(
      'No model chosen for the DOCA harness — pick one with ⚙ on the harness row in Controls.'), { status: 400 });

  const session = sessionId ? memory.getSession(sessionId) : memory.activeSession();
  if (!session) throw Object.assign(new Error('Unknown session'), { status: 404 });
  memory.setActive(session.id);
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
  const disabled = profile && Array.isArray(profile.tools)
    ? tools.schemas([]).map(sc => sc.function.name).filter(n => !profile.tools.includes(n))
    : (Array.isArray(p.disabledTools) ? p.disabledTools : []);

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
    const schemas = tools.schemas(disabled);
    if (toolCount !== null && schemas.length !== toolCount)
      say({ type: 'tools', count: schemas.length, was: toolCount, step });
    toolCount = schemas.length;

    const { rows } = memory.window(session.id, Number(p.historyTurns) || 0);
    const messages = [
      {
        role: 'system',
        content: systemPrompt({
          p, userText: message, summary, client, ledger: led,
          toolCount: schemas.length, disabledCount: disabled.length,
        }),
      },
      ...toApiMessages(rows, { sessionId: session.id }),
    ];

    // Measured when the provider answers with a usage frame, estimated when it
    // does not. Both are recorded; only one is called a measurement.
    const promptEstimate = budget.estimateMessages(messages);

    const reply = await complete({
      ep, signal, p,
      body: { ...base, messages, ...(schemas.length ? { tools: schemas, tool_choice: 'auto' } : {}) },
      onText: t => { text += t; say({ type: 'text', text: t }); },
      // Silence is a state worth drawing. Without this the console shows the
      // session line and then nothing at all, which reads as a broken panel
      // rather than as a provider that has not started answering.
      onWaiting: w => say({ type: 'waiting', step, provider: ep.label || ep.id, ...w }),
    });

    budget.record(led, {
      usage: reply.usage,
      promptEstimate,
      completionEstimate: budget.estimate(reply.content) + budget.estimate(JSON.stringify(reply.tool_calls || [])),
    });
    const spend = budget.report(led, p);
    say({ type: 'usage', step, ...spend });

    memory.append(session.id, {
      role: 'assistant',
      content: reply.content || '',
      ...(reply.tool_calls.length ? { tool_calls: reply.tool_calls } : {}),
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
      return { sessionId: session.id, text, steps: step, usage: spend };
    }

    for (const tc of reply.tool_calls) {
      const name = tc.function?.name || '(unnamed)';
      let args = {};
      try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; }
      catch { args = { _raw: tc.function?.arguments }; }

      say({ type: 'tool_call', name, args, step });
      // What a tool put in front of the user (show_image). It travels as its own
      // event and is kept on the tool row, so a reloaded transcript draws it
      // again; the model only ever reads the result text.
      const shown = [];
      const result = args._raw !== undefined
        ? `Error: could not parse the arguments as JSON: ${args._raw}`
        : await tools.call(name, args, disabled, { show: image => shown.push(image) });
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
  return { sessionId: session.id, text, steps: maxSteps, usage: budget.report(led, p) };
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
 */
function preview({ message = '', client = null, ledger = null, profile = null } = {}) {
  const p = profile ? { ...params(), systemPrompt: profile.systemPrompt } : params();
  const disabled = profile && Array.isArray(profile.tools)
    ? tools.schemas([]).map(sc => sc.function.name).filter(n => !profile.tools.includes(n))
    : (Array.isArray(p.disabledTools) ? p.disabledTools : []);
  return systemPrompt({
    p, userText: message, summary: '', client, ledger, profile,
    toolCount: tools.schemas(disabled).length, disabledCount: disabled.length,
  });
}

/**
 * Where the tokens in one prompt actually are, section by section.
 *
 * A turn re-sends the whole prompt on every step, so a fat prompt is not paid
 * once — it is paid `steps` times, and the first screenshot that went through
 * this harness cost 1.6 million tokens across eleven steps without the context
 * ever passing 155k. Percentage-of-window warnings say nothing about that: with
 * a million-token window, 150k per step reads as 15% full and perfectly fine.
 *
 * So this exists to answer "why is my prompt this big" with a number per
 * section rather than a theory, and it counts the two things people forget:
 * the tool schemas, which travel in the request body rather than the system
 * prompt and are re-sent every step like everything else, and the transcript.
 */
function breakdown({ message = '', client = null, sessionId = null } = {}) {
  const p = params();
  const disabled = Array.isArray(p.disabledTools) ? p.disabledTools : [];
  const schemas  = tools.schemas(disabled);

  const measure = (name, text, note) => ({
    name, note: note || null,
    chars: (text || '').length,
    tokens: budget.estimate(text || ''),
  });

  const sections = [
    measure('safety charter', providers.SAFETY_CHARTER, 'ships in code, not editable'),
    measure('system prompt', p.systemPrompt || providers.DEFAULT_SYSTEM_PROMPT, 'harness.config.doca.systemPrompt'),
    measure('environment', environment.block({
      provider: p.provider, model: p.model, toolCount: schemas.length, disabledCount: disabled.length,
    }), 'host, paths, providers, MCP servers'),
    measure('client', clientBlock(client), 'who asked'),
    measure('where tools land', placeBlock(client)),
    measure('memory rules', rulesBlock(), 'how the agent keeps its memory'),
    measure('memory entries', memoryBlock(message, Math.max(0, Number(p.memoryLimit) || 0)),
      `pinned + best matches, up to ${p.memoryLimit} (harness.config.doca.memoryLimit)`),
    measure('limits', budget.block(p, null)),
    measure('settings proposals', settings.block()),
  ];

  // Per server, because "the prompt is big" is not actionable and "the blender
  // server is 90k of it" is: that one can be switched off on the tools list.
  const byOwner = new Map();
  for (const sc of schemas) {
    const name  = sc.function?.name || '?';
    const owner = name.startsWith('mcp__') ? `mcp: ${name.split('__')[1]}` : 'built-in tools';
    const t = budget.estimate(JSON.stringify(sc));
    const cur = byOwner.get(owner) || { owner, count: 0, tokens: 0 };
    cur.count += 1; cur.tokens += t;
    byOwner.set(owner, cur);
  }

  const rows = memory.messages(sessionId || memory.activeSession()?.id || '') || [];
  const transcript = {
    messages: rows.length,
    kept: Math.max(0, Number(p.historyTurns) || 0),
    tokens: budget.estimateMessages(toApiMessages(rows.slice(-(Number(p.historyTurns) || 0)),
      { sessionId: sessionId || memory.activeSession()?.id })),
    note: 'this conversation only — a new conversation starts empty',
  };

  const promptTokens = sections.reduce((n, s) => n + s.tokens, 0);
  const toolTokens   = [...byOwner.values()].reduce((n, o) => n + o.tokens, 0);

  return {
    sections: sections.filter(s => s.tokens > 0),
    tools: {
      count: schemas.length,
      tokens: toolTokens,
      note: 'sent in the request body on every step, not in the system prompt',
      byOwner: [...byOwner.values()].sort((a, b) => b.tokens - a.tokens),
    },
    transcript,
    total: promptTokens + toolTokens + transcript.tokens,
    perStep: promptTokens + toolTokens,
    maxSteps: Number(p.maxSteps) || 0,
    worstCase: (promptTokens + toolTokens) * (Number(p.maxSteps) || 1),
    source: 'estimated',
  };
}

/** Is the built-in harness ready to answer, and on what? */
async function status() {
  const p = params();
  const out = { provider: p.provider, model: p.model || null, ready: false, reachable: false, error: null };
  try {
    const ep = providers.endpoint(p.provider);
    out.baseUrl = ep.baseUrl;
    out.hasKey  = !!ep.apiKey || ep.local;
    out.ready   = !!p.model;
    const r = await fetch(`${ep.baseUrl}/models`, {
      headers: ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {},
      signal:  AbortSignal.timeout(4000),
    });
    out.reachable = r.ok;
    if (!r.ok) out.error = `${ep.baseUrl}/models → HTTP ${r.status}`;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

module.exports = { turn, status, params, ask, preview, breakdown, events, toApiMessages };

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

const budget      = require('./budget');
const environment = require('./environment');
const memory      = require('./memory');
const providers   = require('./providers');
const settings    = require('./settings');
const attachments = require('../attachments');
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
 * matches for what the user just said, up to `memoryLimit` entries.
 */
function memoryBlock(userText, limit) {
  const pinned = memory.memList().filter(e => e.pinned);
  const hits   = memory.memSearch(userText, limit);
  const seen   = new Set();
  const chosen = [...pinned, ...hits].filter(e => !seen.has(e.id) && seen.add(e.id)).slice(0, limit);
  if (!chosen.length) return '';
  memory.memTouch(hits);

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
function systemPrompt({ p, userText, summary, toolCount, disabledCount, client, ledger }) {
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
    summary ? `# Earlier in this conversation\n${summary}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Transcript rows → the message array the API expects. */
function toApiMessages(rows) {
  return rows.map(r => {
    if (r.role === 'tool') return { role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content: r.content };
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

/**
 * One model call. Streams text deltas through `onText` and returns the
 * assistant message. Falls back to reading a plain completion when the
 * endpoint answers with JSON despite being asked to stream.
 * @returns {Promise<{ content: string, tool_calls: object[] }>}
 */
async function complete({ ep, body, signal, onText, p }) {
  const r = await post(ep, body, signal, p);

  if (!(r.headers.get('content-type') || '').includes('event-stream')) {
    const json = await r.json();
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
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let frame;
      try { frame = JSON.parse(payload); } catch { continue; }
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
async function turn({ message, sessionId, emit, signal, client, attachments: attached }) {
  const say = evt => {
    try { emit(evt); } catch {}
    try { events.emit('event', evt); } catch {}
  };
  const p   = params();
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

  const summary = await foldSummary({ session: memory.getSession(session.id), p, ep, signal });
  const disabled = Array.isArray(p.disabledTools) ? p.disabledTools : [];

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
      ...toApiMessages(rows),
    ];

    // Measured when the provider answers with a usage frame, estimated when it
    // does not. Both are recorded; only one is called a measurement.
    const promptEstimate = budget.estimateMessages(messages);

    const reply = await complete({
      ep, signal, p,
      body: { ...base, messages, ...(schemas.length ? { tools: schemas, tool_choice: 'auto' } : {}) },
      onText: t => { text += t; say({ type: 'text', text: t }); },
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
      const result = args._raw !== undefined
        ? `Error: could not parse the arguments as JSON: ${args._raw}`
        : await tools.call(name, args, disabled);
      say({ type: 'tool_result', name, result, step });

      memory.append(session.id, { role: 'tool', tool_call_id: tc.id || name, name, content: result });

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
    // would have. Without a declared window there is nothing to be a percentage
    // of, so this does nothing and `summarizeAfter` remains the only trigger.
    const window = budget.windowFor(p);
    if (window && led.lastPrompt / window * 100 >= Math.max(1, Number(p.compactAt) || 60)) {
      const folded = await foldSummary({ session: memory.getSession(session.id), p, ep, signal, force: true });
      if (folded !== summary) {
        summary = folded;
        say({ type: 'compacted', at: step, contextTokens: led.lastPrompt, contextWindow: window });
      }
    }

    if (step === maxSteps) {
      const note = `Stopped after ${maxSteps} tool steps without a final answer — that is this panel's own `
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
function preview({ message = '', client = null, ledger = null } = {}) {
  const p = params();
  const disabled = Array.isArray(p.disabledTools) ? p.disabledTools : [];
  return systemPrompt({
    p, userText: message, summary: '', client, ledger,
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
    tokens: budget.estimateMessages(toApiMessages(rows.slice(-(Number(p.historyTurns) || 0)))),
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

module.exports = { turn, status, params, ask, preview, breakdown, events };

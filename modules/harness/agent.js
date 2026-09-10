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
const os = require('os');

const { WORKSPACE_DIR, COMPOSE_DIR } = require('../paths');
const memory    = require('./memory');
const providers = require('./providers');
const tools     = require('./tools');

/** Per-harness params, resolved lazily to avoid a require cycle with catalog. */
function params() {
  const catalog = require('./catalog');
  return catalog.configFor(catalog.BUILTIN_ID);
}

/* ── Prompt assembly ──────────────────────────────────── */

function environmentBlock(ep, model) {
  return [
    '# Environment',
    `host: ${os.hostname()} (${process.platform} ${process.arch}, ${os.cpus().length} cores, `
      + `${Math.round(os.totalmem() / 1e9)} GB RAM)`,
    `local time: ${new Date().toISOString()}`,
    `workspace (your working directory): ${WORKSPACE_DIR}`,
    `managed compose stack: ${COMPOSE_DIR}`,
    `you are running on: ${ep.id} / ${model || '(model unset)'}`,
  ].join('\n');
}

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
  return ['# What you remember', ...chosen.map(e => `- ${e.key}: ${e.value}`)].join('\n');
}

function systemPrompt({ p, ep, userText, summary }) {
  return [
    p.systemPrompt || providers.DEFAULT_SYSTEM_PROMPT,
    environmentBlock(ep, p.model),
    memoryBlock(userText, Math.max(0, Number(p.memoryLimit) || 0)),
    summary ? `# Earlier in this conversation\n${summary}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Transcript rows → the message array the API expects. */
function toApiMessages(rows) {
  return rows.map(r => {
    if (r.role === 'tool') return { role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content: r.content };
    if (r.role === 'assistant' && r.tool_calls?.length)
      return { role: 'assistant', content: r.content || null, tool_calls: r.tool_calls };
    return { role: r.role, content: r.content || '' };
  });
}

/* ── Model transport ──────────────────────────────────── */

async function post(ep, body, signal) {
  const headers = { 'Content-Type': 'application/json' };
  if (ep.apiKey) headers.Authorization = `Bearer ${ep.apiKey}`;

  let r = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body), signal,
  });

  // Newer OpenAI models reject max_tokens and want max_completion_tokens.
  // One blind retry is cheaper than asking every user to know which is which.
  if (r.status === 400 && body.max_tokens) {
    const detail = await r.text();
    if (detail.includes('max_completion_tokens')) {
      const { max_tokens, ...rest } = body;
      r = await fetch(`${ep.baseUrl}/chat/completions`, {
        method: 'POST', headers, signal,
        body: JSON.stringify({ ...rest, max_completion_tokens: max_tokens }),
      });
    } else {
      throw new Error(`${ep.id} ${r.status}: ${detail.slice(0, 400)}`);
    }
  }
  if (!r.ok) throw new Error(`${ep.id} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r;
}

/**
 * One model call. Streams text deltas through `onText` and returns the
 * assistant message. Falls back to reading a plain completion when the
 * endpoint answers with JSON despite being asked to stream.
 * @returns {Promise<{ content: string, tool_calls: object[] }>}
 */
async function complete({ ep, body, signal, onText }) {
  const r = await post(ep, body, signal);

  if (!(r.headers.get('content-type') || '').includes('event-stream')) {
    const msg = (await r.json())?.choices?.[0]?.message || {};
    if (msg.content && onText) onText(msg.content);
    return { content: msg.content || '', tool_calls: msg.tool_calls || [] };
  }

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  const calls   = [];               // accumulated by delta index
  let content = '';
  let buf     = '';

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
      let delta;
      try { delta = JSON.parse(payload).choices?.[0]?.delta; } catch { continue; }
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

  return { content, tool_calls: calls.filter(Boolean) };
}

/* ── Rolling summary ──────────────────────────────────── */

/**
 * Fold the older half of a long conversation into prose, so the window stays
 * small while nothing the user said simply vanishes.
 */
async function foldSummary({ session, p, ep, signal }) {
  const pending = memory.pendingFold(session.id, Number(p.summarizeAfter) || 0);
  if (!pending) return session.summary || '';

  const transcript = pending.rows
    .map(r => `${r.role}${r.name ? `(${r.name})` : ''}: ${tools.clip(r.content || '[tool call]', 1200)}`)
    .join('\n');

  try {
    const { content } = await complete({
      ep, signal,
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
 * @param {{ message: string, sessionId?: string, emit: (evt: object) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ sessionId: string, text: string, steps: number }>}
 */
async function turn({ message, sessionId, emit, signal }) {
  const say = evt => { try { emit(evt); } catch {} };
  const p   = params();
  const ep  = providers.endpoint(p.provider);
  if (!p.model)
    throw Object.assign(new Error(
      'No model chosen for the DOCA harness — pick one with ⚙ on the harness row in Controls.'), { status: 400 });

  const session = sessionId ? memory.getSession(sessionId) : memory.activeSession();
  if (!session) throw Object.assign(new Error('Unknown session'), { status: 404 });
  memory.setActive(session.id);
  say({ type: 'session', sessionId: session.id });

  memory.append(session.id, { role: 'user', content: message });

  const summary = await foldSummary({ session: memory.getSession(session.id), p, ep, signal });
  const disabled = Array.isArray(p.disabledTools) ? p.disabledTools : [];
  const schemas  = tools.schemas(disabled);

  const base = {
    model:       p.model,
    stream:      true,
    temperature: Number(p.temperature),
    top_p:       Number(p.topP),
    ...(Number(p.maxTokens) > 0 ? { max_tokens: Number(p.maxTokens) } : {}),
    ...(schemas.length ? { tools: schemas, tool_choice: 'auto' } : {}),
  };

  const maxSteps = Math.max(1, Number(p.maxSteps) || 1);
  let text = '';

  for (let step = 1; step <= maxSteps; step++) {
    const { rows } = memory.window(session.id, Number(p.historyTurns) || 0);
    const messages = [
      { role: 'system', content: systemPrompt({ p, ep, userText: message, summary }) },
      ...toApiMessages(rows),
    ];

    const reply = await complete({
      ep, signal, body: { ...base, messages },
      onText: t => { text += t; say({ type: 'text', text: t }); },
    });

    memory.append(session.id, {
      role: 'assistant',
      content: reply.content || '',
      ...(reply.tool_calls.length ? { tool_calls: reply.tool_calls } : {}),
    });

    if (!reply.tool_calls.length) return { sessionId: session.id, text, steps: step };

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
    }

    if (step === maxSteps) {
      const note = `Stopped after ${maxSteps} tool steps without a final answer. `
        + 'Raise "Max tool steps" in the harness settings, or ask again more narrowly.';
      say({ type: 'text', text: `\n\n${note}` });
      memory.append(session.id, { role: 'assistant', content: note });
      text += `\n\n${note}`;
    }
  }

  return { sessionId: session.id, text, steps: maxSteps };
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

module.exports = { turn, status, params };

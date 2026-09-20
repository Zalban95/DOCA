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
const approval    = require('./approval');
const settings    = require('./settings');
const attachments = require('../attachments');
const installs    = require('./installs');
const store       = require('../store');
// Required lazily inside the functions that use them: modules/agents requires
// this file back, and a load-time cycle would leave one of the two half-built.
const agents   = { block: () => require('../agents/registry').block() };
const missions = {
  block: opts => require('../agents/missions').block(opts),
  notices: sessionId => require('../agents/missions').notices(sessionId),
  acknowledgeNotices: shown => require('../agents/missions').acknowledgeNotices(shown),
};
const tools       = require('./tools');
const usage       = require('./usage');

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
        (!profile.tools.includes(n) && !(profile.level !== 'orchestrator' && ALWAYS_FOR_SPECIALISTS.includes(n))));
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
  const session = sessionId ? require('./organization').session(sessionId) : null;
  if (!session || isMissionProfile(require('./organization').profileFor(session))) return '';
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
const TOOL_MAX_CHARS = 16000;
const TOOL_HEAD = 12000;
const TOOL_TAIL = 3000;

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

/**
 * The one form a tool result can take, decided by the row and nothing else.
 *
 * `spill` is a callback rather than a path because only the clipped branch
 * needs a file written, and a row that passes through whole should not leave
 * one behind.
 */
function clipToolContent(content, spill) {
  const s = String(content ?? '');
  if (s.length <= TOOL_MAX_CHARS) return s;
  const file = spill();
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
 * Tool output is kept in full on disk and clipped here. Clipping anything over
 * TOOL_MAX_CHARS is what stops a long session from re-sending every `read_file`
 * it ever did; the spill file is how the model gets the rest.
 *
 * What matters beyond the clipping itself is that it is **stable**: the same
 * row produces the same string on every call, so the message array is
 * append-only and a prefix cache can follow it. `test/harness.test.js` pins
 * that — an old result sent once verbatim must still be verbatim after new
 * results arrive.
 */
function toApiMessages(allRows, { sessionId, provider } = {}) {
  const rows = pairedRows(allRows);

  // A field a provider sent is put back for the provider that sent it, and for
  // no one else.
  //
  // DeepSeek's thinking mode returns `reasoning_content` beside `content`, and
  // for any request carrying tools it demands the field returned on every
  // assistant message of that conversation, 400ing the turn when it is missing
  // (ISSUES.md H-10). Everyone else either ignores it or has never heard of it,
  // and a body carrying an unknown field is a refusal from a strict endpoint —
  // so the row's own record of who produced it decides, never the model name.
  // The browser may preview the stored reasoning; echoing it to a model is
  // restricted to the provider that produced it.
  const echo = r => (r.role === 'assistant' && r.reasoning?.text && r.reasoning.provider === provider
    ? { reasoning_content: r.reasoning.text } : {});

  return rows.map((r, i) => {
    if (r.role === 'tool') {
      // Each row decides its own form, so appending a result cannot change how
      // an earlier one is sent. See the note on TOOL_MAX_CHARS.
      const content = clipToolContent(r.content, () => spillTool(sessionId, r));
      return { role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content };
    }
    if (r.role === 'assistant' && r.tool_calls?.length)
      return { role: 'assistant', content: r.content || null, tool_calls: r.tool_calls, ...echo(r) };
    // Attachments are rendered here and stored separately on the row, the same
    // split `from` uses — but the opposite decision about the model. Provenance
    // is metadata and stays off the text; a file the user attached is part of
    // what they said, and a path they can see in the composer and the model
    // cannot is a conversation at cross purposes.
    // `echo` checks the role itself, so a user or tool row cannot pick up a
    // field by being shaped like an assistant one.
    return { role: r.role, content: (r.content || '') + attachments.note(r.attachments), ...echo(r) };
  });
}

/**
 * The same messages with every echoed field removed.
 *
 * Used on the one path where the messages outlive the choice of provider: a hop
 * down the fallback chain. They were built for one provider, and the field in
 * them answers a rule that provider has and the next one may not.
 */
function withoutEcho(messages) {
  return messages.map(m => {
    if (!m || m.reasoning_content === undefined) return m;
    const { reasoning_content: _dropped, ...rest } = m;
    return rest;
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

/* ── Falling down the chain ───────────────────────────── */

/**
 * Which entries to try, in order, and how long to give each.
 *
 * A chain answers one question: when the configured model stops answering, who
 * answers instead. The unit of failure matters — the evening this was written
 * for, `deepseek-flash` returned `200 text/event-stream` and sent `: keep-alive`
 * for three minutes while `deepseek-v4-pro` on the same key, same account,
 * answered in 430 ms. So the thing that went quiet was the **model**, and the
 * chain has to be per model, not per provider.
 *
 * Three rules, each with a reason:
 *
 * - **The last rung gets `firstTokenTimeoutMs`, the others get
 *   `failoverAfterMs`.** Reusing the one long deadline per rung would make a
 *   three-rung chain wait three minutes before saying anything, i.e. slower
 *   than having no chain. The user's own give-up deadline is unchanged.
 * - **A rung that stalled recently goes to the back, not out.** `DEGRADED_MS`
 *   keeps the next turn from paying the same 20 s for the same silence, but the
 *   rung is still in the list, so a model that came back becomes usable again
 *   without a restart. Blacklisting would make one bad afternoon permanent.
 * - **An entry naming a provider that no longer exists is skipped, not fatal.**
 *   Deleting a provider from Settings → API Keys should narrow the chain, not
 *   break every turn.
 */
const DEGRADED_MS = 5 * 60 * 1000;
const _degraded  = new Map();                    // "provider|model" -> last stall
const rungKey    = (ep, model) => `${ep?.id || '?'}|${model || ''}`;

/** How long ago it stalled, or null if it has not, or not within `DEGRADED_MS`. */
function stalledAgo(ep, model) {
  const at = _degraded.get(rungKey(ep, model));
  if (!at) return null;
  const age = Date.now() - at;
  return age < DEGRADED_MS ? age : null;
}
const isDegraded = (ep, model) => stalledAgo(ep, model) !== null;
function markDegraded(ep, model) { _degraded.set(rungKey(ep, model), Date.now()); }
/** For tests, and for a settings change that should take effect at once. */
function forgetDegraded() { _degraded.clear(); }

function rungsFor({ ep, model, p }) {
  const chain   = Array.isArray(p?.fallbackChain) ? p.fallbackChain : [];
  const failoverMs = Number(p?.failoverAfterMs) || 0;
  const finalMs    = Number(p?.firstTokenTimeoutMs) || 0;

  const entries = [{ provider: ep.id, model, ep, contextWindow: budget.windowFor(p),
    windowSetting: p?._windowSetting || 'harness.config.doca.contextWindow' }];
  for (const [index, c] of chain.entries()) {
    const pid = String(c?.provider || '').trim();
    if (!pid) continue;
    const cModel = String(c?.model || '').trim() || model;
    // The same (provider, model) twice is a chain that waits for itself.
    if (entries.some(e => e.provider === pid && e.model === cModel)) continue;
    let cep;
    try { cep = providers.endpoint(pid); }
    catch { continue; }
    entries.push({ provider: pid, model: cModel, ep: cep,
      contextWindow: budget.windowFor(c),
      windowSetting: `harness.config.doca.fallbackChain[${index}].contextWindow` });
  }

  const warm    = entries.filter(e => !isDegraded(e.ep, e.model));
  const cold    = entries.filter(e =>  isDegraded(e.ep, e.model));
  const ordered = [...warm, ...cold];

  return ordered.map((e, i) => ({
    ...e,
    last:      i === ordered.length - 1,
    // The last one is never cut short — the user's deadline is the answer.
    timeoutMs: i === ordered.length - 1 ? finalMs : (failoverMs || finalMs),
    // How long ago it stalled, when it stalled recently enough to have been
    // moved back. The reorder above is invisible to everything downstream — it
    // happens before the lead is ever compared — so the fact has to travel with
    // the rung, or `complete` cannot report a turn that starts on the backup.
    stalledMsAgo: stalledAgo(e.ep, e.model),
  }));
}

/**
 * What a turn has to say before it starts, when the model that answers is not
 * the one the settings name.
 *
 * Two mechanisms move the lead, and both end in the same fact. A rung whose
 * declared window cannot fit the request is dropped by the preflight. A rung
 * that stalled in the last few minutes is pushed to the back of the chain, so
 * that the turns inside `DEGRADED_MS` do not each pay the same stall again —
 * see `rungsFor`.
 *
 * The second used to happen in silence: the rotation is decided before the lead
 * is compared with anything, so no `onHop` fired, and the turn arrived with no
 * row in the console, no line in the log, and no `fallbacks` on its outcome —
 * which is the only thing a client that was asleep ever sees. An answer from a
 * smaller model then reads as the configured one's, which is the exact failure
 * `onHop` exists to prevent.
 *
 * @returns {object|null} what to hand `onHop`, or null when the configured
 *   model is the one answering.
 */
function openingHop({ ep, model, candidates, rungs }) {
  const lead = rungs[0];
  if (!lead || (lead.provider === ep.id && lead.model === model)) return null;

  // The model the settings name, which is the one worth naming as the model
  // that is *not* answering, whichever way it was passed over. `rungsFor` puts
  // it in `candidates` first, so it is always there to be found.
  const configured = candidates.find(c => c.provider === ep.id && c.model === model);
  const rotated = !!candidates[0] && (candidates[0].provider !== ep.id || candidates[0].model !== model);

  return {
    from: { provider: ep.id, model, label: ep.label },
    to:   { provider: lead.provider, model: lead.model, label: lead.ep?.label },
    reason: rotated ? 'degraded' : 'context',
    seconds: rotated ? Math.round((configured?.stalledMsAgo || 0) / 1000) : 0,
    frames: 0,
    remaining: rungs.length - 1,
  };
}

/**
 * The sentence a hop is reported with, in the console row and the log line
 * alike — one wording for both, so the two cannot come to describe different
 * events.
 */
function hopText(h) {
  const to = `${h.to.label || h.to.provider}${h.to.model ? ` / ${h.to.model}` : ''}`;
  if (h.reason === 'context')
    return `${h.from.provider} / ${h.from.model} cannot fit the estimated request in its declared window; `
      + `continuing on ${h.to.provider} / ${h.to.model}.`;
  if (h.reason === 'degraded')
    return `${h.from.label || h.from.provider} stopped answering ${h.seconds}s ago and is being passed over `
      + `while it recovers; continuing on ${to}. ${h.remaining} more in the chain.`;
  return `${h.from.label || h.from.provider} stopped answering after ${h.seconds}s `
    + `(${h.from.model || 'no model'}); continuing on ${to}.`
    + (h.frames ? ` It sent ${h.frames} keep-alive frame${h.frames === 1 ? '' : 's'} and no content.` : '')
    + ` ${h.remaining} more in the chain.`;
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
 *
 * `provider` on the reply is the rung that actually answered — the one that
 * produced `reasoning`, which only it may be given back.
 * @returns {Promise<{ content: string, tool_calls: object[], provider: string }>}
 */
async function complete({ ep, body, signal, onText, onThinking, onWaiting, p, meta = { kind: 'ask' }, onHop, onSkip }) {
  signal?.throwIfAborted();
  const candidates = rungsFor({ ep, model: body.model, p });
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
      if (!guard.stalled) throw e;

      stalled = new Error(budget.stalled({ ep: rung.ep, ms: guard.ms, frames: guard.frames }));
      stalled.stalled = { provider: rung.ep.id, model: rungBody.model, ms: guard.ms };
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
             reasoning: msg.reasoning_content || '' };
  }

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  const calls   = [];               // accumulated by delta index
  let content = '';
  let reasoning = '';
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

  return { content, tool_calls: calls.filter(Boolean), usage, reasoning };
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
      ep, signal, p, meta: { kind: 'fold', sessionId: session.id },
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
const running = new Map();
const isRunning = id => running.has(id);
function cancel(id) { const ctrl = running.get(id); if (ctrl) ctrl.abort(); return !!ctrl; }

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
    options.signal?.removeEventListener('abort', abort);
  }
}

function turnParams(profile) {
  // A profile overrides only what it names. Everything it is silent about —
  // temperature, history, the summariser — stays the panel's own setting, so a
  // specialist does not quietly acquire a second set of defaults to maintain.
  const defaults = params();
  const changedModel = profile && ((profile.provider && profile.provider !== defaults.provider)
    || (profile.model && profile.model !== defaults.model));
  const p = profile
    ? {
      ...defaults,
      ...(profile.provider      ? { provider: profile.provider }           : {}),
      ...(profile.model         ? { model: profile.model }                 : {}),
      ...(profile.maxSteps      ? { maxSteps: profile.maxSteps }           : {}),
      ...(profile.maxTokens     ? { maxTokens: profile.maxTokens }         : {}),
      contextWindow: profile.contextWindow ?? (changedModel ? 0 : defaults.contextWindow),
      _windowSetting: profile.contextWindow ? `${profile.id} agent definition contextWindow`
        : 'harness.config.doca.contextWindow',
      systemPrompt: profile.systemPrompt,
    }
    : defaults;
  if (profile?.level === 'orchestrator') {
    p.coordinatorInstructions = defaults.systemPrompt;
    p.historyTurns = Math.min(20, Number(defaults.historyTurns) || 20);
    p.summarizeAfter = Math.min(p.historyTurns, Number(defaults.summarizeAfter) || 20);
  }
  return p;
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
function preview({ message = '', client = null, profile = null, sessionId = null } = {}) {
  if (sessionId) profile = require('./organization').profileFor(require('./organization').session(sessionId));
  const p = turnParams(profile);
  const disabled = disabledFor(profile, p);
  return systemPrompt({
    p, userText: message, summary: '', client, profile,
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
  const org = require('./organization');
  const session = sessionId ? org.session(sessionId) : null;
  const profile = session ? org.profileFor(session) : null;
  const p = turnParams(profile);
  const disabled = disabledFor(profile, p);
  const schemas  = tools.schemas(disabled);

  const measure = (name, text, note) => ({
    name, note: note || null,
    chars: (text || '').length,
    tokens: budget.estimate(text || ''),
  });

  // What `turn()` will actually send: the same helper the turn and the panel
  // use, so this reading cannot claim a block the request does not carry.
  // `measure` drops an empty section, so a specialist needs no branch here.
  const missionsBlock = missionsFor(sessionId);

  const sections = profile ? [
    measure('conversation prompt', systemPrompt({ p, userText: message, summary: session.summary, client, profile,
      toolCount: schemas.length, disabledCount: disabled.length }), `${session.kind} profile; includes the safety charter`),
    measure('organization', org.block(session.id, org.notices(session.id).slice(0, 10)), 'briefs and unread reports, after history'),
    measure('missions', missionsBlock, 'paused and finished missions, after history'),
    measure('limits', budget.block(p)),
    measure('readings', environment.live()),
  ] : [
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
    measure('limits', budget.block(p)),
    measure('settings proposals', settings.block()),
    measure('missions', missionsBlock, 'paused and finished missions, after history'),
    // Sent after the history rather than in the system message, so it is
    // measured here but ordered last in the request. Same cost either way: it
    // is re-sent on every step. See liveBlock() and ISSUES.md H-9.
    measure('readings', environment.live(), 'clock, load, uptime — after the history'),
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
    // Counted with the echo, because the echo is part of what gets sent: a
    // conversation with a thinking model is measurably larger than its visible
    // text, and this reading exists to explain exactly that kind of gap.
    tokens: budget.estimateMessages(toApiMessages(rows.slice(-(Number(p.historyTurns) || 0)),
      { sessionId: sessionId || memory.activeSession()?.id, provider: p.provider })),
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
/**
 * The prompt size of the last step in this conversation, or 0.
 *
 * Read off the stored assistant rows rather than kept in memory: the ledger
 * belongs to one turn and is gone when it ends, while the question "how full
 * is this session's window" outlives the process that answered it.
 */
function lastPromptOf(sessionId) {
  try {
    const id = sessionId || memory.mainSession().id;
    const rows = memory.messages(id);
    for (let i = rows.length - 1; i >= 0; i--) {
      const n = Number(rows[i]?.usage?.prompt);
      if (rows[i].role === 'assistant' && Number.isFinite(n) && n > 0) return n;
    }
  } catch { /* a session that cannot be read is one with no context to report */ }
  return 0;
}

/** How full one conversation's window is, and where it folds. Cheap: no network. */
function contextOf(sessionId) {
  const org = require('./organization');
  return budget.context(turnParams(sessionId ? org.profileFor(org.session(sessionId)) : null),
    lastPromptOf(sessionId));
}

async function status({ sessionId } = {}) {
  const org = require('./organization');
  const p = turnParams(sessionId ? org.profileFor(org.session(sessionId)) : null);
  const out = { provider: p.provider, model: p.model || null, ready: false, reachable: false, error: null };
  // How full the window is, before anything is sent. A conversation's context
  // is a standing fact about it, not something that exists only while a turn
  // is running — a panel opened on an old session would otherwise have to send
  // a message to find out how much room it has left. Null when no window is
  // declared, which is `budget.context`'s way of saying nobody has said.
  out.context = contextOf(sessionId);
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

module.exports = { turn, isRunning, cancel, status, contextOf, params, ask, complete, preview, breakdown, liveBlock, events,
  toApiMessages, rungsFor, markDegraded, forgetDegraded, openingHop, missionsFor, DEGRADED_MS };

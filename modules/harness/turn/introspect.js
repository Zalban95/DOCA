'use strict';

/**
 * Looking at a turn without running one: the prompt it would send, its
 * breakdown by part, and a session's context and status.
 */

const budget      = require('../budget');
const environment = require('../environment');
const memory      = require('../memory');
const providers   = require('../providers');
const settings    = require('../settings');
const tools       = require('../tools');

const { turnParams } = require('./params');
const { clientBlock, placeBlock } = require('./client');
const { disabledFor, memoryBlock, missionsFor, rulesBlock, systemPrompt } = require('./prompt');
const { toApiMessages } = require('./messages');

function preview({ message = '', client = null, profile = null, sessionId = null } = {}) {
  if (sessionId) profile = require('../organization').profileFor(require('../organization').session(sessionId));
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
  const org = require('../organization');
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
  const org = require('../organization');
  return budget.context(turnParams(sessionId ? org.profileFor(org.session(sessionId)) : null),
    lastPromptOf(sessionId));
}

async function status({ sessionId } = {}) {
  const org = require('../organization');
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

module.exports = { preview, breakdown, contextOf, status };

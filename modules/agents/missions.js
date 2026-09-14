'use strict';

/**
 * A mission: one specialist doing one errand, in the background.
 *
 * The rule this exists to satisfy is that the user keeps talking to the
 * orchestrator while a mission runs. That rules out the obvious
 * implementation — a nested turn — because `_running` allows one turn per
 * conversation and the orchestrator would be blocked for the mission's whole
 * duration. A mission is therefore a **turn in its own session**, wrapped so
 * the caller does not wait for it: dispatch returns an id immediately.
 *
 * ── Why the state is stored this way ──────────────────────────────────────
 *
 * One document per mission, plus a small index. Not one file holding every
 * mission — that rewrites the whole file on each update and lets two running
 * missions race a read-modify-write, which is the exact disease `store.js`
 * exists to avoid. And not one file per agent either: a mission belongs to the
 * mission, the roster is user-editable, and deleting an agent must not delete
 * the history of what it did.
 *
 * The index is what a progress bar renders from — small, one writer, cheap to
 * poll. Live progress goes on the harness event stream instead, the same split
 * the rest of the panel uses: ephemeral for what is happening, durable for what
 * happened.
 */
const crypto = require('crypto');

const store = require('../store');
const agent = require('../harness/agent');
const memory = require('../harness/memory');
const registry = require('./registry');

const INDEX = 'agents/missions';
const MAX_INDEX = 200;
/** A mission's own event log, one per mission, so concurrent ones never race. */
const logFor = id => `agents/mission-${id}`;

/* ── Index ────────────────────────────────────────────── */

function loadIndex() {
  const doc = store.readJson(INDEX, { missions: [] });
  return Array.isArray(doc.missions) ? doc.missions : [];
}

function saveIndex(rows) {
  store.writeJson(INDEX, { missions: rows.slice(-MAX_INDEX) });
}

function get(id) { return loadIndex().find(m => m.id === id) || null; }

function list({ state, chainId, limit = 50 } = {}) {
  return loadIndex()
    .filter(m => (!state || m.state === state) && (!chainId || m.chainId === chainId))
    .slice(-limit)
    .reverse();
}

/** Missions still going, which is what a progress indicator draws. */
function running() { return list({ state: 'running', limit: MAX_INDEX }); }

function patch(id, fields) {
  const rows = loadIndex();
  const row = rows.find(m => m.id === id);
  if (!row) return null;
  Object.assign(row, fields);
  saveIndex(rows);
  return row;
}

/* ── Running one ──────────────────────────────────────── */

/** The profile the runner narrows the prompt and tool list with. */
function profileOf(def) {
  return {
    id: def.id,
    label: def.label,
    systemPrompt: def.role,
    tools: def.tools,
    memory: def.memory,
    environment: def.environment,
    provider: def.provider,
    model: def.model,
    maxSteps: def.maxSteps,
    maxTokens: def.maxTokens,
    contextWindow: def.contextWindow,
  };
}

/**
 * Start a mission. Returns as soon as it is accepted — never awaits the work.
 *
 * `context` is the orchestrator's job: a specialist sees the task and whatever
 * the orchestrator chose to hand over, and nothing else. That is the point of
 * the arrangement, not a limitation of it.
 */
function dispatch({ agentId, task, context, by, chainId } = {}) {
  if (!registry.enabled())
    throw Object.assign(new Error(
      'Specialist agents are switched off (agents.enabled). Ask the user to turn them on.'), { status: 409 });

  const def = registry.get(agentId);
  if (!def) throw Object.assign(new Error(
    `No agent called "${agentId}". Available: ${registry.list().map(a => a.id).join(', ') || 'none'}`),
  { status: 404 });
  if (def.broken) throw Object.assign(new Error(
    `The definition for "${agentId}" cannot be read: ${def.broken}`), { status: 400 });

  const text = String(task || '').trim();
  if (!text) throw Object.assign(new Error('A mission needs a task.'), { status: 400 });

  const id = `msn_${crypto.randomBytes(6).toString('hex')}`;
  // Its own conversation, so the orchestrator's is not held by `_running` and
  // the two transcripts never interleave.
  const session = memory.createSession(`${def.label}: ${text.slice(0, 40)}`);

  const row = {
    id, agentId, label: def.label,
    task: text.slice(0, 2000),
    sessionId: session.id,
    state: 'running',
    by: by || null,
    chainId: chainId || null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    steps: 0, tokens: 0,
    result: null, error: null,
  };
  saveIndex([...loadIndex(), row]);

  const message = context
    ? `${text}\n\n## Context from the orchestrator\n${String(context).slice(0, 20000)}`
    : text;

  // Deliberately not awaited: dispatch returns, the orchestrator's turn ends,
  // and the user keeps typing.
  agent.turn({ message, sessionId: session.id, profile: profileOf(def), emit: evt => record(id, evt) })
    .then(r => {
      patch(id, {
        state: 'done', endedAt: new Date().toISOString(),
        steps: r.steps, tokens: r.usage?.totalTokens || 0,
        result: String(r.text || '').slice(0, 20000),
      });
    })
    .catch(e => {
      patch(id, {
        state: e?.name === 'AbortError' ? 'cancelled' : 'failed',
        endedAt: new Date().toISOString(),
        error: String(e?.message || e).slice(0, 600),
      });
    });

  return row;
}

/**
 * One event from a mission's turn.
 *
 * Text deltas are dropped: a mission's running commentary is not something
 * anybody reads, and the whole answer lands on the index when it finishes.
 * What is kept is the shape of the work — which tools ran, and what it cost.
 */
function record(id, evt) {
  try {
    if (!evt || evt.type === 'text' || evt.type === 'session') return;
    if (evt.type === 'usage') {
      patch(id, { steps: evt.step, tokens: evt.totalTokens || 0 });
      return;
    }
    store.appendJsonl(logFor(id), { at: new Date().toISOString(), ...evt });
  } catch { /* a mission's bookkeeping must never break the mission */ }
}

/** A mission's own event log, for a panel that wants to show the working. */
function events(id, { limit = 200 } = {}) {
  try { return store.readJsonl(logFor(id)).slice(-limit); } catch { return []; }
}

/* ── The prompt block ─────────────────────────────────── */

/**
 * What the orchestrator is told about its own missions.
 *
 * Finished ones are named but not spelled out: the result can be long, and the
 * orchestrator reads it deliberately with `agent_results` rather than having
 * every mission it ever ran pasted into every prompt. A chain is called out
 * because its completion is the thing worth acting on.
 */
function block() {
  if (!registry.enabled()) return '';
  const rows = list({ limit: 12 });
  if (!rows.length) return '';

  const out = ['# Missions'];
  for (const m of rows) {
    if (m.state === 'running') {
      out.push(`- ${m.id} (${m.label}): running, step ${m.steps} — "${m.task.slice(0, 80)}"`);
    } else {
      out.push(`- ${m.id} (${m.label}): ${m.state}${m.error ? ` — ${m.error}` : ''}`
        + `${m.state === 'done' ? ' — read it with agent_results' : ''}`);
    }
  }
  if (rows.some(m => m.state === 'running'))
    out.push('A running mission is not blocking you. Carry on with the user; its answer will be here '
      + 'when you next look.');
  return out.join('\n');
}

function _reset() { store.writeJson(INDEX, { missions: [] }); }

module.exports = { dispatch, get, list, running, events, block, patch, _reset };

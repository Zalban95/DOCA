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

/**
 * Tell the user's devices what a mission is doing.
 *
 * A mission is the one thing here that runs with nobody watching — the whole
 * point is that the user walks away — and until now the only place it appeared
 * was a bar in the panel that polls every three seconds. A phone in a pocket
 * could not know a mission had finished. The audience is `harness:chat`, the same
 * one `agent.turn` goes to: a device that follows the conversation is the device
 * that should hear about work the conversation started.
 *
 * `ephemeral` for the step ticks, durable for the state changes, so the queue a
 * sleeping watch drains holds "started" and "done" and not four hundred steps.
 */
function announce(row, { ephemeral = false } = {}) {
  if (!row) return;
  try {
    const devices = require('../api-v1/devices');
    const bus     = require('../api-v1/bus');
    const { hasScope } = require('../api-v1/scopes');
    const payload = {
      missionId: row.id, agentId: row.agentId, label: row.label,
      task: String(row.task || '').slice(0, 200),
      state: row.state, steps: row.steps || 0, tokens: row.tokens || 0,
      startedAt: row.startedAt, endedAt: row.endedAt,
      result: row.result ? String(row.result).slice(0, 600) : undefined,
      error: row.error || undefined,
    };
    for (const d of devices.list()) {
      if (d.revokedAt || !hasScope(d.scopes, 'harness:chat')) continue;
      bus.publish(d.id, 'agent.mission', payload, ephemeral ? { cls: 'ephemeral' } : undefined);
    }
  } catch { /* a mission's bookkeeping must never break the mission */ }
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
  announce(row);

  const message = context
    ? `${text}\n\n## Context from the orchestrator\n${String(context).slice(0, 20000)}`
    : text;

  run(row, def, message);
  return row;
}

/**
 * The turn itself. Deliberately not awaited: dispatch returns, the
 * orchestrator's turn ends, and the user keeps typing. `base` is what a paused
 * mission had already spent, so a resumed one reports its whole cost.
 */
function run(row, def, message, base = { steps: 0, tokens: 0 }) {
  const { id } = row;
  agent.turn({ message, sessionId: row.sessionId, profile: profileOf(def), emit: evt => record(id, evt, base) })
    .then(r => {
      announce(patch(id, {
        state: 'done', endedAt: new Date().toISOString(),
        steps: base.steps + (r.steps || 0), tokens: base.tokens + (r.usage?.totalTokens || 0),
        result: String(r.text || '').slice(0, 20000),
      }));
    })
    .catch(e => {
      announce(patch(id, {
        state: e?.name === 'AbortError' ? 'cancelled' : 'failed',
        endedAt: new Date().toISOString(),
        error: String(e?.message || e).slice(0, 600),
      }));
    });
}

/* ── A restart ────────────────────────────────────────── */

/**
 * Missions the last process was running when it stopped.
 *
 * The turn was a promise in a process that no longer exists, so without this a
 * row says `running` forever — `agent_results` tells the orchestrator to ask
 * again later, and the panel bar polls every 3 s for the rest of the day.
 *
 * It is **paused, not failed**. The work done so far is still in the mission's
 * session, and whether it is worth finishing is the user's call: the
 * orchestrator reports it and asks on whichever turn comes first, from whichever
 * device (see `block()`), and `resume()` does what they answer. Called once at
 * startup, before anything can dispatch — never while a mission could really be
 * running.
 */
function recover() {
  const rows = loadIndex();
  const stuck = rows.filter(m => m.state === 'running');
  if (!stuck.length) return [];
  const at = new Date().toISOString();
  for (const m of stuck) Object.assign(m, { state: 'paused', pausedAt: at });
  saveIndex(rows);
  for (const m of stuck) {
    console.warn(`[agents] mission ${m.id} (${m.label}) paused by a restart at step ${m.steps}`);
    announce(m);
  }
  return stuck;
}

/**
 * The user's answer to "carry on?". Only a paused mission can be resumed, and it
 * resumes in its own session, so the specialist reads what it already did
 * instead of starting the errand over.
 */
function resume(id, { go } = {}) {
  const row = get(id);
  if (!row) throw Object.assign(new Error(`No mission called "${id}".`), { status: 404 });
  if (row.state !== 'paused')
    throw Object.assign(new Error(`${id} is ${row.state}, not paused — there is nothing to resume.`), { status: 409 });

  if (!go) {
    const dropped = patch(id, {
      state: 'cancelled', endedAt: new Date().toISOString(),
      error: 'paused by a restart; the user chose not to continue',
    });
    announce(dropped);
    return dropped;
  }

  if (!registry.enabled())
    throw Object.assign(new Error('Specialist agents are switched off (agents.enabled).'), { status: 409 });
  const def = registry.get(row.agentId);
  if (!def || def.broken) throw Object.assign(new Error(
    `The "${row.agentId}" agent ${def ? 'cannot be read' : 'no longer exists'}, so ${id} cannot resume.`), { status: 409 });

  const resumed = patch(id, { state: 'running', resumedAt: new Date().toISOString() });
  announce(resumed);
  run(resumed, def,
    `The panel restarted while you were on this errand, after step ${row.steps}. What you already did is `
      + `above. Carry on from there; do not redo finished work.\n\nThe errand: ${row.task}`,
    { steps: row.steps || 0, tokens: row.tokens || 0 });
  return resumed;
}

/**
 * One event from a mission's turn.
 *
 * Text deltas are dropped: a mission's running commentary is not something
 * anybody reads, and the whole answer lands on the index when it finishes.
 * What is kept is the shape of the work — which tools ran, and what it cost.
 */
function record(id, evt, base = { steps: 0, tokens: 0 }) {
  try {
    if (!evt || evt.type === 'text' || evt.type === 'session') return;
    if (evt.type === 'usage') {
      announce(patch(id, { steps: base.steps + evt.step, tokens: base.tokens + (evt.totalTokens || 0) }),
        { ephemeral: true });
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
    if (m.state === 'paused') {
      out.push(`- ${m.id} (${m.label}): PAUSED by a restart at step ${m.steps}, ${m.tokens} tokens spent — "${m.task.slice(0, 80)}"`);
    } else if (m.state === 'running') {
      out.push(`- ${m.id} (${m.label}): running, step ${m.steps} — "${m.task.slice(0, 80)}"`);
    } else {
      out.push(`- ${m.id} (${m.label}): ${m.state}${m.error ? ` — ${m.error}` : ''}`
        + `${m.state === 'done' ? ' — read it with agent_results' : ''}`);
    }
  }
  // ponytail: "don't ask twice" is per conversation and trusts the model; a
  // second device writing first in another conversation gets asked too. Record
  // an askedAt when that turns out to nag.
  if (rows.some(m => m.state === 'paused'))
    out.push('A PAUSED mission was cut off by a restart and is waiting on the user. Before anything else in '
      + 'your reply, tell them in one line what it was doing and how far it got, and ask one short question: '
      + 'continue it? Then call agent_resume with their answer. Never resume without a yes, and if you have '
      + 'already asked in this conversation, do not ask again.');
  if (rows.some(m => m.state === 'running'))
    out.push('A running mission is not blocking you. Carry on with the user; its answer will be here '
      + 'when you next look.');
  return out.join('\n');
}

function _reset() { store.writeJson(INDEX, { missions: [] }); }

module.exports = { dispatch, recover, resume, get, list, running, events, block, patch, _reset };

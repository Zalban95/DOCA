'use strict';

/**
 * Mastermind and worker: which model answers each step of a turn (owner's green light 2026-10-16, improvement D1).
 *
 * Measured 2026-10-16: DOCA on a quick, cheap model was 3.5–7× cheaper than a frontier model on the same craft task and
 * finished alone, but its judgement — the layout of a drawing, the look of a video, catching its own flaws — was weaker.
 * Judgement is a few steps of a turn; most steps carry out what was decided. So two settings, both empty by default
 * (empty = the harness's model for every step, exactly as before):
 *
 *   harness.models.mastermind   provider/model — plans, routes, re-plans and reviews
 *   harness.models.worker       provider/model — carries out the steps
 *
 * The rule is mechanical — no model is asked which model to ask — and reads only the turn's own rows:
 *   · the Orchestrator: every step is the mastermind's (it routes and decides; the work moves to work chats);
 *   · a specialist (a mission, a team member): every step is the worker's;
 *   · any other conversation (a work chat, a person's chat, a project's chat):
 *       – step 1 → mastermind (reading the request and planning it);
 *       – a step after a call that plans or coordinates (PLANNING: work_plan — a step marked done, the plan revised —
 *         mission_plan, agent_dispatch, agent_results, work_chats, team…) → mastermind: deciding what comes next, and,
 *         after the plan's last step is marked done, the review and the final answer;
 *       – a step after a call that failed (the row's `failure`, turn/failures.js) → mastermind: a re-plan;
 *       – every other step after tool results → worker: carrying out the plan.
 * It does not route at all — the turn's own model answers every step, as before — when the person chose a model for
 * the conversation (`session.modelChoice`, and a stuck job's escalation, which sets it), when a specialist's
 * definition names its own model, or on a spoken turn (a call keeps assistant mode's quick model, turn/front.js).
 *
 * A role's model is held to the same rules as the turn's: only when allotted to the person (auth/allot.js), only when
 * priced under a money budget (spending.priced), and the harness's order — its model, then its fallback chain, already
 * narrowed — follows it as the fallback chain, so a mastermind that stops answering hops to the harness's model.
 * Its context window is the one declared for it in that order, else none (the per-step ceiling, turn/step-ceiling.js,
 * does not depend on it). Each step's `step` event, trace span (`doca.role`) and usage row (kind `step:<role>`) say
 * which role it ran as.
 */
const ROLES = ['mastermind', 'worker'];
const PLANNING = new Set(['work_plan', 'mission_plan', 'agent_dispatch', 'agent_results', 'agent_resume', 'work_chats', 'team', 'team_note']);

/** `provider/model` → { provider, model }, or null. The provider is everything before the first slash. */
function parse(v) {
  const s = String(v || '').trim(), i = s.indexOf('/');
  return i > 0 && i < s.length - 1 ? { provider: s.slice(0, i).trim(), model: s.slice(i + 1).trim() } : null;
}

/** The model set for a role, or null. */
function modelFor(role) {
  try { return parse(require('../../settings-schema').value(`harness.models.${role}`)); } catch { return null; }
}

/** Whether a turn is routed at all: something is set, and nothing more specific chose its model. */
function routed({ profile, session, client }) {
  if (!ROLES.some(modelFor)) return false;
  if (session?.modelChoice?.model) return false;                     // the person's choice (or an escalation) wins
  if (profile && profile.level !== 'orchestrator' && (profile.model || profile.provider)) return false;   // a definition's own model
  if (client?.front || require('./effort').spokenProfile(client)) return false;   // a call keeps its quick model
  return true;
}

/** The rows of the step before this one: its assistant row's calls, and their results. */
function lastStep(rows) {
  let i = rows.length - 1;
  const results = [];
  while (i >= 0 && rows[i].role === 'tool') results.push(rows[i--]);
  const call = rows[i]?.role === 'assistant' && rows[i].tool_calls?.length ? rows[i] : null;
  return { calls: (call?.tool_calls || []).map(c => c.function?.name).filter(Boolean), results };
}

/**
 * Which role step `step` runs as, or null when the turn is not routed.
 * @param {{ profile, session, client, step: number, rows?: object[] }} o  `rows`: the conversation's rows so far
 */
function roleOf({ profile, session, client, step, rows = [] }) {
  if (!routed({ profile, session, client })) return null;
  if (profile?.level === 'orchestrator' || session?.kind === 'orchestrator') return 'mastermind';
  if (profile || session?.kind === 'specialist') return 'worker';
  if (step <= 1) return 'mastermind';
  const last = lastStep(rows);
  if (!last.calls.length) return 'mastermind';   // no tool result to carry on from (a claim check's note, a queued message)
  if (last.calls.some(n => PLANNING.has(n))) return 'mastermind';
  if (last.results.some(r => r.failure || require('./failures').classify(r.content))) return 'mastermind';
  return 'worker';
}

const same = (a, b) => a && b && a.provider === b.provider && a.model === b.model;

/**
 * The step's parameters for `role`: the turn's own `p` when the role has no model, or its model is not allotted or not
 * priced; else that model first and the harness's order after it. Always marked with `_role` when a role was decided.
 */
function paramsFor(role, p, { person, sessionId } = {}) {
  if (!role) return p;
  const target = modelFor(role);
  if (!target || same(target, p)) return { ...p, _role: role };
  if (person?.id && !require('../../auth/allot').allowsModel(person, target)) return { ...p, _role: role, _roleSkipped: 'not allotted' };
  const order = require('./choice').order(p);
  const at = order.findIndex(e => same(e, target));
  let next = {
    ...p, provider: target.provider, model: target.model, contextWindow: at >= 0 ? order[at].contextWindow : 0,
    _windowSetting: at > 0 ? `harness.config.doca.fallbackChain[${at - 1}].contextWindow` : `none declared for harness.models.${role}`,
    fallbackChain: order.filter(e => !same(e, target)), _role: role,
  };
  try { next = require('../../spending').priced({ person, sessionId }, next); }
  catch { return { ...p, _role: role, _roleSkipped: 'no price under a money budget' }; }
  try { next = require('../provider-pace').apply(next); } catch { /* a pace is a refinement */ }
  return next;
}

/** The step's model: its parameters, its endpoint and its role (null when the turn is not routed). `rows` may be a function. */
function step({ p, ep, profile, session, client, step: n, rows }) {
  const role = routed({ profile, session, client }) ? roleOf({ profile, session, client, step: n, rows: typeof rows === 'function' ? rows() : rows }) : null;
  if (!role) return { p, ep, role: null };
  const sp = paramsFor(role, p, { person: client?.user, sessionId: session?.id });
  return { p: sp, ep: sp.provider === p.provider ? ep : require('../providers').endpoint(sp.provider), role };
}

/** One line for `# Your limits`-style readers and the features index: what is set. */
function describe() {
  const m = modelFor('mastermind'), w = modelFor('worker');
  if (!m && !w) return null;
  const n = e => (e ? `${e.provider}/${e.model}` : 'the harness\'s model');
  return `mastermind ${n(m)} (plans, routes, reviews); worker ${n(w)} (carries out steps)`;
}

module.exports = { ROLES, PLANNING, parse, modelFor, routed, roleOf, paramsFor, step, describe };

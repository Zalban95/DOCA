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
 * Its context window is found as the harness's is (windowOf: `harness.models.<role>Window`, the window declared for it
 * in that order, a local server's measurement, what its server reports), and the per-step ceiling and a fresh tool
 * result are held to a share of it (turn/step-ceiling.js) — a small worker never gets a request sized for a large
 * mastermind. Folds (the rolling summary) are the worker's when one is set (forFold).
 * A work chat's final answer stays with whichever role's step finishes it — no extra mastermind call (owner, 2026-10-16).
 * Not wired yet: a tie between best-of-n's tries broken by the mastermind — `tries.onTie` is not on main. Each step's `step` event, trace span (`doca.role`) and usage row (kind `step:<role>`) say
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
const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/**
 * A role model's window, found the way the harness's is: its own declared setting first, then the window declared for it
 * in the harness's order, then (provider-pace.apply, below) a local server's kept measurement, then what its server
 * reported (context-window.js, cached). 0 when nobody has said — the old rule.
 */
function windowOf(role, order, at, p) {
  const declared = num(settingOf(`harness.models.${role}Window`));
  if (declared) return { contextWindow: declared, _windowSetting: `harness.models.${role}Window` };
  if (at >= 0 && num(order[at].contextWindow))
    return { contextWindow: order[at].contextWindow, _windowSetting: at > 0 ? `harness.config.doca.fallbackChain[${at - 1}].contextWindow` : p._windowSetting };
  return { contextWindow: 0, _windowSetting: `harness.models.${role}Window` };
}
const settingOf = key => { try { return require('../../settings-schema').value(key); } catch { return 0; } };

/** What its server reported, when nothing was declared and no measurement was kept (cached; never waited on here). */
function reported(next) {
  if (num(next.contextWindow)) return next;
  const w = require('../context-window').known(next.provider, next.model);
  return w?.tokens ? { ...next, contextWindow: w.tokens, _windowSetting: `${next._windowSetting} (0: ${w.source})` } : next;
}

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
    ...p, provider: target.provider, model: target.model, ...windowOf(role, order, at, p),
    fallbackChain: order.filter(e => !same(e, target)), _role: role,
  };
  try { next = require('../../spending').priced({ person, sessionId }, next); }
  catch { return { ...p, _role: role, _roleSkipped: 'no price under a money budget' }; }
  try { next = require('../provider-pace').apply(next); } catch { /* a pace is a refinement */ }
  return reported(next);
}

/** Ask a role model's server for its window when nothing is known yet, waiting at most `ms` (the answer is cached). */
async function warm(role, ms = 1500) {
  const t = modelFor(role);
  if (!t || num(settingOf(`harness.models.${role}Window`)) || require('../context-window').known(t.provider, t.model)) return;
  const asked = require('../context-window').discover(t.provider, t.model).catch(() => null);
  await Promise.race([asked, new Promise(r => { const h = setTimeout(r, ms); h.unref?.(); })]);
}

/** The step's model: its parameters, its endpoint and its role (null when the turn is not routed). `rows` may be a function. */
async function step({ p, ep, profile, session, client, step: n, rows }) {
  const role = routed({ profile, session, client }) ? roleOf({ profile, session, client, step: n, rows: typeof rows === 'function' ? rows() : rows }) : null;
  if (!role) return { p, ep, role: null };
  await warm(role);
  const sp = paramsFor(role, p, { person: client?.user, sessionId: session?.id });
  return { p: sp, ep: sp.provider === p.provider ? ep : require('../providers').endpoint(sp.provider), role };
}

/**
 * The model a fold (the rolling summary) is asked of: the worker when one is set and may be used for this person, else
 * the turn's own (owner's decision 2026-10-16: housekeeping goes to the worker). A person's choice of model for the chat
 * does not change it — a summary is not an answer.
 */
function forFold({ p, ep, person, sessionId }) {
  const target = modelFor('worker');
  if (!target || same(target, p)) return { p, ep };
  const sp = paramsFor('worker', p, { person, sessionId });
  if (sp._roleSkipped || !same(sp, target)) return { p, ep };
  try { return { p: sp, ep: require('../providers').endpoint(sp.provider) }; } catch { return { p, ep }; }
}

/** One line for `# Your limits`-style readers and the features index: what is set. */
function describe() {
  const m = modelFor('mastermind'), w = modelFor('worker');
  if (!m && !w) return null;
  const n = e => (e ? `${e.provider}/${e.model}` : 'the harness\'s model');
  return `mastermind ${n(m)} (plans, routes, reviews); worker ${n(w)} (carries out steps)`;
}

module.exports = { ROLES, PLANNING, parse, modelFor, routed, roleOf, paramsFor, windowOf, warm, step, forFold, describe };

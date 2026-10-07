'use strict';

/**
 * Important and safety switches ask for the password, every time (CONSTITUTION S14, 2026-10-07; TODO P1.11).
 *
 * A recent sign-in (the 12 h step-up) is not enough for these: whoever changes how much the agents may do, who may
 * do what, or what is kept as evidence, types the password for that change. The panel sends it with the request
 * (`X-Doca-Password`, over the panel's own HTTPS, never stored or logged); without it the gate answers 401
 * `password_required` naming the switch, and the panel asks and sends the request again (public/js/lib/api.js).
 *
 * What is guarded is this file:
 *   ROUTES  a route that is a switch, with a `when` for routes that are one only for some bodies
 *   PREFS   settings paths that are switches, wherever a write of them comes from: POST /api/prefs, applying a
 *           proposal, restoring a checkpoint — and never applied by an agent alone (settings_propose's `asked` and
 *           Unattended leave them a proposal: toolbox/settings.js)
 * Spending (S12; docs/design/spending.md) is in ROUTES: its rules are not settings but a protected file
 * (keys/spending.json), changed only by /api/spending/*; the price list money budgets are counted in is in both, once
 * a money budget exists.
 */
const W = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Settings that are switches. A path guards everything under it. */
const PREFS = [
  ['harness.approval', 'the approval mode'],
  ['agents.enabled', 'the specialists switch'],
  ['developer', 'developer mode and releasing'],
  ['experiments', 'an experiment'],
  ['sharing', 'sharing with the project'],
  ['network', 'how the hub listens'],
  ['tracing', 'what is kept of each turn'],
  ['logs', 'what is kept of what happened'],
  ['usagePrices', 'the prices money budgets are counted in', () => moneyBudgets()],
];

/** Whether any money budget exists: only then do the prices decide whether a turn starts (spending/budgets.js). */
function moneyBudgets() {
  const d = require('../spending/store').load();
  return [...Object.values(d.people).flatMap(p => [p.own, p.budget]), ...Object.values(d.levels).map(l => l.budget)]
    .some(b => b && (b.moneyPerDay || b.moneyPerMonth));
}

const get = (o, dotted) => dotted.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
// Absent and empty are the same setting: a panel posting back `{}` for a section never written changes nothing.
const norm = v => (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length ? null : v ?? null);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** The first guarded setting a {path: value} list of changes touches, or null. */
function prefsTouched(changes) {
  for (const { path, to, from } of changes) {
    if (same(to, from)) continue;
    const hit = PREFS.find(([p, , when]) => (path === p || path.startsWith(`${p}.`) || p.startsWith(`${path}.`)) && (!when || when()));
    if (hit) return hit[1];
  }
  return null;
}

/** POST /api/prefs merges top-level keys: a guarded path whose value the body would change. */
function prefsBody(body) {
  if (!body || typeof body !== 'object') return null;
  const stored = require('../utils').loadPrefs();
  const changes = PREFS.filter(([p]) => p.split('.')[0] in body)
    .map(([p]) => ({ path: p, from: get(stored, p), to: get(require('../secrets-mask').unmask(body, stored), p) }));
  return prefsTouched(changes);
}

/**
 * Applying a proposal: each change's `to` against the LIVE setting, never the proposal's stored `from` — a stored file
 * can be edited, and a `from` written equal to its `to` would read as "no change" (security review 2026-10-07).
 */
function proposal(id) {
  const p = require('../harness/settings').find(id);
  if (!p || p.screen) return null;   // a screen's own layer is not a switch
  const live = require('../utils').loadPrefs();
  return prefsTouched(p.changes.map(c => ({ path: c.path, from: get(live, c.path), to: c.to })));
}

const ROUTES = [
  [['POST'], /^\/api\/harness\/approval$/, 'the approval mode'],
  [['DELETE'], /^\/api\/harness\/approval\/always\/.+$/, 'the always-allowed list'],
  [['POST'], /^\/api\/harness\/sessions\/[^/]+\/settings$/, 'a conversation\'s approval switch', req => req.body?.approval !== undefined],
  [['POST'], /^\/api\/harness\/agents\/enable$/, 'the specialists switch'],
  [['POST'], /^\/api\/experiments\/.+$/, 'developer mode or an experiment'],
  [['POST'], /^\/api\/developer\/releasing$/, 'who may release unasked'],
  [['POST'], /^\/api\/sharing$/, 'sharing with the project'],
  [['POST'], /^\/api\/network$/, 'how the hub listens'],
  [['POST'], /^\/api\/logs\/keep$/, 'what is kept of what happened'],
  [W, /^\/api\/auth\/(levels|grants)(\/.*)?$/, 'levels, reach and grants'],
  [W, /^\/api\/auth\/users(\/[^/]+)?$/, 'who has an account, and at what level'],
  [['POST'], /^\/api\/auth\/users\/[^/]+\/password$/, 'another person\'s password'],
  [W, /^\/api\/harness\/guards(?!\/test$)(\/.*)?$/, 'the guards'],
  [['POST'], /^\/api\/settings\/checkpoints\/[^/]+\/restore$/, 'restoring settings'],
  [['POST'], /^\/api\/backups\/[^/]+\/restore$/, 'restoring a backup'],   // it replaces the settings, guarded switches included
  // A version is every guard at once: one from before 2.281.0 has no password question at all (review 2026-10-07).
  [['POST'], /^\/api\/versions\/use$/, 'which version of DOCA runs'],
  // Bringing a pack in can create or replace a level (an edition), specialists and their tools, and the memory rules.
  // An upload cannot be read before the gate, so every import asks: the smallest rule that holds for both routes.
  [['POST'], /^\/api\/packs\/(import|library\/[^/]+\/import)$/, 'bringing a pack in (it can carry a level, specialists and rules)'],
  // Spending (S12): budgets, permissions and their acceptance; declining a proposal never asks — saying no is free.
  [W, /^\/api\/spending\/(?!permissions\/[^/]+\/decline$).+$/, 'spending: budgets and permissions'],
  [['POST'], /^\/api\/harness\/usage\/prices$/, 'the prices money budgets are counted in', () => moneyBudgets()],
  [['POST'], /^\/api\/prefs$/, null, req => prefsBody(req.body)],
  [['POST'], /^\/api\/harness\/proposals\/[^/]+\/apply$/, null, req => proposal(req.path.split('/')[4])],
];

/** What switch this request flips — a phrase for the question — or null when it flips none. */
function switchOf(req, p = req.path.toLowerCase().replace(/\/+$/, '')) {
  for (const [methods, re, what, when] of ROUTES) {
    if (!methods.includes(req.method) || !re.test(p)) continue;
    if (!when) return what;
    let hit; try { hit = when(req); } catch { hit = null; }
    if (hit) return what || hit;
  }
  return null;
}

module.exports = { PREFS, ROUTES, switchOf, prefsTouched };

'use strict';

/**
 * Resources are allocated (CONSTITUTION S13; the owner, 2026-10-07: "Resources are allocated to users by the admin —
 * not everything is everyone's — and the admin can let others, team leaders, grant specific permissions"; TODO P1.10).
 *
 * A resource is something a person's agents use that is not a tool: a model, a provider, a key for a service, a
 * connected account, a login the owner keeps (computer_login), an agents' computer. Who may use one:
 *   - anyone holding host (the machine's administrators), as before;
 *   - a level that lists it: `resources: { model: ['*' | '<provider>/<model>', …], provider: […], key: […],
 *     connector: […], login: […], computer: […] }` — a kind the level does not name keeps today's rule, so nothing changes for an
 *     install until an admin narrows a level;
 *   - a person or specialist with the grant `use:<kind>:<id>` (grants.js; '*' parts cover anything), given by an admin
 *     or by someone a level lets allot it (`delegates` on the level, permits.mayGrant);
 *   - for keys and connected accounts, also everyone when the owner opened that one to everyone (`who`).
 * No person on the turn (a test, a pre-accounts call) is not narrowed, as everywhere (permits.js).
 */
const KINDS = ['model', 'provider', 'key', 'connector', 'login', 'computer'];

/** Kinds that were an admin's alone before levels could list them: a level that names nothing gives none. */
const ADMIN_FIRST = new Set(['key', 'connector', 'login']);

const host = person => require('./rights').can(person?.role, 'host');
const match = (pattern, id) => pattern === '*' || pattern === id || (pattern.endsWith('*') && id.startsWith(pattern.slice(0, -1)));

/** May the person's agents use resource `id` of `kind`? `opened`: the owner opened this one to everyone. */
function uses(person, kind, id, { opened = false } = {}) {
  if (!person?.id || host(person) || opened) return true;
  id = String(id || '').toLowerCase();
  const L = require('./levels').get(person.role);
  const listed = L?.resources?.[kind];
  if (Array.isArray(listed) ? listed.some(p => match(String(p).toLowerCase(), id)) : !ADMIN_FIRST.has(kind)) return true;
  return require('./grants').holds([{ kind: 'user', id: person.id }], `use:${kind}:${id}`);
}

/** The sentence a refusal carries: what, and who could allot it. */
const refusal = (person, kind, id) =>
  `${person?.name || 'This person'}'s level does not have the ${kind} ${id} allotted — an admin (or a team leader allowed to allot it) gives it in Settings → Users.`;

/**
 * A turn's model, narrowed to what its person may use: the chosen model if allotted, else the first allotted one down
 * the harness's order (said in `_allotted`); none allotted refuses the turn with who could allot one.
 */
/** May the person's agents call this model — its provider and the model both allotted? */
const allowsModel = (person, e) => uses(person, 'provider', e.provider) && uses(person, 'model', `${e.provider}/${e.model}`);

function narrowModel(p, person) {
  if (!person?.id || host(person)) return p;
  const ok = e => allowsModel(person, e);
  const order = require('../harness/turn/choice').order(p);
  // The fallback chain is models too: a hop down it is a call to a model, so only allotted rungs stay (review 2026-10-07).
  if (ok({ provider: p.provider, model: p.model })) {
    const chain = (Array.isArray(p.fallbackChain) ? p.fallbackChain : []).filter(e => !e?.provider || ok({ provider: e.provider, model: e.model || p.model }));
    return chain.length === (p.fallbackChain || []).length ? p : { ...p, fallbackChain: chain };
  }
  const at = order.findIndex(ok);
  if (at < 0) throw Object.assign(new Error(refusal(person, 'model', `${p.provider}/${p.model}`) + ' No model in the harness\'s order is allotted to them.'), { status: 403, code: 'not_allotted' });
  const e = order[at];
  return { ...p, provider: e.provider, model: e.model, contextWindow: e.contextWindow || p.contextWindow, fallbackChain: order.slice(at + 1).filter(ok),
    _allotted: `${p.provider}/${p.model} is not allotted to ${person.name || 'this person'}; ${e.provider}/${e.model} is used instead.` };
}

/** A level's `resources` as stored: known kinds, lists of ids or patterns. */
function normalize(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const k of KINDS) {
    const v = input[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = [...new Set((Array.isArray(v) ? v : String(v).split(/[\n,]/)).map(s => String(s).trim()).filter(Boolean))].slice(0, 100);
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { KINDS, uses, allowsModel, narrowModel, refusal, normalize };

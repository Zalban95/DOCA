'use strict';

/**
 * What a person holds (CONSTITUTION S13; TODO P1.10): one read-only answer to "what may my agents use, and how much",
 * gathered from the places that decide it — never a second copy of any rule:
 *   level      its name, rights, approval and reach (levels.js, reach.js)
 *   resources  per kind (allot.js): the rule that applies (everything for a host; the level's list; else the old
 *              default), what grants add, and the concrete ones in use here that pass `allot.uses` — keys, accounts,
 *              logins, services, computers (whose.js), providers
 *   devices    their own paired devices, and others' lent to them (use:device:<id>)
 *   budget     the budget in effect and what was spent (spending/budgets.js), and their spending permissions
 *   grants     every exception given to them (grants.js)
 * Never a secret: names, ids and amounts only. `GET /api/auth/holdings` — your own; `?person=<id>` someone else's,
 * for whoever holds `users`.
 */
const allot = require('./allot');
const grants = require('./grants');
const levels = require('./levels');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const quiet = fn => { try { return fn(); } catch { return []; } };

/** Grants of `use:<kind>:…` (or `use:*:…`) to this person: the ids. */
const granted = (given, kind) => given.map(g => g.permission.split(':')).filter(([k, gk]) => k === 'use' && (gk === kind || gk === '*')).map(p => p.slice(2).join(':'));

/** The concrete resources of a kind here that this person's agents may use. */
function inUse(person, kind) {
  const ok = (id, opened = false) => allot.uses(person, kind, id, { opened });
  switch (kind) {
    case 'provider': return quiet(() => require('../harness/providers').list().filter(p => p.hasKey && ok(p.id)).map(p => p.id));
    case 'key':      return quiet(() => require('../service-keys').list().filter(k => ok(k.name, k.who === 'everyone')).map(k => k.name));
    case 'connector': {
      const vault = require('../connectors/vault');
      return quiet(() => Object.entries(vault.all()).filter(([id, r]) => r.accessToken && ok(id, r.who === 'everyone')).map(([id]) => id));
    }
    case 'login':    return quiet(() => require('../logins').list().filter(l => ok(l.id) || ok(l.label)).map(l => l.label));
    case 'vnc':      return quiet(() => require('../vnc-targets/store').list().filter(t => ok(t.id) || ok(t.name)).map(t => t.name));
    case 'service':  return quiet(() => require('../services').INFERENCE_SERVICES.filter(s => s.chat && ok(s.id)).map(s => s.id));   // those a turn can use
    case 'computer': return quiet(() => require('../computers').all().filter(c => !c.archivedAt && !require('../computers/whose').refuse(person, c.id)).map(c => c.id));
    default:         return [];   // models are patterns over every provider's list; devices are listed below
  }
}

function resources(person, given) {
  const L = levels.get(person.role);
  const host = require('./rights').can(person.role, 'host');
  return Object.fromEntries(allot.KINDS.map(kind => {
    const listed = Array.isArray(L?.resources?.[kind]) ? L.resources[kind] : null;
    const rule = host ? 'all' : listed ? 'listed' : allot.ADMIN_FIRST.has(kind) ? 'allotted' : 'all';
    return [kind, { rule, level: listed, granted: granted(given, kind), here: inUse(person, kind) }];
  }));
}

function devices(person) {
  const all = quiet(() => require('../api-v1/devices').list()).filter(d => !d.revokedAt);
  const view = d => ({ id: d.id, name: d.name, kind: d.kind || null });
  return {
    own: all.filter(d => d.userId === person.id).map(view),
    lent: all.filter(d => d.userId !== person.id && allot.uses(person, 'device', d.id) && !require('./rights').can(person.role, 'host')).map(view),
  };
}

async function spending(person) {
  const budgets = require('../spending/budgets'), permissions = require('../spending/permissions');
  let s = { budget: null, spent: null };
  try { s = await budgets.state(person); } catch { /* the ledger is unreadable: the budget alone */ s = { budget: budgets.effective(person), spent: null }; }
  const mine = quiet(() => permissions.list(person)).filter(p => p.personId === person.id)
    .map(p => ({ id: p.id, on: p.on, upTo: p.upTo, currency: p.currency, permanent: !!p.permanent, state: p.state, left: p.left }));
  return { budget: s.budget, spent: s.spent ? { today: s.spent.today, month: s.spent.month, currency: s.spent.currency } : null, permissions: mine };
}

/** Everything `person` ({ id, name, role, orgId }) holds. */
async function of(person) {
  const L = levels.get(person.role);
  const given = grants.forSubjects([{ kind: 'user', id: person.id }]);
  return {
    person: { id: person.id, name: person.name || '', email: person.email || '' },
    level: L ? { id: person.role, name: L.name, rights: L.rights, approval: L.approval, reach: L.reach || null, tools: L.tools } : { id: person.role, name: person.role, missing: true },
    resources: resources(person, given),
    devices: devices(person),
    spending: await spending(person),
    grants: given.map(g => ({ id: g.id, permission: g.permission, scope: g.scope, expiresAt: g.expiresAt, note: g.note })),
  };
}

/** The person a request asks about: the signed-in one, or (`users` only) anyone in their organisation. */
function personFor(req) {
  const client = require('../harness/turn/client');
  const me = client.personOf(req.auth);
  if (!me?.id) throw bad('Sign in first.', 401);
  const id = req.query.person ? String(req.query.person) : me.id;
  if (id === me.id) return { ...me, self: true };
  if (!require('./rights').can(me.role, 'users')) throw bad('What another person holds is for an admin (the users right) to see.', 403);
  const store = require('./store'), orgId = me.orgId || store.defaultOrg()?.id;
  const u = store.userById(id), m = u && orgId ? store.membership(orgId, id) : null;
  if (!u || !m) throw bad('No such person here.', 404);
  return client.personOf({ user: u, orgId, role: m.role });
}

function mount(app) {
  app.get('/api/auth/holdings', async (req, res) => {
    try { const p = personFor(req); res.json({ ...(await of(p)), self: !!p.self }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { of, mount, inUse };

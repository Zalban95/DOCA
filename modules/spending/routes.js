'use strict';

/**
 * Settings → Spending (CONSTITUTION S12; docs/design/spending.md): what was spent, the budgets and the spending
 * permissions. Everyone who chats sees their own and changes their own (within their level); an admin (`users`)
 * sees and changes everyone's and the levels' defaults. Every change asks for the password (auth/guarded.js) except
 * declining a proposal, and is audited.
 */
const budgets     = require('./budgets');
const permissions = require('./permissions');
const spent       = require('./spent');
const store       = require('./store');

const actorOf = req => require('../harness/turn/client').personOf(req.auth);
const isAdmin = actor => require('../auth/rights').can(actor?.role, 'users');
const finite = n => (Number.isFinite(n) ? n : null);   // Infinity (anything) reads as null: "no limit"

function audit(actor, action, detail) {
  try { require('../auth/store').audit({ actorId: actor?.id || null, action: `spending.${action}`, detail }); } catch { /* accounting must not break the change */ }
}

/** The page's whole view for this person: theirs, and everyone's for an admin. */
async function view(actor, month) {
  const d = store.load();
  const m = await spent.month(month || spent.monthOf());
  const today = new Date().toISOString().slice(0, 10);
  const row = (id, p = m.people[id] || { calls: 0, tokens: 0, money: 0, unpriced: 0, days: {} }) => {
    const { days, ...total } = p;
    return { ...total, today: days[today] || null, days };
  };
  const mine = { id: actor.id, name: actor.name, role: actor.role, ...row(actor.id),
    budget: budgets.effective(actor, d), own: d.people[actor.id]?.own || null, mayAllow: finite(permissions.mayAllow(actor, d)) };
  const out = { month: m.month, currency: m.currency, me: mine, admin: isAdmin(actor), permissions: permissions.list(actor, d), payment: require('./pay').status() };
  const authStore = require('../auth/store'), orgId = actor.orgId || authStore.defaultOrg()?.id;
  if (!out.admin) {
    // A team leader sees the people they set budgets for, with what they spent and the budget they set (budgets.leads).
    const team = authStore.listUsers().filter(u => budgets.leads(actor, u.id));
    if (team.length) {
      out.lead = true;
      out.people = team.map(u => {
        const person = { id: u.id, name: u.name || '', role: orgId ? authStore.membership(orgId, u.id)?.role : null };
        return { ...person, ...row(u.id), budget: budgets.effective(person, d), set: d.people[u.id]?.leader || null };
      });
    }
    return out;
  }
  out.people = authStore.listUsers().map(u => {
    const role = orgId ? authStore.membership(orgId, u.id)?.role : null;
    const person = { id: u.id, name: u.name || '', role };
    return { ...person, email: u.email, ...row(u.id), budget: budgets.effective(person, d), own: d.people[u.id]?.own || null, set: d.people[u.id]?.budget || null };
  });
  if (m.people[spent.NOBODY]) out.nobody = row(spent.NOBODY);
  out.levels = require('../auth/levels').list().map(L => ({ id: L.id, name: L.name || L.id, budget: d.levels[L.id]?.budget || null,
    mayAllow: d.levels[L.id]?.mayAllow ?? null, holdsHost: (L.rights || []).includes('host') }));
  return out;
}

function mount(app) {
  const h = fn => async (req, res) => {
    const actor = actorOf(req);
    if (!actor?.id) return res.status(401).json({ error: 'Sign in first.' });
    try { res.json(await fn(req, actor)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  app.get('/api/spending', h((req, actor) => view(actor, req.query.month ? String(req.query.month) : null)));
  app.post('/api/spending/budget', h((req, actor) => {
    const out = budgets.set(actor, req.body || {});
    const b = req.body || {};
    audit(actor, 'budget', b.levelId ? `level ${b.levelId}` : b.personId && b.personId !== actor.id ? `person ${b.personId}` : 'own');
    return out;
  }));
  app.post('/api/spending/permissions', h((req, actor) => {
    const p = permissions.create(actor, req.body || {});
    audit(actor, 'allow', `${p.id} ${p.on.kind} ${p.on.id} up to ${p.upTo}${p.permanent ? ' a month' : ' once'} for ${p.personId}`);
    return p;
  }));
  app.post('/api/spending/permissions/:id/accept', h((req, actor) => {
    const p = permissions.accept(actor, req.params.id, req.body || {});
    audit(actor, 'accept', `${p.id}${p.permanent ? ' (kept)' : ''}`);
    return p;
  }));
  app.post('/api/spending/permissions/:id/decline', h((req, actor) => { const p = permissions.decline(actor, req.params.id); audit(actor, 'decline', p.id); return p; }));
  app.delete('/api/spending/permissions/:id', h((req, actor) => { const p = permissions.revoke(actor, req.params.id); audit(actor, 'revoke', p.id); return p; }));
}

module.exports = { view, mount };

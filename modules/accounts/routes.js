'use strict';

/**
 * Your accounts (Field → Connectors → Your accounts), and what the everyday views read (the Focused view draws these):
 *
 *   GET    /api/accounts                          your accounts, the providers you may connect, the callback address
 *   POST   /api/accounts/connect {provider, access: full|read}   where to sign in (the hive's OAuth app, your account)
 *   PATCH  /api/accounts/:id {label, orchestrator}               rename it; the check "the Orchestrator may use it"
 *   POST   /api/accounts/:id/reading {mode, every, times, reader} when the mail reader reads it (reading.js)
 *   POST   /api/accounts/:id/read                 read its new mail now
 *   DELETE /api/accounts/:id                      disconnect (its tokens and reading schedules go)
 *   GET    /api/accounts/calendar?from&to         your events across your accounts
 *   GET    /api/accounts/mail/triage?verdict&account   what the mail reading decided, per mail, with counts
 *   POST   /api/accounts/mail/triage/:account/:mail {verdict}   it was misjudged: moved, and its sender gets your rule
 *   GET|PUT /api/accounts/mail/rules {senders, notes}            your rules and notes for the mail reader
 *   GET    /api/accounts/drafts                   drafts waiting for you
 *   PATCH  /api/accounts/drafts/:id {to, cc, subject, body}      change one before sending
 *   POST   /api/accounts/drafts/:id/send          Send — your click
 *   DELETE /api/accounts/drafts/:id               discard it
 *   GET    /api/accounts/actions?domain           the action log: what was changed, by whom, before and after
 *   POST   /api/accounts/actions/:id/undo         Undo — and undo an undo to bring it back
 *
 * Right `chat` (auth/rights.js). Whose is always the signed-in person, from the session — never from the body or a
 * query — so no route here reaches another person's accounts, an admin's turn included; and none returns a token.
 */
const accounts = require('./store');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json(require('../switch-off').body(e, res.req)); } };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const callback = req => `${req.protocol}://${req.get('host')}/api/connectors/callback`;

function me(req) {
  const p = require('../harness/turn/client').dashboardClient(req).user;
  if (!p?.id) throw bad('Sign in first.', 401);
  return p;
}
const mine = (req, id) => { const r = accounts.get(me(req).id, id); if (!r) throw bad('No such account.', 404); return r; };

function providers(person) {
  const scopes = require('./scopes'), vault = require('../connectors/vault'), allot = require('../auth/allot');
  return Object.entries(scopes.PROVIDERS).map(([id, p]) => ({ id, label: p.label, ready: !!vault.get(id)?.clientId, allowed: allot.uses(person, 'account', id),
    scopes: { full: p.full, read: p.read } }));
}

async function calendar(person, { from, to }) {
  const f = from ? new Date(from) : new Date(), t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400000);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw bad('from and to are times.');
  const events = [], errors = [];
  for (const rec of accounts.list(person.id)) {
    try { events.push(...(await require('./adapter').of(rec).calendar.events(rec, { from: f.toISOString(), to: t.toISOString() })).map(e => ({ ...e, accountId: rec.id }))); }
    catch (e) { errors.push({ accountId: rec.id, error: e.message }); }
  }
  // What the assistant set in this range, so a page can tint it ("set by …").
  const set = new Set(require('./actions').list(person.id, { domain: 'calendar', limit: 500 }).filter(a => a.act === 'calendar.create' && !a.undoneBy).map(a => a.target?.id));
  return { events: events.map(e => ({ ...e, setByAssistant: set.has(e.id) })).sort((a, b) => String(a.start).localeCompare(String(b.start))), errors };
}

function mount(app) {
  app.get('/api/accounts', h(req => { const p = me(req); return { callback: callback(req), providers: providers(p), accounts: accounts.list(p.id).map(accounts.view),
    reading: { newEvery: require('./reading').NEW_EVERY, push: 'polled: Gmail\'s history and Microsoft Graph\'s delta query, every few minutes — real push needs a public address' } }; }));
  app.post('/api/accounts/connect', h(req => {
    const p = me(req), { provider, access = 'full' } = req.body || {};
    const scopes = require('./scopes').of(provider, access);
    if (!require('../auth/allot').uses(p, 'account', provider)) throw bad(`Your level does not include ${provider} accounts — an admin allots them in Settings → Users.`, 403);
    if (!require('../connectors/vault').get(provider)?.clientId) throw require('../switch-off').unset(`${require('./scopes').PROVIDERS[provider].label} needs the hive's OAuth app first: an admin adds its client id and secret in Field → Connectors (one app connects everyone's own accounts).`, { what: `${require('./scopes').PROVIDERS[provider].label}'s OAuth app for this hive`, page: 'connectors',
      why: 'One OAuth app of the hive\'s own connects everyone\'s accounts: an admin makes it at the provider and pastes its client id and secret in Field → Connectors.' });
    const out = require('../connectors/oauth').start(provider, callback(req), { scopes, save: (tokens, account) => {
      const rec = accounts.add(p.id, { provider, account, access: access === 'read' ? 'read' : 'full', scopes }, tokens);
      require('../activity').note({ from: 'accounts', what: `${p.name || p.email || 'a person'} connected ${account || provider} (${access === 'read' ? 'read only' : 'read and act'})`, why: 'they connected their own account', person: p });
      require('../live').changed('everyday', rec.id, 'connected', { personId: p.id, kind: 'account' });
    } });
    return { url: out.url, callback: callback(req) };
  }));
  app.get('/api/accounts/calendar', h(req => calendar(me(req), req.query)));
  app.get('/api/accounts/mail/triage', h(req => {
    const p = me(req), t = require('./triage/store');
    return { mails: t.list(p.id, { verdict: req.query.verdict || undefined, accountId: req.query.account || undefined, limit: Math.min(500, Number(req.query.limit) || 100) }), counts: t.counts(p.id) };
  }));
  app.post('/api/accounts/mail/triage/:account/:mail', h(req => ({ mail: require('./triage/store').correct(me(req).id, req.params.account, req.params.mail, req.body?.verdict) })));
  app.get('/api/accounts/mail/rules', h(req => ({ rules: require('./triage/store').rules(me(req).id) })));
  app.put('/api/accounts/mail/rules', h(req => ({ rules: require('./triage/store').setRules(me(req).id, req.body || {}) })));
  app.get('/api/accounts/drafts', h(req => ({ drafts: require('./drafts').list(me(req).id) })));
  app.patch('/api/accounts/drafts/:id', h(req => ({ draft: require('./drafts').edit(me(req).id, req.params.id, req.body || {}) })));
  app.post('/api/accounts/drafts/:id/send', h(req => { const p = me(req); return require('./drafts').send(p.id, req.params.id, { kind: 'person', name: p.name || p.email || 'the person' }); }));
  app.delete('/api/accounts/drafts/:id', h(req => require('./drafts').discard(me(req).id, req.params.id)));
  app.get('/api/accounts/actions', h(req => ({ actions: require('./actions').list(me(req).id, { domain: req.query.domain || undefined, limit: Math.min(500, Number(req.query.limit) || 100) }) })));
  app.post('/api/accounts/actions/:id/undo', h(req => { const p = me(req); return require('./actions').undo(p.id, req.params.id, { kind: 'person', name: p.name || p.email || 'the person' }); }));
  app.patch('/api/accounts/:id', h(req => {
    const p = me(req), rec = mine(req, req.params.id), b = req.body || {};
    const next = accounts.patch(p.id, rec.id, { label: b.label, orchestrator: b.orchestrator });   // only these two: the reading has its own route
    if (typeof b.orchestrator === 'boolean' && b.orchestrator !== (rec.orchestrator !== false))
      require('../activity').note({ from: 'accounts', what: `the agents ${b.orchestrator ? 'may now use' : 'no longer use'} ${rec.account || rec.provider}`, why: 'its person changed the check', person: p });
    return { account: accounts.view(next) };
  }));
  app.post('/api/accounts/:id/reading', h(req => ({ account: accounts.view(require('./reading').set(me(req), mine(req, req.params.id).id, req.body || {})) })));
  app.post('/api/accounts/:id/read', h(req => require('./triage/run').read(me(req).id, mine(req, req.params.id).id, { trigger: 'now' })));
  app.delete('/api/accounts/:id', h(req => {
    const p = me(req), rec = mine(req, req.params.id);
    require('./reading').forget(p.id, rec.id);
    const out = accounts.remove(p.id, rec.id);
    require('../activity').note({ from: 'accounts', what: `${p.name || p.email || 'a person'} disconnected ${rec.account || rec.provider}`, why: 'they disconnected it', person: p });
    require('../live').changed('everyday', rec.id, 'disconnected', { personId: p.id, kind: 'account' });
    return out;
  }));
}

module.exports = { mount, calendar };

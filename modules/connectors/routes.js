'use strict';

/**
 * Field → Connectors (TODO H9.3): the services, the owner's OAuth app for each, connecting (the service's sign-in
 * page, then back to `/api/connectors/callback`), who may use it, and disconnecting. All host: a connector is the
 * keys to the owner's accounts. No secret is ever returned — the vault's `view()` is all a browser sees.
 */
const vault = require('./vault');
const oauth = require('./oauth');
const { CATALOG, ID } = require('./catalog');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const callback = req => `${req.protocol}://${req.get('host')}/api/connectors/callback`;
const url = (v, what) => { const s = String(v || '').trim(); if (s && !/^https?:\/\/[^\s]+$/.test(s)) throw bad(`${what} is an http(s) address.`); return s; };

function list() {
  const stored = vault.all();
  const ids = [...Object.keys(CATALOG).filter(k => k !== 'custom'), ...Object.keys(stored).filter(k => !CATALOG[k])];
  return ids.map(id => { const kind = CATALOG[id] ? id : 'custom', c = CATALOG[kind];
    return { id, kind, label: stored[id]?.label || c.label, console: c.console, defaultScopes: c.scopes || '', ...vault.view(id) }; });
}

function mount(app) {
  app.get('/api/connectors', h(req => ({ callback: callback(req), connectors: list() })));
  app.post('/api/connectors/:id', h(req => {
    const id = req.params.id, b = req.body || {};
    if (!ID.test(id) || id === 'custom') throw bad('A connector id is lower-case letters, digits and -.');
    const kind = CATALOG[id] ? id : 'custom';
    const MASK = require('../secrets-mask').MASK;
    const next = { kind };
    if (typeof b.clientId === 'string') next.clientId = b.clientId.trim();
    if (typeof b.clientSecret === 'string' && b.clientSecret !== MASK) next.clientSecret = b.clientSecret.trim();
    if (typeof b.scopes === 'string') next.scopes = b.scopes.trim();
    if (b.who === 'everyone' || b.who === 'host') next.who = b.who;
    if (kind === 'custom') {
      if (typeof b.label === 'string') next.label = b.label.trim().slice(0, 60) || id;
      if (b.urls) next.urls = { authorize: url(b.urls.authorize, 'The authorize address'), token: url(b.urls.token, 'The token address'),
        api: [].concat(b.urls.api || []).map(a => url(a, 'An API address')).filter(Boolean), whoami: b.urls.whoami ? String(b.urls.whoami).trim() : null };
    }
    vault.patch(id, next);
    return { connector: list().find(c => c.id === id) };
  }));
  app.post('/api/connectors/:id/connect', h(req => ({ ...oauth.start(req.params.id, callback(req)), callback: callback(req) })));
  app.get('/api/connectors/callback', async (req, res) => {
    const page = (title, text) => res.type('html').send(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;margin:3em;background:#111;color:#eee">`
      + `<h2>${title}</h2><p>${String(text).replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</p><p>You can close this tab.</p></body>`);
    if (req.query.error) return page('Not connected', `The service said: ${req.query.error_description || req.query.error}`);
    try { const r = await oauth.finish(req.query.state, req.query.code); page('Connected', `${r.label}${r.account ? ` as ${r.account}` : ''} is connected to DOCA.`); }
    catch (e) { res.status(e.status || 500); page('Not connected', e.message); }
  });
  // Logins for the agents' computers (logins.js): the vault — never a password back.
  app.get('/api/connectors/logins/all', h(() => ({ logins: require('../logins').list() })));
  app.post('/api/connectors/logins/all', h(req => ({ login: require('../logins').save(req.body || {}) })));
  app.delete('/api/connectors/logins/:id', h(req => require('../logins').remove(req.params.id)));
  require('../service-drafts').mount(app);   // services the agent prepared: the key's details and a skill, waiting for the secret
  // Keys for services (service-keys.js): pasted once, added by the hub to that service's own address — never a key back.
  app.get('/api/connectors/keys/all', h(() => ({ keys: require('../service-keys').list() })));
  app.post('/api/connectors/keys/all', h(req => ({ key: require('../service-keys').save(req.body || {}) })));
  app.delete('/api/connectors/keys/:name', h(req => require('../service-keys').remove(req.params.name)));
  app.delete('/api/connectors/:id', h(req => {
    if (req.query.all === '1') vault.forget(req.params.id);
    else vault.forget(req.params.id, ['accessToken', 'refreshToken', 'expiresAt', 'account', 'connectedAt']);
    return { connectors: list() };
  }));
}

module.exports = { mount, list };

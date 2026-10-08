'use strict';

/**
 * Field → Connectors (TODO H9.3): the services and their ways to connect — a calendar's secret address, an app
 * password, a key, the owner's OAuth app (connecting: the service's sign-in page, then back to
 * `/api/connectors/callback`) — who may use each, testing on every save, and disconnecting. All host: a connector is
 * the keys to the owner's accounts. No secret is ever returned — the vault's `view()` is all a browser sees.
 */
const vault = require('./vault');
const oauth = require('./oauth');
const ways = require('./ways');
const services = require('./services');
const { CATALOG, ID } = require('./catalog');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const callback = req => `${req.protocol}://${req.get('host')}/api/connectors/callback`;
const url = (v, what) => { const s = String(v || '').trim(); if (s && !/^https?:\/\/[^\s]+$/.test(s)) throw bad(`${what} is an http(s) address.`); return s; };

/** The OAuth connectors: the catalogue's and those a person added. */
function list() {
  const stored = vault.all();
  const ids = [...Object.keys(CATALOG).filter(k => k !== 'custom'), ...Object.keys(stored).filter(k => !CATALOG[k] && !(stored[k].via && stored[k].via !== 'oauth'))];
  return ids.map(id => { const kind = CATALOG[id] ? id : 'custom', c = CATALOG[kind];
    return { id, kind, label: stored[id]?.label || c.label, console: c.console, docs: c.docs || null, defaultScopes: c.scopes || '', ...vault.view(id) }; });
}

/** The services with their ways, simplest first, each way's state; then the connections a person added another way. */
function overview() {
  const keys = Object.fromEntries(require('../service-keys').list().map(k => [k.name, k]));
  const oauthOf = Object.fromEntries(list().map(c => [c.id, c]));
  const presets = require('./presets');
  const wayView = x => {
    if (x.via === 'oauth') return { ...x, state: oauthOf[x.id] };
    if (x.via === 'key') { const k = services.KEYS[x.key]; return { ...x, how: k.how, link: k.link, origin: k.origin, note: k.note, state: keys[k.name] || null }; }
    return { ...x, preset: x.via === 'mail' ? presets.MAIL[x.provider] : x.via === 'dav' ? presets.DAV[x.provider] : undefined, state: vault.view(x.id) };
  };
  const known = new Set(services.SERVICES.flatMap(s => s.ways.map(x => x.id)).filter(Boolean));
  const others = Object.entries(vault.all()).filter(([id, r]) => r.via && r.via !== 'oauth' && !known.has(id))
    .map(([id, r]) => ({ via: r.via, id, label: ways.get(r.via)?.label, name: r.label || id, state: vault.view(id) }));
  return { services: services.SERVICES.map(s => ({ ...s, ways: s.ways.map(wayView) })), others, presets: { mail: presets.MAIL, dav: presets.DAV, ics: services.ICS.other } };
}

/** Run a way's test and keep the outcome: live when it passed, the error (never a secret) when not. */
async function test(id) {
  const rec = vault.get(id);
  const way = rec && ways.get(rec.via);
  if (!way) throw bad('Nothing to test here.', 404);
  try {
    const r = await way.test(rec, id);
    vault.patch(id, { ...r.keep, connectedAt: rec.connectedAt || new Date().toISOString(), testedAt: new Date().toISOString(), lastError: null });
    return { ok: true, summary: r.summary };
  } catch (e) {
    const scrub = String(e.message).split(rec.password || '\0').join('[secret]').split(rec.address || '\0').join('[address]');
    vault.patch(id, { testedAt: new Date().toISOString(), lastError: scrub.slice(0, 300) });
    vault.forget(id, ['connectedAt']);
    return { ok: false, error: scrub };
  }
}

/** Save a connection made without OAuth (ways/): a way the catalogue names, or one a person added under a name. */
async function saveWay(id, b) {
  const prev = vault.get(id) || {};
  const known = services.wayOf(id);
  const via = known ? known.way.via : prev.via || b.via;
  const way = ways.get(via);
  if (!way || (known && b.via && b.via !== via)) throw bad('Unknown way to connect.');
  if (!known) {
    if (!ID.test(id) || CATALOG[id] || id === 'custom') throw bad('Give it a short name of lower-case letters, digits and -, not a service\'s own.');
    if (Object.keys(prev).length && prev.via !== via) throw bad(`"${id}" is already another connection: choose another name.`);
  }
  const next = { via, kind: known ? known.service.id : 'other', ...way.accept({ ...b, ...(known?.way.provider && !b.provider ? { provider: known.way.provider } : {}) }, prev) };
  if (b.who === 'everyone' || b.who === 'host') next.who = b.who;
  if (!known && typeof b.label === 'string') next.label = b.label.trim().slice(0, 60) || id;
  vault.patch(id, next);
  way.forget?.(id);
  const tested = await test(id);
  return { connector: { id, ...vault.view(id) }, test: tested };
}

function mount(app) {
  app.get('/api/connectors', h(req => ({ callback: callback(req), connectors: list(), ...overview() })));
  app.post('/api/connectors/:id/test', h(async req => ({ test: await test(req.params.id), connector: { id: req.params.id, ...vault.view(req.params.id) } })));
  app.post('/api/connectors/:id', h(async req => {
    const id = req.params.id, b = req.body || {};
    const rec = vault.get(id);
    const known = services.wayOf(id);
    if (known ? known.way.via !== 'oauth' : (rec?.via && rec.via !== 'oauth') || (b.via && b.via !== 'oauth')) return saveWay(id, b);
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
  require('../sealed/routes').mount(app);   // secrets for devices (sealed/): used on a device, never read — never a value back
  require('../service-drafts').mount(app);   // services the agent prepared: the key's details and a skill, waiting for the secret
  // Keys for services (service-keys.js): pasted once, added by the hub to that service's own address — never a key back.
  app.get('/api/connectors/keys/all', h(() => ({ keys: require('../service-keys').list() })));
  app.post('/api/connectors/keys/all', h(req => ({ key: require('../service-keys').save(req.body || {}) })));
  app.delete('/api/connectors/keys/:name', h(req => require('../service-keys').remove(req.params.name)));
  // A key from a service's card (services.KEYS): the hub fills in where it goes, then tries it on the service.
  app.post('/api/connectors/keys/preset/:service', h(req => require('./key-test').savePreset(req.params.service, req.body || {})));
  app.delete('/api/connectors/:id', h(req => {
    const rec = vault.get(req.params.id), way = rec && ways.get(rec.via);
    if (req.query.all === '1') vault.forget(req.params.id);
    else if (way) vault.forget(req.params.id, [...way.SECRETS, 'connectedAt']);
    else vault.forget(req.params.id, ['accessToken', 'refreshToken', 'expiresAt', 'account', 'connectedAt']);
    way?.forget?.(req.params.id);
    return { connectors: list() };
  }));
}

module.exports = { mount, list, overview, test };

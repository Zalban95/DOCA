'use strict';

/**
 * A service the agent prepared for a person to switch on (asked 2026-10-06: "is the dashboard+harness able to add any
 * service … without needing to change the code, and in a more comfortable way than doing all from scratch?").
 *
 * The agent reads the service's own documentation (research_docs), then drafts everything but the secret: how the key
 * is sent (`service-keys.js`: a header, a parameter, or id:secret traded for a token), the service's address, what it
 * is for, and a skill — the steps an agent follows to use it (submit, wait, keep, show), in plain markdown. The draft
 * waits in Field → Connectors → "Prepared by the agent": the person reads it, pastes the key, and one Save writes
 * the key (to the protected keys file) and the skill. Nothing is used before that, the agent never holds the secret,
 * and no code is written — an MCP server is drafted the same way by mcp/drafts.js.
 */
const crypto = require('crypto');
const docs = () => require('./db/docs');
const KEY = 'service-drafts';
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const all = () => docs().getDoc(KEY, { drafts: [] }).drafts || [];
const keep = list => docs().setDoc(KEY, { drafts: list.slice(-20) });

function draft({ name, origin, place = 'header', field, prefix, note, docs: source, skill, openapi, openapi_url: specUrl }, by = {}) {
  name = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw bad('name: short, lowercase letters, digits and dashes (hyper3d, weather-api).');
  let o;
  try { o = new URL(String(origin || '')).origin; } catch { throw bad('origin: the API\'s address, like https://api.example.com.'); }
  if (!['header', 'query', 'basic', 'exchange'].includes(place)) throw bad('place: header, query, basic or exchange.');
  if (place === 'exchange') { try { if (new URL(String(field)).origin !== o) throw new Error(); } catch { throw bad('For exchange, field is the token address on the same origin.'); } }
  const sk = skill && typeof skill === 'object' ? skill : null;
  if (sk && (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(sk.name || '')) || !String(sk.body || '').trim()))
    throw bad('skill: {name (lowercase-dashes), description (when to use it), body (the steps, markdown)}.');
  // Its actions, from an OpenAPI document the agent found or wrote (api-services/openapi.js) — or the address of one,
  // read when the person opens the draft. Its server must be the origin the key goes to.
  let definition = null, spec = null;
  if (openapi) {
    const doc = typeof openapi === 'string' ? require('./api-services/yaml').read(openapi) : openapi;
    const whole = doc && (doc.openapi || doc.swagger) ? doc : { openapi: '3.1.0', servers: [{ url: o }], paths: doc?.paths || doc };
    ({ definition } = require('./api-services/openapi').fromDoc(whole, { from: o }));
    definition.server ||= o;
    if (new URL(definition.server).origin !== o) throw bad(`The document's server is ${new URL(definition.server).origin}, not ${o}: the key goes only to one address.`);
  } else if (specUrl) { try { spec = new URL(String(specUrl)).toString(); } catch { throw bad('openapi_url: the document\'s address.'); } }
  const d = { id: `svc_${crypto.randomBytes(4).toString('hex')}`, name, origin: o, place,
    ...(definition ? { definition } : {}), ...(spec ? { spec } : {}),
    field: field ? String(field).slice(0, 300) : null, prefix: prefix === undefined || prefix === null ? null : String(prefix).slice(0, 30),
    note: String(note || '').slice(0, 200), docs: String(source || '').slice(0, 300),
    skill: sk ? { name: String(sk.name), description: String(sk.description || '').slice(0, 400), body: String(sk.body).slice(0, 20000) } : null,
    by: by.sessionId || null, at: new Date().toISOString() };
  keep([...all().filter(x => x.name !== name), d]);
  return d;
}

/** The person's Save: the key into the protected file, the skill into the skills — then the draft is gone. */
function accept(id, { key, who, definition } = {}) {
  const d = all().find(x => x.id === id);
  if (!d) throw bad('No such draft.', 404);
  if (!String(key || '').trim()) throw bad('Paste the key itself.');
  // An API service (api-services/): the draft's actions when it has them, the key's way of being sent always — the
  // person's form may have changed the definition (`definition`) before Save.
  const store = require('./api-services/store');
  const auth = store.authOfKey({ place: d.place, field: d.field || (d.place === 'query' ? 'api_key' : 'Authorization'), prefix: d.prefix ?? (d.place === 'header' && !d.field ? 'Bearer ' : '') });
  const skills = require('./harness/skills');
  if (d.skill && skills.list().some(s => s.name === d.skill.name && s.source !== 'local')) throw bad(`A shipped skill is called "${d.skill.name}": the draft cannot replace it.`, 409);
  const def = { ...(d.definition || {}), server: d.definition?.server || d.origin, auth, ...(definition || {}), name: d.name, note: d.note, docs: d.docs, source: 'draft', ...(d.skill ? { skill: d.skill.name } : {}) };
  const saved = require('./api-services/routes').save({ ...def, key, who: who === 'everyone' ? 'everyone' : 'host' }).service;
  let skill = null;
  if (d.skill) {
    skill = skills.write(d.skill.name, { description: d.skill.description, body: d.skill.body });
  }
  keep(all().filter(x => x.id !== id));
  return { key: saved, service: saved, skill: skill ? d.skill.name : null };
}

function remove(id) { const before = all().length; keep(all().filter(x => x.id !== id)); return { removed: before !== all().length }; }

function mount(app) {
  const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  // Each with its definition as OpenAPI, for "Open in the form" (Field → Connectors → API services).
  app.get('/api/connectors/drafts/all', h(() => ({ drafts: all().map(d => (d.definition ? { ...d, openapi: require('./api-services/openapi').toDoc({ ...d.definition, name: d.name }) } : d)) })));
  app.post('/api/connectors/drafts/:id/accept', h(req => accept(req.params.id, req.body || {})));
  app.delete('/api/connectors/drafts/:id', h(req => remove(req.params.id)));
}

module.exports = { all, draft, accept, remove, mount };

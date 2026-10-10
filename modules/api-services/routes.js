'use strict';

/**
 * Field → Connectors → API services: the panel's side (all host, by the `/api/connectors` row in auth/rights.js — a
 * service decides where a key goes). Reading a document (a template, an address, pasted JSON or YAML) is a dry run
 * that fills the form; only Save keeps a definition and, when pasted, its key. Nothing returns a key.
 *
 *   GET    /api/connectors/services/all           the services, the templates, the recent jobs
 *   POST   /api/connectors/services/find          {q}: a name → the templates it matches; an address or docs link → its OpenAPI
 *                                                 document found (discover.js) — nothing saved
 *   POST   /api/connectors/services/classify       {q}: the one "Add a service" box (classify.js) — a chat-model provider or an
 *                                                 API service, and why; with nothing typed, the drafts, templates and
 *                                                 known providers to suggest — nothing saved
 *   POST   /api/connectors/services/read          {template | url | text} → { definition, openapi, warnings } — nothing saved
 *   POST   /api/connectors/services/all           the form: a definition, its actions as OpenAPI text, the key and who may use it — saved
 *   GET    /api/connectors/services/:name/openapi the service as an OpenAPI 3.1 document, without its key
 *   POST   /api/connectors/services/:name/try     {operation, params}: one read action (GET, no job), its answer
 *   DELETE /api/connectors/services/:name[?key=1] forget it (and its key)
 */
const store = require('./store');
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const h = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const MAX = 15 * 1024 * 1024;

/** A document from an address the person typed (their click): JSON or YAML, at most 15 MB. */
async function fetchDoc(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw bad('That is not an address.'); }
  if (!/^https?:$/.test(u.protocol)) throw bad('The address is an http(s) one.');
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json, application/yaml, text/yaml, */*' } }); }
  catch (e) { throw bad(`Could not read ${u.host}: ${e.cause?.code || e.message}.`, 502); }
  if (!r.ok) throw bad(`${u.host} answered HTTP ${r.status}.`, 502);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw bad('The document is over 15 MB.', 413);
  return { text: buf.toString('utf8'), from: r.url || u.toString() };
}

/** OpenAPI text (JSON or YAML) → { definition, warnings }; only paths given (a fragment, "by hand") read as a document around them. */
function parseText(text, from = null) {
  if (String(text).length > MAX) throw bad('The document is over 15 MB.', 413);
  const doc = require('./yaml').read(text);
  const whole = doc && (doc.openapi || doc.swagger) ? doc : doc && typeof doc === 'object' && (doc.paths || Object.keys(doc).every(k => k.startsWith('/'))) ? { openapi: '3.1.0', paths: doc.paths || doc } : doc;
  return require('./openapi').fromDoc(whole, { from });
}

async function read(b = {}) {
  if (b.template) return require('./templates').load(b.template);
  const src = b.url ? await fetchDoc(b.url) : { text: typeof b.text === 'string' ? b.text : JSON.stringify(b.text || ''), from: null };
  const r = parseText(src.text, src.from);
  return { ...r, definition: { ...r.definition, source: b.url ? 'import' : 'hand', ...(b.url && !r.definition.docs ? { docs: String(b.url).slice(0, 300) } : {}) } };
}

/** With the document the form's Advanced box shows: the definition as OpenAPI, ready to read, change and save. */
const withDoc = r => (r.definition ? { ...r, openapi: require('./openapi').toDoc({ name: r.definition.name || 'service', ...r.definition, server: r.definition.server || 'https://example.invalid' }) } : r);

/**
 * The form's Save. Its actions come as OpenAPI text (the Advanced box: a whole document, or only its paths), read here;
 * the form's own fields win over the document's. A draft the agent prepared is saved through it, its skill with it.
 */
function fromForm(b = {}) {
  let doc = {};
  if (typeof b.openapi === 'string' && b.openapi.trim()) doc = parseText(b.openapi).definition;
  else if (b.openapi && typeof b.openapi === 'object') doc = require('./openapi').fromDoc(b.openapi).definition;
  const pick = k => (b[k] !== undefined && b[k] !== '' && b[k] !== null ? b[k] : doc[k]);
  return { ...doc, name: b.name, server: pick('server'), auth: b.auth || doc.auth, title: pick('title'), note: pick('note'), docs: pick('docs'),
    keyHint: pick('keyHint'), headers: b.headers !== undefined ? b.headers : doc.headers, rate: b.rate !== undefined ? b.rate : doc.rate, skill: b.skill !== undefined ? b.skill : doc.skill, actions: b.openapi !== undefined ? doc.actions || [] : b.actions || [],
    source: b.source || doc.source || 'hand', key: b.key, who: b.who };
}

/** Save: the key first when one is pasted (it may move to a new address), then the definition. */
function save(b = {}) {
  if (b.openapi !== undefined) b = fromForm(b);
  const keys = require('../service-keys');
  const MASK = require('../secrets-mask').MASK;
  const pasted = typeof b.key === 'string' && b.key.trim() && b.key !== MASK;
  const def = store.check({ ...b, source: b.source || 'hand' }, { rekey: pasted });
  const had = keys.list().find(k => k.name === def.name);
  if (def.auth.type !== 'none' && (pasted || had))
    keys.save({ name: def.name, origin: def.origin, ...store.keyPlace(def.auth), who: b.who || had?.who || 'host', note: def.note || had?.note || '', ...(pasted ? { key: b.key } : {}) });
  return { service: store.save(def) };
}

async function tryRead(name, { operation, params } = {}) {
  const def = store.get(name);
  if (!def) throw bad('No such service.', 404);
  const a = def.actions.find(x => x.name === operation);
  if (!a) throw bad(`${name} has no action "${operation}".`, 404);
  if (a.method !== 'GET' || a.job) throw bad('Try runs a read (a GET that is not a job) only.');
  const r = await require('./call').send(def, a, { params });
  if (r.error) throw bad(r.error.replace(/^Error: /, ''), 502);
  return { status: r.status, ok: r.ok, text: r.text.slice(0, 4000) };
}

function mount(app) {
  app.get('/api/connectors/services/all', h(() => ({ services: store.list(), templates: require('./templates').list(), jobs: require('./jobs').list().slice(0, 20) })));
  app.post('/api/connectors/services/find', h(async req => withDoc(await require('./discover').find((req.body || {}).q))));
  app.post('/api/connectors/services/classify', h(async req => {
    const r = await require('./classify').classify((req.body || {}).q);
    return r.found?.definition ? { ...r, found: withDoc(r.found) } : r;
  }));
  app.post('/api/connectors/services/read', h(async req => withDoc(await read(req.body || {}))));
  app.post('/api/connectors/services/all', h(req => {
    const b = req.body || {};
    if (!b.draft) return save(b);
    const def = fromForm(b);   // a draft: its key and skill are saved together, by the person (service-drafts.js)
    return require('../service-drafts').accept(b.draft, { key: b.key, who: b.who, definition: { ...def, key: undefined, who: undefined } });
  }));
  app.get('/api/connectors/services/:name/form', h(req => {
    const def = store.get(req.params.name);
    if (!def) throw bad('No such service.', 404);
    return { definition: { ...def, ...store.view(def.name) }, openapi: require('./openapi').toDoc(def) };
  }));
  app.get('/api/connectors/services/:name/openapi', (req, res) => {
    const def = store.get(req.params.name);
    if (!def) return res.status(404).json({ error: 'No such service.' });
    res.set('Content-Disposition', `attachment; filename="${def.name}.openapi.json"`).json(require('./openapi').toDoc(def));
  });
  app.post('/api/connectors/services/:name/try', h(req => tryRead(req.params.name, req.body || {})));
  app.delete('/api/connectors/services/:name', h(req => {
    const name = String(req.params.name).toLowerCase();
    let out = {};
    try { out = store.remove(name); } catch (e) { if (req.query.key !== '1') throw e; }
    if (req.query.key === '1') { try { require('../service-keys').remove(name); out.key = true; } catch { /* no key */ } }
    return { removed: name, ...out };
  }));
}

module.exports = { mount, read, save, fromForm };

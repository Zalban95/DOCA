'use strict';

/**
 * An API service as OpenAPI (the standard providers publish), both ways. `fromDoc()` reads an OpenAPI 3.x (or Swagger
 * 2.0) document into the definition DOCA keeps — the server, how the key is sent (securitySchemes: apiKey in a header
 * or the query, http bearer or basic, oauth2 clientCredentials, none) and each operation as an action: its method,
 * path, parameters and body (json, a form, or multipart with file fields), with `$ref`s resolved. `toDoc()` writes a
 * definition back as a valid OpenAPI 3.1 document; DOCA's own additions ride as vendor extensions:
 *
 *   x-doca-job (on an operation)   an asynchronous job: where the job id is in the answer, which action asks after it
 *                                  and with which parameter, where the status is, which values mean done or failed,
 *                                  where the result's addresses are, how often to ask and when to give up (job.js)
 *   x-doca-token-body (oauth2)     "json": the token is asked for with an empty JSON body (hi3d) rather than OAuth's form
 *   x-doca-prefix (apiKey header)  what goes before the key in the header ("Token ")
 *
 * so a stored service exports as a document any OpenAPI tool reads, and comes back in unchanged.
 */
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'];
const cut = (v, n) => (v === undefined || v === null ? undefined : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || undefined);
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));

/** A `$ref` inside the document, followed (up to 8 deep); allOf merged into one object schema. */
function resolver(doc) {
  const at = ref => String(ref).slice(2).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((o, k) => (o == null ? o : o[k]), doc);
  const deref = (node, depth = 0) => {
    let n = node;
    for (let d = 0; n && typeof n === 'object' && typeof n.$ref === 'string' && d < 8; d++) n = n.$ref.startsWith('#/') ? at(n.$ref) : null;
    if (!n || typeof n !== 'object') return {};
    if (Array.isArray(n.allOf) && depth < 6) {
      const parts = n.allOf.map(p => deref(p, depth + 1));
      return { type: 'object', ...n, properties: Object.assign({}, ...parts.map(p => p.properties || {}), n.properties || {}),
        required: [...new Set([...parts.flatMap(p => p.required || []), ...(n.required || [])])] };
    }
    return n;
  };
  return deref;
}

const typeOf = s => { const t = Array.isArray(s.type) ? s.type.find(x => x !== 'null') : s.type; return t === 'file' ? 'string' : t || (s.properties ? 'object' : 'string'); };   // Swagger 2's file is a binary string
const isFile = s => ['binary', 'base64'].includes(s.format) || s.type === 'file' || s.contentMediaType !== undefined;

function field(name, s, deref, required) {
  s = deref(s);
  const many = typeOf(s) === 'array', item = many ? deref(s.items || {}) : s;
  return clean({ name: String(name).slice(0, 80), type: many ? `array of ${typeOf(item)}` : typeOf(s), file: isFile(item) || undefined, many: many || undefined,
    required: required || undefined, description: cut(s.description || s.title, 300), enum: Array.isArray(item.enum) ? item.enum.slice(0, 30) : undefined,
    default: s.default !== undefined && typeof s.default !== 'object' ? s.default : undefined });
}

/** The request body: the first content type DOCA can send, and its fields. */
function bodyOf(rb, deref) {
  rb = deref(rb);
  const content = rb.content || {};
  const pick = [['multipart/form-data', 'multipart'], ['application/x-www-form-urlencoded', 'form'], ['application/json', 'json']]
    .find(([t]) => content[t]) || Object.keys(content).filter(t => /json/.test(t)).map(t => [t, 'json'])[0];
  if (!pick) return Object.keys(content).length ? { kind: 'json', free: true } : null;   // another type: DOCA sends JSON
  const schema = deref(content[pick[0]].schema || {});
  const props = schema.properties || {};
  const fields = Object.entries(props).slice(0, 60).map(([k, v]) => field(k, v, deref, (schema.required || []).includes(k)));
  return clean({ kind: pick[1], required: rb.required || undefined, fields, free: !fields.length || undefined });
}

const NAME = n => String(n || '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);

/** The x-doca-job extension, checked: the paths are dotted (`data.task_id`, `output[0]`), the times bounded. */
function jobOf(j) {
  if (!j || typeof j !== 'object') return undefined;
  const path = v => (typeof v === 'string' && /^[A-Za-z0-9_$-]+(\[\d+\]|\.[A-Za-z0-9_$-]+)*$/.test(v) ? v : undefined);
  const list = v => [].concat(v ?? []).map(x => String(x).slice(0, 60)).slice(0, 10);
  const poll = j.poll && typeof j.poll === 'object' ? j.poll : { operation: j.poll, param: j.param };
  if (!path(j.id) || !NAME(poll.operation) || !path(j.status)) throw bad('x-doca-job needs id (where the job id is in the answer), poll {operation, param} and status (where its state is).');
  const n = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number(v) || d));
  return clean({ id: path(j.id), poll: clean({ operation: NAME(poll.operation), param: cut(poll.param, 80) }), status: path(j.status),
    done: list(j.done).length ? list(j.done) : ['success', 'succeeded', 'completed', 'done'], failed: list(j.failed).length ? list(j.failed) : ['failed', 'error', 'canceled', 'cancelled'],
    result: [].concat(j.result ?? []).map(path).filter(Boolean).slice(0, 6), message: path(j.message),
    ok: j.ok && path(j.ok.path) ? { path: path(j.ok.path), values: [].concat(j.ok.values ?? []).slice(0, 10) } : undefined,
    every: n(j.every, 5, 600, 20), giveUp: n(j.giveUp, 60, 21600, 1800), ext: /^[a-z0-9]{1,8}$/i.test(j.ext || '') ? j.ext.toLowerCase() : undefined });
}

/** How the key is sent, from a security scheme; `warning` when it is a kind DOCA cannot send. */
function authOf(scheme, server) {
  if (!scheme) return { auth: { type: 'none' } };
  const t = scheme.type;
  if (t === 'apiKey' && (scheme.in === 'header' || scheme.in === 'query'))
    return { auth: clean({ type: 'apiKey', in: scheme.in, name: cut(scheme.name, 80) || 'api_key', prefix: scheme.in === 'header' ? scheme['x-doca-prefix'] : undefined }) };
  if ((t === 'http' && /^bearer$/i.test(scheme.scheme)) || (t === 'oauth2' && !scheme.flows?.clientCredentials && !scheme.flow)) return { auth: { type: 'bearer' } };
  if ((t === 'http' && /^basic$/i.test(scheme.scheme)) || t === 'basic') return { auth: { type: 'basic' } };
  const cc = scheme.flows?.clientCredentials || (scheme.flow === 'application' ? scheme : null);
  if (t === 'oauth2' && cc?.tokenUrl) {
    let tokenUrl;
    try { tokenUrl = new URL(cc.tokenUrl, server).toString(); } catch { return { auth: { type: 'bearer' }, warning: 'its token address could not be read: paste a token instead' }; }
    const scope = cut(Object.keys(cc.scopes || {}).join(' '), 300);
    return { auth: clean({ type: 'oauth2', tokenUrl, tokenBody: scheme['x-doca-token-body'] === 'json' ? 'json' : 'form', scope: scope || undefined }) };
  }
  return { auth: { type: 'bearer' }, warning: `its "${t}${scheme.in ? ` in ${scheme.in}` : ''}" sign-in is not one DOCA sends: a bearer token is assumed — an account with a sign-in page is a connector (Field → Connectors)` };
}

/** An OpenAPI 3.x or Swagger 2.0 document → { definition, warnings }. `from`: where it was read (a relative server). */
function fromDoc(doc, { from = null } = {}) {
  if (!doc || typeof doc !== 'object') throw bad('That is not an OpenAPI document.');
  const v2 = String(doc.swagger || '').startsWith('2');
  if (!v2 && !/^3\./.test(String(doc.openapi || '')) && !doc.paths) throw bad('That is not an OpenAPI document: it has no "openapi" version and no paths.');
  const deref = resolver(doc), warnings = [];
  let server = null;
  if (v2) { if (doc.host) server = `${(doc.schemes || ['https'])[0]}://${doc.host}${doc.basePath || ''}`; }
  else if (doc.servers?.[0]?.url) {
    const s = doc.servers[0];
    server = String(s.url).replace(/\{([^}]+)\}/g, (m, k) => s.variables?.[k]?.default ?? m);
  }
  if (server) { try { server = new URL(server, from || undefined).toString().replace(/\/$/, ''); } catch { warnings.push(`its server "${server}" is not an address: give the address`); server = null; } }
  const schemes = v2 ? doc.securityDefinitions || {} : doc.components?.securitySchemes || {};
  const firstSec = [...(doc.security || []), ...Object.values(doc.paths || {}).flatMap(p => METHODS.flatMap(m => p?.[m]?.security || []))].find(s => s && Object.keys(s).length);
  const schemeName = firstSec ? Object.keys(firstSec)[0] : Object.keys(schemes)[0];
  const { auth, warning } = authOf(schemeName ? deref(schemes[schemeName]) : null, server);
  if (warning) warnings.push(warning);
  const actions = [], seen = new Set();
  for (const [p, item] of Object.entries(doc.paths || {})) {
    const shared = (item.parameters || []).map(x => deref(x));
    for (const m of METHODS) {
      const op = item[m];
      if (!op || typeof op !== 'object') continue;
      if (actions.length >= 400) { warnings.push('only the first 400 operations were kept'); break; }
      let name = NAME(op.operationId) || NAME(`${m}_${p}`);
      while (seen.has(name)) name = `${name}_2`;
      seen.add(name);
      const own = (op.parameters || []).map(x => deref(x));
      const all = [...shared.filter(s => !own.some(o => o.name === s.name && o.in === s.in)), ...own];
      const params = all.filter(x => ['path', 'query', 'header'].includes(x.in)).slice(0, 60).map(x => ({ ...field(x.name, x.schema || x, deref, !!x.required || x.in === 'path'), in: x.in }))
        .map(({ file, many, ...x }) => x);
      let body = null;
      if (v2) {
        const formData = all.filter(x => x.in === 'formData'), inBody = all.find(x => x.in === 'body');
        if (formData.length) body = clean({ kind: formData.some(x => x.type === 'file') || (op.consumes || doc.consumes || []).includes('multipart/form-data') ? 'multipart' : 'form',
          fields: formData.slice(0, 60).map(x => field(x.name, x, deref, !!x.required)) });
        else if (inBody) body = bodyOf({ required: inBody.required, content: { 'application/json': { schema: inBody.schema } } }, deref);
      } else if (op.requestBody) body = bodyOf(op.requestBody, deref);
      let job;
      try { job = jobOf(op['x-doca-job']); } catch (e) { warnings.push(`${name}: ${e.message}`); }
      actions.push(clean({ name, method: m.toUpperCase(), path: p, summary: cut(op.summary || op.description, 200), params, body: body || undefined, job }));
    }
  }
  for (const a of actions) if (a.job && !actions.some(b => b.name === a.job.poll.operation)) warnings.push(`${a.name}: its job asks after "${a.job.poll.operation}", which is not an operation here`);
  const info = doc.info || {};
  return { definition: clean({ title: cut(info.title, 80), note: cut(info['x-doca-note'] || info.summary || info.description, 200), docs: cut(doc.externalDocs?.url, 300),
    server, auth, actions, name: cut(info['x-doca-name'], 40), keyHint: cut(info['x-doca-key-hint'], 200), skill: cut(info['x-doca-skill'], 40),
    headers: headersOf(info['x-doca-headers']), rate: rateOf(info['x-doca-rate']) }), warnings };
}

/** x-doca-headers: headers every request carries that are not the key ({"X-Client": "doca"}); x-doca-rate: {perMinute}. */
function headersOf(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return undefined;
  const out = Object.fromEntries(Object.entries(h).filter(([k, v]) => /^[A-Za-z0-9-]{1,60}$/.test(k) && ['string', 'number'].includes(typeof v)).slice(0, 20).map(([k, v]) => [k, String(v).slice(0, 500)]));
  return Object.keys(out).length ? out : undefined;
}
function rateOf(r) { const n = Math.floor(Number(r?.perMinute)); return n >= 1 && n <= 100000 ? { perMinute: n } : undefined; }

function schemaOf(f) {
  const item = clean({ type: f.many ? (f.type || '').replace(/^array of /, '') || 'string' : f.file ? 'string' : f.type || 'string',
    format: f.file ? 'binary' : undefined, enum: f.enum });
  return clean(f.many ? { type: 'array', items: item, description: f.description, default: f.default } : { ...item, description: f.description, default: f.default });
}

/** A definition → an OpenAPI 3.1 document (no key in it: the key lives in keys/services.json only). */
function toDoc(def) {
  const scheme = {
    apiKey: () => clean({ type: 'apiKey', in: def.auth.in, name: def.auth.name, 'x-doca-prefix': def.auth.prefix || undefined }),
    bearer: () => ({ type: 'http', scheme: 'bearer' }),
    basic: () => ({ type: 'http', scheme: 'basic' }),
    oauth2: () => clean({ type: 'oauth2', flows: { clientCredentials: { tokenUrl: def.auth.tokenUrl, scopes: Object.fromEntries(String(def.auth.scope || '').split(/\s+/).filter(Boolean).map(x => [x, ''])) } },
      'x-doca-token-body': def.auth.tokenBody === 'json' ? 'json' : undefined }),
  }[def.auth?.type];
  const paths = {};
  for (const a of def.actions || []) {
    const body = a.body && {
      required: a.body.required || undefined,
      content: { [{ multipart: 'multipart/form-data', form: 'application/x-www-form-urlencoded', json: 'application/json' }[a.body.kind] || 'application/json']: {
        schema: clean({ type: 'object', properties: Object.fromEntries((a.body.fields || []).map(f => [f.name, schemaOf(f)])),
          required: (a.body.fields || []).filter(f => f.required).map(f => f.name) }) } } };
    (paths[a.path] ||= {})[a.method.toLowerCase()] = clean({ operationId: a.name, summary: a.summary,
      parameters: (a.params || []).map(x => clean({ name: x.name, in: x.in, required: x.in === 'path' ? true : x.required, description: x.description, schema: schemaOf(x) })),
      requestBody: body ? clean(body) : undefined, responses: { 200: { description: 'The answer' } }, 'x-doca-job': a.job });
  }
  return clean({ openapi: '3.1.0', info: clean({ title: def.title || def.name, version: '1', summary: def.note || undefined, 'x-doca-name': def.name, 'x-doca-key-hint': def.keyHint || undefined, 'x-doca-skill': def.skill || undefined,
      'x-doca-headers': headersOf(def.headers), 'x-doca-rate': rateOf(def.rate) }),
    externalDocs: def.docs ? { url: def.docs } : undefined, servers: [{ url: def.server }],
    components: scheme ? { securitySchemes: { key: scheme() } } : undefined, security: scheme ? [{ key: [] }] : undefined, paths });
}

module.exports = { fromDoc, toDoc, jobOf, authOf, NAME, headersOf, rateOf };

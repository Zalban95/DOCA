'use strict';

/**
 * What each API service does — its server, how its key is sent and its actions — kept in DATA_DIR/keys/api-services.json,
 * beside the keys and inside the protected keys folder (paths.PROTECTED_DIRS): the agent's file tools cannot write it,
 * and no tool changes it, because a definition decides where a key goes. The key itself stays in keys/services.json
 * (service-keys.js), under the same name; a key saved before this (no definition) is a service with no actions yet,
 * still reached by api_call. A person saves a definition (Field → Connectors → API services, a pack's import, a draft's
 * Save); the agent only drafts one (service-drafts.js).
 */
const fs = require('fs');
const path = require('path');
const keys = () => require('../service-keys');

const file = () => require('../paths').API_SERVICES_FILE;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const all = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
function write(d) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 }); try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ } }

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const AUTH = ['apiKey', 'bearer', 'basic', 'oauth2', 'none'];
const METHOD = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const KIND = ['json', 'form', 'multipart'];

/** Where service-keys.js puts the key for this way of sending it. */
function keyPlace(auth = {}) {
  if (auth.type === 'apiKey') return auth.in === 'query' ? { place: 'query', field: auth.name } : { place: 'header', field: auth.name, prefix: auth.prefix || '' };
  if (auth.type === 'basic') return { place: 'basic' };
  if (auth.type === 'oauth2') return { place: 'exchange', field: auth.tokenUrl, ...(auth.tokenBody === 'json' ? {} : { grant: 'client_credentials' }) };
  return { place: 'header', field: 'Authorization', prefix: 'Bearer ' };   // bearer
}

/** The way a key saved without a definition is sent, said as a definition says it. */
function authOfKey(k) {
  if (k.place === 'query') return { type: 'apiKey', in: 'query', name: k.field };
  if (k.place === 'basic') return { type: 'basic' };
  if (k.place === 'exchange') return { type: 'oauth2', tokenUrl: k.field, tokenBody: k.grant === 'client_credentials' ? 'form' : 'json' };
  if (k.field === 'Authorization' && k.prefix === 'Bearer ') return { type: 'bearer' };
  return { type: 'apiKey', in: 'header', name: k.field, ...(k.prefix ? { prefix: k.prefix } : {}) };
}

/** A definition checked as a whole: nothing in it may send a key anywhere but the service's own origin. */
function check(def, { rekey = false } = {}) {
  const name = String(def.name || '').trim().toLowerCase();
  if (!NAME.test(name)) throw bad('A service\'s name is short, lowercase letters, digits and dashes: hi3d, weather-api.');
  let server;
  try { server = new URL(String(def.server || '')); } catch { throw bad('Give the service\'s address, like https://api.example.com/v1.'); }
  if (!/^https?:$/.test(server.protocol) || server.username || server.password || server.search || server.hash) throw bad('The address is a plain http(s) one, without a query.');
  const origin = server.origin, auth = { ...(def.auth || { type: 'bearer' }) };
  if (!AUTH.includes(auth.type)) throw bad(`The key is sent as one of: ${AUTH.join(', ')}.`);
  if (auth.type === 'apiKey' && (!['header', 'query'].includes(auth.in) || !/^[A-Za-z0-9_.-]{1,80}$/.test(auth.name || ''))) throw bad('An API key goes in a header or the query, under a name like X-API-Key or api_key.');
  if (auth.type === 'oauth2') { let t; try { t = new URL(auth.tokenUrl); } catch { throw bad('Give the token address.'); } if (t.origin !== origin) throw bad('The token address is on the service\'s own address.'); }
  // No key: only an address of the owner's own (this machine, the LAN, the tailnet). A stranger's API without a key is
  // the open web, which is read through the airlock (CONSTITUTION S6) — not reached with actions around it.
  if (auth.type === 'none' && !require('../harness/toolbox/http').owned(origin)) throw bad('A service without a key must be one of your own addresses (this machine, the local network, the tailnet). An API on the internet needs its key.');
  const have = keys().list().find(k => k.name === name);
  if (have && have.origin !== origin && !rekey) throw bad(`The key "${name}" is sent only to ${have.origin}: save the service with that address, or paste the key again with the new one.`, 409);
  const actions = (def.actions || []).slice(0, 400).map(a => {
    const op = require('./openapi').NAME(a.name);
    if (!op || !METHOD.includes(String(a.method || '').toUpperCase()) || !/^\/[^\s?#]*$/.test(String(a.path || ''))) throw bad(`An action needs a name, a method (${METHOD.join(', ')}) and a path starting with /: "${a.name || a.path}".`);
    if (a.body && !KIND.includes(a.body.kind)) throw bad(`${op}: a body is json, form or multipart.`);
    return { ...a, name: op, method: String(a.method).toUpperCase(), job: a.job ? require('./openapi').jobOf(a.job) : undefined };
  });
  const names = new Set(actions.map(a => a.name));
  if (names.size !== actions.length) throw bad('Two actions have the same name.');
  for (const a of actions) if (a.job && !names.has(a.job.poll.operation)) throw bad(`${a.name}: its job asks after "${a.job.poll.operation}", which is not one of the actions.`);
  return { name, title: String(def.title || name).slice(0, 80), note: String(def.note || '').slice(0, 200), docs: def.docs ? String(def.docs).slice(0, 300) : '',
    keyHint: def.keyHint ? String(def.keyHint).slice(0, 200) : '',
    skill: /^[a-z0-9][a-z0-9-]{0,40}$/.test(String(def.skill || '')) ? String(def.skill) : '',   // the skill that says when and why (skills.js servicesNote)
    server: server.toString().replace(/\/$/, ''), origin, auth, actions: JSON.parse(JSON.stringify(actions)), source: String(def.source || 'hand').slice(0, 40) };
}

/** Keep a definition (a person's Save). Returns its view. */
function save(def, opts) {
  const d = check(def, opts);
  const all_ = all();
  all_[d.name] = { ...d, savedAt: new Date().toISOString() };
  write(all_);
  return view(d.name);
}

function remove(name) { const d = all(); if (!d[name]) throw bad('No such service.', 404); delete d[name]; write(d); return { removed: name }; }

/** The definition to call: a saved one, or a key saved before definitions (no actions, the key's own way). */
function get(name) {
  name = String(name || '').trim().toLowerCase();
  const d = all()[name];
  if (d) return d;
  const k = keys().list().find(x => x.name === name);
  return k ? { name, title: name, note: k.note, server: k.origin, origin: k.origin, auth: authOfKey(k), actions: [], source: 'key' } : null;
}

/** What a browser and the agent see: never the key, only whether there is one and who may use it. */
function view(name) {
  const d = get(name);
  if (!d) return null;
  const k = keys().list().find(x => x.name === d.name);
  return { name: d.name, title: d.title, note: d.note || k?.note || '', docs: d.docs || '', keyHint: d.keyHint || '', skill: d.skill || '', server: d.server, origin: d.origin, auth: d.auth, source: d.source,
    hasKey: !!k?.hasKey, who: k?.who || 'host', needsKey: d.auth.type !== 'none' && !k?.hasKey, savedAt: d.savedAt || k?.savedAt || null,
    actions: d.actions.map(a => ({ name: a.name, method: a.method, path: a.path, summary: a.summary || '', job: !!a.job, files: (a.body?.fields || []).filter(f => f.file).map(f => f.name) })) };
}

/** Every service: those with a definition and the keys saved before definitions. */
function list() {
  const names = new Set([...Object.keys(all()), ...keys().list().map(k => k.name)]);
  return [...names].sort().map(view).filter(Boolean);
}

module.exports = { list, get, view, save, remove, check, keyPlace, authOfKey };

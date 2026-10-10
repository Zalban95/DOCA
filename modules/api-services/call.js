'use strict';

/**
 * One action of an API service, sent: its parameters put where the definition says (the path, the query, a header, the
 * body as JSON, a form or a multipart upload with files), and sent through api_call's own request (toolbox/http.js
 * send) — so the key is added by the hub only for the service's own origin, redirects are followed hop by hop and never
 * carry it elsewhere, and what comes back is scrubbed of it. A result file is kept the way api_call's save_as keeps one.
 */
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const HOP = new Set(['authorization', 'cookie', 'proxy-authorization', 'host']);

/** A value at a dotted path (`data.task_id`, `output[0]`, `urls.get`). */
function pick(obj, p) {
  if (!p) return undefined;
  return String(p).split(/\.|(?=\[)/).reduce((o, k) => {
    if (o == null) return undefined;
    const ix = /^\[(\d+)\]$/.exec(k);
    return ix ? o[Number(ix[1])] : o[k];
  }, obj);
}

/** The request an action makes with these parameters and files: { url, method, headers, body, form, files } or an error. */
function build(def, a, params = {}, files = {}) {
  params = params && typeof params === 'object' ? { ...params } : {};
  files = files && typeof files === 'object' ? files : {};
  const missing = (a.params || []).filter(p => p.required && params[p.name] === undefined && !(p.default !== undefined)).map(p => p.name);
  if (missing.length) throw bad(`${a.name} needs ${missing.join(', ')}.`);
  let p = a.path;
  const u = new URL(def.server);
  const query = new URLSearchParams(), headers = { ...(def.headers || {}) };   // the service's own extra headers; a parameter's win
  for (const x of a.params || []) {
    const v = params[x.name] !== undefined ? params[x.name] : x.default;
    delete params[x.name];
    if (v === undefined) continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (x.in === 'path') p = p.split(`{${x.name}}`).join(encodeURIComponent(s));
    else if (x.in === 'query') query.append(x.name, s);
    else if (x.in === 'header') {
      const keyHeader = def.auth?.type === 'apiKey' && def.auth.in === 'header' ? def.auth.name.toLowerCase() : null;
      if (HOP.has(x.name.toLowerCase()) || x.name.toLowerCase() === keyHeader) throw bad(`${x.name} is set by the hub, never by a parameter.`);
      headers[x.name] = s;
    }
  }
  if (/\{[^}]+\}/.test(p)) throw bad(`${a.name} needs ${p.match(/\{([^}]+)\}/g).join(', ')} in its path.`);
  const url = new URL(u.pathname.replace(/\/$/, '') + p, u.origin);
  query.forEach((v, k) => url.searchParams.append(k, v));
  if (url.origin !== def.origin) throw bad('That action does not stay on the service\'s own address.');
  const rest = Object.keys(params), out = { url: url.toString(), method: a.method, headers };
  if (!a.body) {
    if (rest.length || Object.keys(files).length) throw bad(`${a.name} takes ${(a.params || []).map(x => x.name).join(', ') || 'no parameters'}; not ${[...rest, ...Object.keys(files)].join(', ')}.`);
    return out;
  }
  const declared = new Set((a.body.fields || []).map(f => f.name));
  if (a.body.kind === 'json') {
    if (Object.keys(files).length) throw bad(`${a.name} takes JSON, not files.`);
    const body = rest.length === 1 && rest[0] === 'body' && typeof params.body === 'object' && !declared.has('body') ? params.body : params;
    if (Object.keys(body).length || a.body.required) out.body = JSON.stringify(body);
    return out;
  }
  const form = {};
  for (const k of rest) form[k] = typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k];
  if (a.body.kind === 'form') {
    if (Object.keys(files).length) throw bad(`${a.name} takes a form without files.`);
    out.body = new URLSearchParams(form).toString();
    out.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return out;
  }
  const fileFields = (a.body.fields || []).filter(f => f.file).map(f => f.name);
  const wrong = Object.keys(files).filter(f => fileFields.length && !fileFields.includes(f));
  if (wrong.length) throw bad(`${a.name} takes files as ${fileFields.join(', ')}; not ${wrong.join(', ')}.`);
  return { ...out, form, files };
}

/**
 * The service's own limit (`rate.perMinute`, set where it is saved): a request over it waits its turn — up to a minute,
 * so a job's polls are spaced rather than refused — and past that is refused with how long until there is room.
 */
const _sent = new Map();   // service name → times of the requests in the last minute (in memory)
async function pace(def) {
  const n = def.rate?.perMinute;
  if (!n) return null;
  const now = Date.now(), times = (_sent.get(def.name) || []).filter(t => t > now - 60000);
  const wait = times.length >= n ? times[times.length - n] + 60000 - now : 0;
  if (wait > 60000) return `Error: ${def.name} is held to ${n} request${n === 1 ? '' : 's'} a minute (its rate limit in Field → Connectors → API services); try again in ${Math.ceil(wait / 1000)} s.`;
  times.push(now + wait);
  _sent.set(def.name, times);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return null;
}

/** Send an action. → { status, statusText, ok, text, json } (text scrubbed of the key) or { error }. */
async function send(def, a, { params, files, ctx = {} } = {}) {
  let req;
  try { req = build(def, a, params, files); } catch (e) { return { error: `Error: ${e.message}` }; }
  const held = await pace(def);
  if (held) return { error: held };
  const http = require('../harness/toolbox/http');
  if (def.auth.type === 'none' && !http.owned(req.url)) return { error: 'Error: a service without a key is reached only on the owner\'s own addresses.' };
  const sent = await http.send({ ...req, key: def.auth.type === 'none' ? undefined : def.name }, { user: ctx.user, sessionId: ctx.sessionId });
  if (sent.error) return { error: sent.error };
  const keys = require('../service-keys');
  const text = keys.scrub(await sent.r.text(), sent.secret, sent.token);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: the text is the answer */ }
  return { status: sent.r.status, statusText: sent.r.statusText, ok: sent.r.ok, text, json };
}

/**
 * A result file kept as an attachment: from the service's own address with its key, from anywhere else (a CDN's link)
 * without one and only as a file — text from a stranger's address would be the open web read around the airlock.
 */
async function keep(def, url, name, { ctx = {} } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return { error: `the result "${String(url).slice(0, 80)}" is not an address` }; }
  if (!/^https?:$/.test(u.protocol)) return { error: `the result is a ${u.protocol} address, which is not fetched` };
  const http = require('../harness/toolbox/http');
  const mine = u.origin === def.origin && def.auth.type !== 'none';
  const sent = await http.send({ url: u.toString(), method: 'GET', key: mine ? def.name : undefined, save_as: name }, { user: ctx.user });
  if (sent.error) return { error: sent.error.replace(/^Error: /, '') };
  if (!sent.r.ok) return { error: `HTTP ${sent.r.status} fetching the result` };
  const bytes = Buffer.from(await sent.r.arrayBuffer());
  const type = sent.r.headers.get('content-type') || '';
  if (!mine && !http.owned(u.toString()) && http.looksText(type, bytes)) return { error: `the result at ${u.host} is text (${type || 'no type'}), not a file` };
  const at = require('../attachments');
  const ext = (/\.([a-z0-9]{1,8})$/i.exec(u.pathname) || [])[1];
  const file = /\.[a-z0-9]{1,8}$/i.test(name) || !ext ? name : `${name}.${ext.toLowerCase()}`;
  try {
    const rec = at.save(bytes, file.replace(/[\\/]/g, '_').slice(0, 120), { from: `service:${def.name}`, ...(/^(application\/octet-stream|binary\/|text\/plain)/.test(type || 'application/octet-stream') ? {} : { mime: type }) });
    return { name: rec.name, path: rec.path, bytes: bytes.length, size: at.humanBytes(bytes.length), model: at.playableKind(at.mimeFor(rec.name)) === 'model' };
  } catch (e) { return { error: e.message }; }
}

module.exports = { build, send, keep, pick, pace };

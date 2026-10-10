'use strict';

/**
 * The form's one box — "Service name, address or docs link" — answered as far as the hub can (asked 2026-10-08: "all
 * as aided as possible"). A name offers the shipped templates it matches; an address or a docs link makes the hub look
 * for the service's OpenAPI document: the link itself when it is one, else the places specs are usually published
 * (/openapi.json, /swagger.json, /v3/api-docs, /.well-known/openapi…) on that address and on the api. host beside a
 * docs. one, else the links to a spec on the docs page. Every fetch is a GET whose answer is only parsed as data —
 * never run, never shown to an agent — with redirects followed hop by hop to http(s) only, 10 s and 15 MB each.
 * Nothing found is said with what was tried, and the form offers to ask the agent to prepare it (service_draft).
 */
const PLACES = ['/openapi.json', '/openapi.yaml', '/openapi.yml', '/swagger.json', '/swagger.yaml', '/v3/api-docs', '/v2/api-docs',
  '/.well-known/openapi.json', '/.well-known/openapi.yaml', '/.well-known/openapi', '/api/openapi.json', '/api-docs', '/api/swagger.json',
  '/docs/openapi.json', '/swagger/v1/swagger.json', '/v1/openapi.json'];
const MAX = 15 * 1024 * 1024;

/** One GET: { url, type, text } or null. */
async function get(url) {
  for (let hop = 0; hop < 5; hop++) {
    let r;
    try { r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json, application/yaml, text/yaml, text/html;q=0.5, */*;q=0.1' } }); }
    catch { return null; }
    const loc = r.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(r.status) && loc) {
      let next; try { next = new URL(loc, url); } catch { return null; }
      if (!/^https?:$/.test(next.protocol)) return null;
      url = next.toString();
      continue;
    }
    if (!r.ok) return null;
    if (Number(r.headers.get('content-length') || 0) > MAX) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > MAX ? null : { url, type: r.headers.get('content-type') || '', text: buf.toString('utf8') };
  }
  return null;
}

/** The document in a text, when it is an OpenAPI or Swagger one. */
function specIn(text) {
  if (!/(openapi|swagger)\W/i.test(String(text).slice(0, 4000)) && !/"(openapi|swagger)"\s*:/.test(text)) return null;
  try { const d = require('./yaml').read(text); return d && typeof d === 'object' && (d.openapi || d.swagger) && d.paths ? d : null; } catch { return null; }
}

/** Links on a docs page that look like a spec. */
function linksIn(html, base) {
  const out = new Set();
  for (const m of String(html).slice(0, 2e6).matchAll(/["'(]([^"'()\s<>]*?(?:openapi|swagger|api-docs)[^"'()\s<>]*?)["')]/gi)) {
    if (!/\.(json|ya?ml)(\?|$)|api-docs/i.test(m[1])) continue;
    try { out.add(new URL(m[1].replace(/&amp;/g, '&'), base).toString()); } catch { /* not an address */ }
  }
  return [...out].filter(u => /^https?:/.test(u)).slice(0, 6);
}

function templatesFor(words) {
  const t = String(words).toLowerCase().replace(/^https?:\/\//, '');
  return require('./templates').list().filter(x => {
    const server = (() => { try { return new URL(require('./templates').load(x.id).definition.server).host; } catch { return ''; } })();
    return t.includes(x.id) || x.title.toLowerCase().includes(t) || (server && t.includes(server.split('.').slice(-2, -1)[0] || '\u0000'));
  });
}

async function find(input) {
  const raw = String(input || '').trim().slice(0, 500);
  if (!raw) return { templates: require('./templates').list(), found: null, tried: [] };
  const templates = templatesFor(raw);
  const looksAddress = /^https?:\/\//i.test(raw) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(raw);
  if (!looksAddress) return { templates, found: null, tried: [] };
  let start;
  try { start = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { templates, found: null, tried: [] }; }
  const tried = [];
  const attempt = async url => { tried.push(url); const r = await get(url); const doc = r && specIn(r.text); return doc ? { doc, url: r.url } : { page: r }; };
  const first = await attempt(start.toString());
  if (first.doc) return { templates, ...read(first) , tried };
  const hosts = [start.origin];
  const m = /^(docs|developers?|dev|api-docs|platform)\.(.+)$/.exec(start.host);
  if (m) hosts.push(`${start.protocol}//api.${m[2]}`);
  const candidates = [...(first.page && /html/i.test(first.page.type) ? linksIn(first.page.text, first.page.url) : []), ...hosts.flatMap(o => PLACES.map(p => o + p))];
  const results = await Promise.all([...new Set(candidates)].map(async u => ({ u, r: await attempt(u) })));
  const hit = results.find(x => x.r.doc);
  if (hit) return { templates, ...read(hit.r), tried };
  return { templates, found: null, tried, docs: start.toString() };
}

function read({ doc, url }) {
  const r = require('./openapi').fromDoc(doc, { from: url });
  return { found: url, definition: { ...r.definition, source: 'import', docs: r.definition.docs || url }, warnings: r.warnings };
}

module.exports = { find, specIn, linksIn, templatesFor, PLACES };

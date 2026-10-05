'use strict';

/**
 * Web search as a provider choice (TODO H14; OpenDots offers Parallel or the browser): one `search(query)` over
 * whichever the owner picked — results as {title, url, snippet}, never a page body.
 *
 *   searxng     a SearXNG instance (self-hosted, no key): `search.url`
 *   brave       Brave Search API (a key)
 *   tavily      Tavily (a key)
 *   duckduckgo  DuckDuckGo's HTML page (no key; fragile by nature — the fallback, not a promise)
 *
 * The provider and the SearXNG address are prefs (`search`, declared in settings-schema.js); a key is a secret
 * kept in DATA_DIR/keys/search.json (mode 0600, refused to the file tools like the model providers' keys).
 * What comes back is somebody else's words: the tool frames it as external content, and while specialists are
 * on only the airlock specialists search (registry.AIRLOCK_ONLY), as only they read the web.
 */
const fs = require('fs');
const path = require('path');
const { SEARCH_KEYS_FILE } = require('../paths');

const PROVIDERS = ['searxng', 'brave', 'tavily', 'duckduckgo'];
const prefs = () => require('../utils').loadPrefs().search || {};
const provider = () => (PROVIDERS.includes(prefs().provider) ? prefs().provider : 'duckduckgo');

function keys() { try { return JSON.parse(fs.readFileSync(SEARCH_KEYS_FILE, 'utf8')); } catch { return {}; } }
function setKey(name, key) {
  if (!['brave', 'tavily'].includes(name)) throw Object.assign(new Error('Only brave and tavily take a key.'), { status: 400 });
  const k = keys();
  if (key) k[name] = String(key).trim(); else delete k[name];
  fs.mkdirSync(path.dirname(SEARCH_KEYS_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(SEARCH_KEYS_FILE, JSON.stringify(k), { mode: 0o600 });
  try { fs.chmodSync(SEARCH_KEYS_FILE, 0o600); } catch { /* Windows */ }
}

const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const get = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'DOCA search', Accept: 'application/json, text/html', ...(init.headers || {}) } });

async function searxng(q, n) {
  const base = String(prefs().url || '').replace(/\/+$/, '');
  if (!base) throw new Error('SearXNG is chosen but search.url is empty — set it in Settings → Harness → Web search.');
  const r = await get(`${base}/search?format=json&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`SearXNG answered ${r.status} (its JSON format must be enabled in its settings.yml).`);
  return (await r.json()).results.slice(0, n).map(x => ({ title: x.title, url: x.url, snippet: strip(x.content) }));
}

async function brave(q, n) {
  const key = keys().brave;
  if (!key) throw new Error('Brave Search is chosen but has no key — add it in Settings → Harness → Web search.');
  const r = await get(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, { headers: { 'X-Subscription-Token': key } });
  if (!r.ok) throw new Error(`Brave Search answered ${r.status}.`);
  return ((await r.json()).web?.results || []).slice(0, n).map(x => ({ title: x.title, url: x.url, snippet: strip(x.description) }));
}

async function tavily(q, n) {
  const key = keys().tavily;
  if (!key) throw new Error('Tavily is chosen but has no key — add it in Settings → Harness → Web search.');
  const r = await get('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query: q, max_results: n }) });
  if (!r.ok) throw new Error(`Tavily answered ${r.status}.`);
  return ((await r.json()).results || []).slice(0, n).map(x => ({ title: x.title, url: x.url, snippet: strip(x.content) }));
}

/** DuckDuckGo's HTML endpoint, read for its result links; each one's snippet is looked for before the next link. */
function parseDdg(html, n) {
  const links = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  return links.slice(0, n).map((m, i) => {
    let url = m[1].replace(/&amp;/g, '&');
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    const between = html.slice(m.index + m[0].length, links[i + 1]?.index ?? html.length);
    const snip = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(between);
    return { title: strip(m[2]), url, snippet: strip(snip?.[1]) };
  });
}
async function duckduckgo(q, n) {
  const r = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`DuckDuckGo answered ${r.status}.`);
  return parseDdg(await r.text(), n);
}

/** @returns {Promise<{provider, results: Array<{title, url, snippet}>}>} */
async function search(query, { count = 8 } = {}) {
  const q = String(query || '').trim().slice(0, 400);
  if (!q) throw Object.assign(new Error('Say what to search for.'), { status: 400 });
  const n = Math.max(1, Math.min(20, Number(count) || 8));
  const p = provider();
  const results = await ({ searxng, brave, tavily, duckduckgo }[p])(q, n);
  return { provider: p, results };
}

function status() {
  const k = keys();
  return { provider: provider(), url: prefs().url || '', keys: { brave: !!k.brave, tavily: !!k.tavily }, providers: PROVIDERS };
}

module.exports = { search, status, setKey, parseDdg, PROVIDERS };

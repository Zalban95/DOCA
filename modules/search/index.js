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

const keys = () => require('../keys-file').read(SEARCH_KEYS_FILE);   // keys-file.js: never read empty by mistake
function setKey(name, key) {
  if (!['brave', 'tavily'].includes(name)) throw Object.assign(new Error('Only brave and tavily take a key.'), { status: 400 });
  const k = keys();
  if (key) k[name] = String(key).trim(); else delete k[name];
  fs.mkdirSync(path.dirname(SEARCH_KEYS_FILE), { recursive: true, mode: 0o700 });
  require('../keys-file').write(SEARCH_KEYS_FILE, k, { compact: true });
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
// DuckDuckGo's page answers a burst with a bot check (a 202, or a 200 holding its "anomaly" form), which read as no
// results: five Scouts searching at once were told "No results" for most of an afternoon (2026-10-14). So searches go
// one at a time, a little apart, and a refusal is said as one.
const DDG_GAP_MS = 1500;
let ddgQueue = Promise.resolve(), ddgLast = 0;
const REFUSED = /anomaly-modal|anomaly\.js|bots use DuckDuckGo too|challenge-form/i;

function duckduckgo(q, n) {
  const turn = ddgQueue.then(async () => {
    const wait = ddgLast + DDG_GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      const r = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
      const text = r.ok ? await r.text() : '';
      if (r.status === 202 || (r.ok && REFUSED.test(text)) || r.status === 429 || r.status === 403)
        throw Object.assign(new Error('DuckDuckGo is refusing searches from here for now (it took them for a bot). Wait a few minutes, '
          + 'or set up a search of your own — SearXNG, Brave or Tavily — in Settings → Harness → Web search.'), { refused: true });
      if (!r.ok) throw new Error(`DuckDuckGo answered ${r.status}.`);
      return parseDdg(text, n);
    } finally { ddgLast = Date.now(); }
  });
  ddgQueue = turn.catch(() => {});
  return turn;
}

/** @returns {Promise<{provider, results: Array<{title, url, snippet}>}>} */
async function search(query, { count = 8 } = {}) {
  const q = String(query || '').trim().slice(0, 400);
  if (!q) throw Object.assign(new Error('Say what to search for.'), { status: 400 });
  const n = Math.max(1, Math.min(20, Number(count) || 8));
  const p = provider();
  require('../features/usage').count(`search:${p}`);   // which provider is still used (features/review.js)
  const results = await ({ searxng, brave, tavily, duckduckgo }[p])(q, n);
  return { provider: p, results };
}

function status() {
  const k = keys();
  return { provider: provider(), url: prefs().url || '', keys: { brave: !!k.brave, tavily: !!k.tavily }, providers: PROVIDERS };
}

module.exports = { search, status, setKey, parseDdg, duckduckgo, PROVIDERS };

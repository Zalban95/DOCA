/* Settings → Harness → Web search (modules/search; TODO H14): which provider the agents' web_search uses —
   SearXNG (yours, no key), Brave or Tavily (a key), or DuckDuckGo (no key, the fallback) — and a try. */
async function searchCardRender(panel) {
  let s;
  try { s = await apiFetch('/api/search/settings'); } catch { return; }
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'search-card' });
  document.getElementById('search-card')?.remove();
  card.innerHTML = `<div class="card-title">Web search</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:4px">Which search engine the agents use to search the web.</p>
    <details class="desc page-about" style="font-size:11px;color:var(--muted);margin-bottom:10px"><summary>What this is</summary>What the agents' <code>web_search</code> asks. Results are titles, addresses and snippets,
      framed as other people's words; while specialists are on, only the scout and the researcher search.</details>
    <div class="input-label">Search with${infoBtn('The search engine: DuckDuckGo needs nothing and is the fallback; SearXNG is one you run yourself (give its address); Brave and Tavily need a key from their sites.')}</div>
    <select class="input" id="search-provider" style="width:auto;margin-bottom:8px">${s.providers.map(p => `<option value="${p}" ${p === s.provider ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <div class="input-label">SearXNG address${infoBtn('Only for SearXNG: the address of your SearXNG server. Empty otherwise.')}</div>
    <input class="input" id="search-url" placeholder="e.g. http://127.0.0.1:8888" value="${escHtml(s.url || '')}" style="width:100%;margin-bottom:8px">
    <div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:flex-end">
      <div style="flex:1;min-width:180px"><div class="input-label">Brave key${infoBtn('Only for Brave: your Brave Search API key. Kept on the hub, never shown again; leave empty to keep the saved one.')}</div>
        <input class="input" id="search-key-brave" type="password" autocomplete="off" placeholder="${s.keys.brave ? 'Brave key saved' : 'Brave Search API key'}" style="width:100%"></div>
      <div style="flex:1;min-width:180px"><div class="input-label">Tavily key${infoBtn('Only for Tavily: your Tavily API key. Kept on the hub, never shown again; leave empty to keep the saved one.')}</div>
        <input class="input" id="search-key-tavily" type="password" autocomplete="off" placeholder="${s.keys.tavily ? 'Tavily key saved' : 'Tavily API key'}" style="width:100%"></div>
    </div>
    <button class="btn btn-sm btn-blue" onclick="searchSave()">Save</button>
    <button class="btn btn-sm" onclick="searchTry()">Try a search</button>
    <pre class="terminal" id="search-out" style="display:none;margin-top:8px;max-height:220px;white-space:pre-wrap"></pre>`;
  panel.append(card);
}

async function searchSave() {
  const v = id => document.getElementById(id).value.trim();
  const keys = {};
  if (v('search-key-brave')) keys.brave = v('search-key-brave');
  if (v('search-key-tavily')) keys.tavily = v('search-key-tavily');
  try { await apiFetch('/api/search/settings', { method: 'POST', body: { provider: v('search-provider'), url: v('search-url'), keys } }); appAlert('Saved.'); }
  catch (e) { appAlert(e.message); }
  searchCardRender(document.getElementById('sp-harness'));
}

async function searchTry() {
  const out = document.getElementById('search-out');
  out.style.display = ''; out.textContent = 'Searching…';
  try {
    const r = await apiFetch('/api/search/try', { method: 'POST', body: { query: 'DOCA agent harness' } });
    out.textContent = `${r.provider}: ${r.results.length} results\n\n${r.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}`).join('\n')}`;
  } catch (e) { out.textContent = `✗ ${e.message}`; }
}

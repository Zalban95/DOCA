/* Pages of connected services (modules/service-pages; asked 2026-10-15): a service with a web UI of its own — DoMac
   first — gets a page in its group only while it answers, drawn as its own UI in a frame on the canvas origin (another
   origin than the panel's), opened with a pass the hub makes for this person; its key is added by the hub, never here.
   Not answering, the page is not there. Field → Connectors → "Services with a page" sets them up. */

const SVC = { pages: [], loaded: new Set() };
const svcTab = id => `svc-${id}`;

/** The services this person sees now, placed in the nav (and taken out when they stop answering). */
async function servicePagesApply() {
  let pages = [];
  try { pages = (await apiFetch('/api/service-pages', { noAsk: true })).pages || []; } catch { pages = []; }
  SVC.pages = pages;
  const want = new Set(pages.map(p => svcTab(p.id)));
  for (const t of NAV_TABS.filter(t => t.startsWith('svc-') && !want.has(t))) {
    NAV_TABS.splice(NAV_TABS.indexOf(t), 1);
    for (const g of NAV_GROUPS) g.tabs = g.tabs.filter(x => x !== t);
    document.getElementById(`tab-${t}`)?.remove();
    SVC.loaded.delete(t);
    if (currentTab === t) nav('controls');
  }
  for (const p of pages) {
    const t = svcTab(p.id);
    if (!NAV_TABS.includes(t)) NAV_TABS.push(t);
    NAV_LABELS[t] = p.name;
    for (const g of NAV_GROUPS) g.tabs = g.tabs.filter(x => x !== t);
    (NAV_GROUPS.find(g => g.id === p.group) || NAV_GROUPS.at(-1))?.tabs.push(t);
    if (!document.getElementById(`tab-${t}`)) {
      const el = Object.assign(document.createElement('div'), { id: `tab-${t}`, className: 'tab-page svc-page' });
      el.innerHTML = `<div class="svc-frame-wrap"><div class="placeholder svc-wait">Opening ${escHtml(p.name)}…</div></div>`;
      document.getElementById('tab-settings')?.before(el);
    }
  }
  if (typeof navGroupsRender === 'function') navGroupsRender();
}

/** nav(): a service's page opens its frame once (its own UI keeps its state while the panel goes elsewhere). */
async function servicePagesTab(name) {
  if (!String(name).startsWith('svc-') || SVC.loaded.has(name)) return;
  const el = document.getElementById(`tab-${name}`);
  if (!el) return;
  SVC.loaded.add(name);
  const wrap = el.querySelector('.svc-frame-wrap');
  try {
    const r = await apiFetch(`/api/service-pages/${encodeURIComponent(name.slice(4))}/open`, { method: 'POST' });
    const f = Object.assign(document.createElement('iframe'), { className: 'svc-frame', title: r.name, src: r.url });
    // Its own origin already keeps it from the panel; the sandbox keeps it from navigating this page.
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals');   // a page it opens in a new tab (its install link) is a page of its own
    f.setAttribute('allow', 'fullscreen; clipboard-write');
    wrap.replaceChildren(f);
  } catch (e) {
    SVC.loaded.delete(name);
    wrap.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`;
  }
}

/* ── Field → Connectors: Services with a page ── */

async function servicePagesCard() {
  const card = document.getElementById('service-pages-card');
  if (!card) return;
  let d, keys = [];
  try { d = await apiFetch('/api/service-pages/all'); } catch (e) { card.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  try { keys = (await apiFetch('/api/connectors/keys/all')).keys || []; } catch { /* the form says to add one */ }
  const groupLabel = g => (typeof NAV_GROUPS !== 'undefined' && NAV_GROUPS.find(x => x.id === g)?.label) || g;
  const rows = d.services.map(s => `<div class="settings-tab-row"><span class="settings-tab-label" style="min-width:160px">
      <span class="pt ${s.state.up ? 'pt-run' : ''}" style="background:${s.state.up ? 'var(--green)' : 'var(--muted)'}"></span> ${escHtml(s.name)}</span>
      <span class="desc" style="flex:1">${escHtml(s.url)} · ${escHtml(groupLabel(s.group))} · ${s.who === 'everyone' ? 'everyone' : 'admins'}${s.key ? ` · key ${escHtml(s.key)}` : ''}
        — ${s.state.up ? 'answering: its page is shown' : `not shown: ${escHtml(s.state.why || 'not answering')}`}</span>
      <button class="btn btn-xs btn-red" type="button" onclick="servicePagesRemove(${jsArg(s.id)}, ${jsArg(s.name)})">Remove</button></div>`).join('');
  card.innerHTML = `<div class="card-title">Services with a page</div>
    <p class="desc">A service with a web interface of its own — DoMac, say — gets a page in the panel while it answers, showing its own interface. The hub sends it its key (from Keys for services); your browser never holds it. Not answering, the page is not there.</p>
    ${rows || '<p class="desc">None yet.</p>'}
    <div class="form-row" style="margin-top:10px"><label>Name</label><input id="svcp-name" class="input flex1" placeholder="DoMac"></div>
    <div class="form-row"><label>Address${infoBtn('Where the service answers, from this hub: http://127.0.0.1:4310, or its tailnet address.')}</label><input id="svcp-url" class="input flex1" placeholder="http://127.0.0.1:4310"></div>
    <div class="form-row"><label>Key${infoBtn('The key for services the hub sends it. Add it in Keys for services above, for this address.')}</label>
      <select id="svcp-key" class="input"><option value="">none</option>${keys.map(k => `<option value="${escHtml(k.name)}">${escHtml(k.name)}</option>`).join('')}</select></div>
    ${advancedFold(`<div class="form-row"><label>Group</label><select id="svcp-group" class="input" data-default="intelligence">${d.groups.map(g => `<option value="${g}"${g === 'intelligence' ? ' selected' : ''}>${escHtml(groupLabel(g))}</option>`).join('')}</select></div>
      <div class="form-row"><label>Who sees it</label><select id="svcp-who" class="input" data-default="admins"><option value="admins">Admins</option><option value="everyone">Everyone</option></select></div>
      <div class="form-row"><label>Health route${infoBtn('The path the hub asks to know it answers. Default /api/health.')}</label><input id="svcp-health" class="input" data-default="" placeholder="/api/health"></div>`, { id: 'service-pages', count: 3 })}
    <div style="margin-top:8px"><button class="btn btn-primary btn-sm" type="button" onclick="servicePagesSave(this)">Add</button> <span class="status-line" id="svcp-said"></span></div>`;
}

async function servicePagesSave(btn) {
  const v = id => document.getElementById(id)?.value.trim() || '';
  const said = document.getElementById('svcp-said');
  btn.disabled = true;
  try {
    const r = await apiFetch('/api/service-pages', { method: 'POST', body: { name: v('svcp-name'), url: v('svcp-url'), key: v('svcp-key'), group: v('svcp-group'), who: v('svcp-who'), health: v('svcp-health') || undefined } });
    setStatus(said, r.state.up ? `✓ ${r.service.name} answers: its page is in the panel` : `Saved; not answering yet — ${r.state.why}`, r.state.up ? 'ok' : '');
    await servicePagesCard(); await servicePagesApply();
  } catch (e) { setStatus(said, `✗ ${e.message}`, 'err'); }
  btn.disabled = false;
}

function servicePagesRemove(id, name) {
  appConfirm(`Remove the page of ${name}? The service itself is not touched.`, async () => {
    try { await apiFetch(`/api/service-pages/${encodeURIComponent(id)}`, { method: 'DELETE' }); await servicePagesCard(); await servicePagesApply(); }
    catch (e) { appAlert(e.message); }
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') window.addEventListener('load', () => {
  if (!document.getElementById('chat-fab')) return;   // the panel only
  setTimeout(servicePagesApply, 800);   // after the panel's own layout (panel-layout.js) has drawn the groups
  if (typeof liveOn === 'function') liveOn('screen', c => {
    if (c.what === 'services') servicePagesApply();
    if (c.what === 'layout') setTimeout(servicePagesApply, 300);   // a layout redrawn rebuilt the groups
  });
});

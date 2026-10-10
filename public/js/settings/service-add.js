/* One "Add a service" box, the same in Field → API keys → External providers (＋ Add) and in Field → Connectors → API
   services (asked 2026-10-10: setting up hi3d.ai, the owner filled the chat-model form, and never found the draft the
   agent had prepared). A name, an address or a docs link goes to the hub (POST /api/connectors/services/classify), which
   says in one line which it is and why: a chat-model endpoint opens the provider form here, tested; anything else — a
   ready-made service, an OpenAPI document found, a draft, or unknown — fills the API service form (going to Field →
   Connectors when the box is on API keys). A button switches to the other when the hub chose wrong. Suggestions under
   the box: what the agent prepared first, then the ready-made services, then the chat-model providers DOCA knows. */
let _svcAddData = null, _svcAddPending = null;
/** API services are a licensed feature (modules/license): without it the box still adds chat models. */
const _svcOn = () => typeof licenceFeatureOn !== 'function' || licenceFeatureOn('api-services');
const _svcAddLast = {};

function serviceAddBoxHtml(w) {
  return `<div class="svc-add" id="svc-add-${w}">
    <div class="card-title" style="margin-top:14px">Add a service</div>
    <p class="desc" style="margin-bottom:6px">A chat model (any OpenAI-compatible server, hosted or local) or any API with a key — type its name, address or docs link and the hub works out which.</p>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="sa-q-${w}" placeholder="Service name, address or docs link (hi3d, groq, http://192.168.1.20:8080, https://docs.example.com)" style="flex:1;min-width:220px"
        oninput="serviceAddSuggest('${w}')" onkeydown="if(event.key==='Enter'){event.preventDefault();serviceAddFind('${w}')}">
      <button class="btn btn-sm btn-primary" onclick="serviceAddFind('${w}')">Find</button></div>
    <div id="sa-sugg-${w}" class="svc-add-sugg"></div>
    <div id="sa-said-${w}" class="svc-add-said desc"></div>
    <div id="sa-form-${w}"></div></div>`;
}

/** The suggestions under the box, narrowed to what is typed (no request while typing: an address is read on Find). */
async function serviceAddSuggest(w) {
  const box = document.getElementById(`sa-sugg-${w}`);
  if (!box) return;
  if (!_svcAddData || Date.now() - _svcAddData.at > 30000) {
    try {
      _svcAddData = { at: Date.now(), ...(_svcOn() ? await apiFetch('/api/connectors/services/classify', { method: 'POST', body: { q: '' } })
        : { drafts: [], templates: [], presets: ((await apiFetch('/api/keys')).presets || []).map(p => ({ id: p.id, label: p.label, baseUrl: p.baseUrl })) }) };
    } catch { return; }
    serviceDraftBadge(_svcAddData.drafts || []);
  }
  const q = (document.getElementById(`sa-q-${w}`)?.value || '').trim().toLowerCase();
  const hit = (...words) => !q || /[/.:]/.test(q) || words.some(x => String(x || '').toLowerCase().includes(q));
  const chip = (cls, label, title, on) => `<button class="btn btn-xs ${cls}" title="${escHtml(title || '')}" onclick="${on}">${escHtml(label)}</button>`;
  const group = (label, chips) => (chips.length ? `<div class="svc-sugg-group"><span class="desc">${label}</span> ${chips.join(' ')}</div>` : '');
  const d = _svcAddData;
  box.innerHTML = group('Prepared by the agent:', (d.drafts || []).filter(x => hit(x.name, x.origin)).map(x => chip('btn-primary', `✦ ${x.name} — finish it`, `${x.origin}${x.note ? ` — ${x.note}` : ''}`, `serviceDraftGo(${jsArg(x.id)})`)))
    + group('Ready-made services:', (d.templates || []).filter(t => hit(t.id, t.title)).map(t => chip('', t.title, t.note, `serviceAddPick('${w}', 'template', ${jsArg(t.id)})`)))
    + group('Chat models:', (d.presets || []).filter(p => hit(p.id, p.label)).map(p => chip('', p.label, p.baseUrl, `serviceAddPick('${w}', 'preset', ${jsArg(p.id)})`)));
}

function serviceAddPick(w, kind, id) {
  if (kind === 'template') { const t = _svcAddData.templates.find(x => x.id === id); return serviceAddShow(w, { kind: 'service', template: id, why: `${t?.title || id} is an API service — a ready-made one.` }, id); }
  const p = _svcAddData.presets.find(x => x.id === id);
  serviceAddShow(w, { kind: 'provider', why: `${p.label} is a chat-model provider DOCA knows: its address is filled in, paste the key.`, provider: { name: p.id, baseUrl: p.baseUrl, preset: p.id } }, id);
}

async function serviceAddFind(w) {
  const input = document.getElementById(`sa-q-${w}`), q = input.value.trim();
  if (!q) return askFor(input, 'A name (hi3d, groq), an address (http://192.168.1.20:8080) or a docs link.');
  serviceAddSay(w, /[/.:]/.test(q) ? '<span class="pulse">Asking it whether it lists chat models, and looking for its OpenAPI document…</span>' : '');
  if (!_svcOn()) {   // chat models only: a known one by name, else the address as typed, tested
    await serviceAddSuggest(w);
    const p = (_svcAddData?.presets || []).find(x => [x.id, x.label.toLowerCase()].includes(q.toLowerCase()));
    serviceAddShow(w, { kind: 'provider', why: p ? `${p.label} is a chat-model provider DOCA knows.` : 'API services are not in this hive\'s licence, so it is added as a chat model — Test asks it which models it lists.',
      provider: p ? { name: p.id, baseUrl: p.baseUrl } : { name: '', baseUrl: /[/.:]/.test(q) ? q : '' }, only: true }, q);
    return;
  }
  let r;
  try { r = await apiFetch('/api/connectors/services/classify', { method: 'POST', body: { q } }); } catch (e) { return serviceAddSay(w, escHtml(e.message)); }
  serviceAddShow(w, r, q);
}

function serviceAddSay(w, html) { const el = document.getElementById(`sa-said-${w}`); if (el) el.innerHTML = html; }

/** The hub's answer: which form, why, and the switch to the other. */
function serviceAddShow(w, r, q) {
  _svcAddLast[w] = { r, q };
  const form = document.getElementById(`sa-form-${w}`), sugg = document.getElementById(`sa-sugg-${w}`);
  if (form) form.innerHTML = '';
  if (sugg) sugg.innerHTML = '';   // back when something is typed
  if (r.kind === 'service' && w !== 'services') {   // the API service form lives in Field → Connectors
    _svcAddPending = { r, q };
    serviceAddSay(w, '<span class="pulse">An API service — opening its form in Field → Connectors…</span>');
    nav('connectors');
    return setTimeout(serviceAddResume, 300);
  }
  const label = r.kind === 'provider' ? 'Chat-model provider' : r.unknown ? 'Not known yet' : 'API service';
  const other = r.kind === 'provider' ? 'It\'s an API service instead' : 'It\'s a chat model instead';
  const ask = r.kind === 'service' && (r.unknown || (r.found && !r.found.definition))
    ? ` <button class="btn btn-xs" onclick="serviceAskDraft(${jsArg(r.docs || q)})" title="Opens the chat with the request; you send it">✨ Let the agent prepare it from its docs</button>` : '';
  serviceAddSay(w, `<span class="pt ${r.unknown ? 'pt-ask' : 'pt-up'}"></span> <b>${label}</b> — ${escHtml(r.why || '')}${ask}
    ${r.only ? '' : `<button class="btn btn-xs" onclick="serviceAddSwitch('${w}')">${other}</button>`}`);
  if (r.kind === 'provider') return serviceAddProviderForm(w, r.provider || {});
  serviceAddApplyService(r, q);
}

/** The other form, with what was typed. */
function serviceAddSwitch(w) {
  const { r, q } = _svcAddLast[w] || {};
  if (!r) return;
  const addr = r.provider?.baseUrl || r.found?.definition?.server || r.draft?.origin || (/[/.:]/.test(q) ? (/^https?:/i.test(q) ? q : `https://${q}`) : '');
  if (r.kind === 'provider') return serviceAddShow(w, { kind: 'service', unknown: !addr, why: 'As you said: an API service — fill it in, or let the agent prepare it from its docs.', docs: addr || q, switched: true, origin: addr }, q);
  serviceAddShow(w, { kind: 'provider', why: 'As you said: a chat model — Test asks it which models it lists.', provider: { name: '', baseUrl: addr } }, q);
}

/** Back on Field → Connectors: a result carried over from the box on API keys. */
function serviceAddResume() {
  if (!_svcAddPending || !document.getElementById('sk-name')) return;
  const { r, q } = _svcAddPending;
  _svcAddPending = null;
  serviceAddSay('providers', `An API service: its form is open in <a href="#" onclick="nav('connectors');return false">Field → Connectors → API services</a>.`);
  const input = document.getElementById('sa-q-services');
  if (input) input.value = q;
  serviceAddShow('services', r, q);
  document.getElementById('svc-add-services')?.scrollIntoView({ block: 'start' });
}

/** An API service into the form below the box. */
async function serviceAddApplyService(r, q) {
  if (r.draft) return serviceDraftGo(r.draft.id, { quiet: true });
  if (r.template) return serviceUseTemplate(r.template);
  if (r.found?.definition) return serviceFill(r.found.definition, r.found.openapi);
  const addr = r.origin || (/[/.:]/.test(q) ? (/^https?:/i.test(q) ? q : `https://${q}`) : '');
  let host = '';
  try { host = new URL(addr).hostname; } catch { /* a plain name */ }
  const parts = host.split('.').filter(p => !['api', 'www', 'docs', 'developers', 'developer', 'platform'].includes(p));
  serviceFill({ name: (parts.length > 1 ? parts[parts.length - 2] : parts[0] || q).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40),
    server: host && !/^(docs|developers?|platform)\./.test(host) ? new URL(addr).origin : '', docs: addr, source: 'hand' }, null);
}

/* ── The chat-model provider form (Field → API keys' own routes: test-provider, add-provider) ── */
function serviceAddProviderForm(w, p) {
  const form = document.getElementById(`sa-form-${w}`);
  form.innerHTML = `<div class="svc-prov"><div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="sa-pn-${w}" placeholder="name (groq)" value="${escHtml(p.name || '')}" style="width:130px">
      <input class="input" id="sa-pu-${w}" placeholder="address (http://127.0.0.1:8080/v1)" value="${escHtml(p.baseUrl || '')}" style="flex:1;min-width:200px">
      <input class="input" id="sa-pk-${w}" type="password" autocomplete="new-password" placeholder="API key — empty for a server of your own" style="flex:1;min-width:170px">
      <button class="btn btn-sm" onclick="serviceAddProviderTest('${w}')">Test</button>
      <button class="btn btn-sm btn-primary" onclick="serviceAddProviderSave('${w}')">Add provider</button></div>
    <div class="desc" id="sa-pstat-${w}">${p.models?.length ? `It lists ${p.models.length} model${p.models.length === 1 ? '' : 's'}: ${escHtml(p.models.slice(0, 6).join(', '))}${p.models.length > 6 ? '…' : ''}` : ''}</div></div>`;
  document.getElementById(p.name ? `sa-pk-${w}` : `sa-pn-${w}`).focus();
}

async function serviceAddProviderTest(w) {
  const url = document.getElementById(`sa-pu-${w}`), stat = document.getElementById(`sa-pstat-${w}`);
  if (!url.value.trim()) { askFor(url, 'Its address, like http://192.168.1.20:8080/v1'); return null; }
  stat.innerHTML = '<span class="pulse">Asking it which models it lists…</span>';
  let r;
  try { r = await apiFetch('/api/keys/test-provider', { method: 'POST', body: { baseUrl: url.value.trim(), apiKey: document.getElementById(`sa-pk-${w}`).value.trim() } }); }
  catch (e) { stat.textContent = e.message; return null; }
  const moved = r.baseUrl && r.baseUrl !== url.value.trim().replace(/\/+$/, '');
  if (r.ok && moved) url.value = r.baseUrl;
  stat.innerHTML = r.ok
    ? `✓ It lists ${r.models.length} model${r.models.length === 1 ? '' : 's'}: ${escHtml(r.models.slice(0, 6).join(', '))}${r.models.length > 6 ? '…' : ''}${moved ? ` — at ${escHtml(r.baseUrl)} (with /v1)` : ''}${r.existing ? ` · already kept as <b>${escHtml(r.existing)}</b>: Add saves on it` : ''}`
    : `✗ ${escHtml(r.error || 'no answer')}.`;
  return r;
}

async function serviceAddProviderSave(w) {
  const v = id => document.getElementById(`${id}-${w}`).value.trim();
  const stat = document.getElementById(`sa-pstat-${w}`);
  if (!v('sa-pn') && !v('sa-pu')) return askFor(document.getElementById(`sa-pn-${w}`), 'A name for it, e.g. groq.');
  const t = await serviceAddProviderTest(w);
  if (!t) return;
  if (!t.ok && /key/.test(t.error || '') && !v('sa-pk')) return askFor(document.getElementById(`sa-pk-${w}`), 'It asks for a key: paste it here.');
  const go = async () => {
    const name = t.existing || v('sa-pn') || 'provider';
    try {
      if (t.existing) await apiFetch('/api/keys', { method: 'POST', body: { provider: name, baseUrl: t.baseUrl, ...(v('sa-pk') ? { apiKey: v('sa-pk') } : {}) } });
      else await apiFetch('/api/keys/add-provider', { method: 'POST', body: { name, baseUrl: t.baseUrl || v('sa-pu'), apiKey: v('sa-pk'), models: (t.models || []).map(id => ({ id, name: id })) } });
    } catch (e) { stat.textContent = e.message; return; }
    stat.innerHTML = `✓ ${escHtml(name)} ${t.existing ? 'updated' : 'added'} — DOCA uses it now (Field → API keys → External providers).`;
    if (typeof keysLoadProviders === 'function') keysLoadProviders();
  };
  if (t.ok) return go();
  appConfirm(`It did not answer (${t.error}). Add it anyway?`, go);
}

/* ── What the agent prepared: found from anywhere ── */
/** A badge on Field → Connectors and External providers while a draft waits, and a line on the providers card. */
function serviceDraftBadge(list) {
  const n = (list || []).length, root = document.documentElement;
  root.style.setProperty('--svc-drafts', `"${n}"`);
  if (n) root.dataset.svcDrafts = String(n); else delete root.dataset.svcDrafts;
  const line = document.getElementById('providers-drafts');
  if (line) line.innerHTML = list.map(x => `<div class="svc-draft-line"><span class="pt pt-ask pt-run"></span> The agent prepared <b>${escHtml(x.name)}</b> (${escHtml(x.origin)}) — an API service, ready to finish.
    <button class="btn btn-xs btn-primary" onclick="serviceDraftGo(${jsArg(x.id)})">Finish it: paste the key</button></div>`).join('');
}

/** Field → Connectors with the draft open in the form (the notice's link, a suggestion, the badge's line). */
async function serviceDraftGo(id) {
  nav('connectors');
  for (let i = 0; i < 40; i++) {
    if (document.getElementById('sk-name') && _svcDrafts.some(d => d.id === id)) return serviceDraftOpen(id);
    if (i === 20 && document.getElementById('service-drafts-slot')) await serviceDraftsRender();
    await new Promise(r => setTimeout(r, 150));
  }
  appAlert('That draft is no longer waiting — it was saved or dismissed.');
}

async function serviceDraftsPoll() {
  if (typeof licenceReady === 'function') await licenceReady();
  if ((typeof _settingsNoHost !== 'undefined' && _settingsNoHost) || !_svcOn()) return;
  try { serviceDraftBadge((await apiFetch('/api/connectors/drafts/all')).drafts || []); } catch { /* not an admin */ }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('chat-fab')) return;
  setTimeout(serviceDraftsPoll, 3000);
  if (typeof liveOn === 'function') liveOn('notice', c => { if (c.what === 'new' && c.notice?.from === 'agent') { _svcAddData = null; serviceDraftsPoll(); } });
  window.addEventListener('doca-go', e => { if (e.detail?.params?.draft) serviceDraftGo(e.detail.params.draft); });
});

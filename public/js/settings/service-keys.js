/* Field → Connectors → API services (modules/api-services/, modules/service-keys.js). The form is the Keys for services
   form as it was — name, address, the key, what it is for — and one Advanced fold under it with how the key is sent, who
   may use it, the service's actions (OpenAPI, JSON or YAML) and the skill that goes with it. Above it one box, "Service
   name, address or docs link": a name offers the shipped templates, an address makes the hub look for the service's
   OpenAPI document and fill the form from it; nothing found offers to ask the agent to prepare it. Only the key is left
   for the person. The rows, Try and the agent's drafts are in service-rows.js. */
let _svcForm = { draft: null, source: null, title: '', keyHint: '', docs: '', hasKey: false };

async function serviceKeysRender() {
  const el = document.getElementById('service-keys-card');
  if (!el) return;
  let d, skills = [];
  try { d = await apiFetch('/api/connectors/services/all'); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  try { skills = (await apiFetch('/api/harness/skills')).skills || []; } catch { /* the skill box lists none */ }
  el.innerHTML = `<div class="card-title">API services</div>
    <p class="desc" style="margin-bottom:8px">A service with an API key — a 3D generator, a home server, anything with a REST API. Paste its key once: the hub adds it only to
      requests for that address and the agent never sees it. With its actions set up, the agent uses it by name (<code>service</code>) and the hub follows long jobs and keeps their files.</p>
    <div id="svc-rows">${serviceRowsHtml(d.services, d.jobs)}</div>
    <div class="card-title" style="margin-top:14px">Add a service</div>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="sk-find" placeholder="Service name, address or docs link (hi3d, https://docs.example.com)" style="flex:1;min-width:220px"
        oninput="serviceFindTyped()" onkeydown="if(event.key==='Enter'){event.preventDefault();serviceFind()}">
      <button class="btn btn-sm" onclick="serviceFind()">Find</button></div>
    <div id="sk-found" class="desc" style="margin:6px 0">${serviceTemplateChips(d.templates)}</div>
    <div class="toolbar" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <input class="input" id="sk-name" placeholder="name (hyper3d)" style="width:130px">
      <input class="input" id="sk-origin" placeholder="address (https://api.example.com)" style="flex:1;min-width:190px">
      <input class="input" id="sk-key" type="password" autocomplete="new-password" placeholder="the key" style="flex:1;min-width:150px">
      <input class="input" id="sk-note" placeholder="what it is for (the agent reads this)" style="flex:1;min-width:180px">
      <button class="btn btn-sm" onclick="serviceKeysAdd()">Add</button></div>
    ${advancedFold(`<div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <select class="input" id="sk-place" data-default="bearer" data-label="How the key is sent" style="width:auto" onchange="serviceKeysPlace()"><option value="bearer">Authorization: Bearer</option><option value="header">another header</option><option value="query">in the address (?param=)</option><option value="basic">user:password (Basic)</option><option value="exchange">id:secret, traded for a token</option></select>
      <input class="input" id="sk-field" data-default="" data-label="Header or parameter" placeholder="header or parameter name — or the token address" style="width:230px">
      <input class="input" id="sk-prefix" data-default="" data-label="Before the key" placeholder="before the key (Token )" style="width:130px">
      <select class="input" id="sk-token" data-default="form" data-label="How the token is asked for" style="width:auto"><option value="form">token: OAuth 2.0 form</option><option value="json">token: empty JSON body</option></select>
      <select class="input" id="sk-who" data-default="host" data-label="Who may use it" style="width:auto"><option value="host">admins' turns</option><option value="everyone">everyone</option></select></div>
      <label class="desc" for="sk-actions" style="display:block;margin-top:8px">Actions — its OpenAPI document (JSON or YAML; a whole one, or only its <code>paths</code>). A long job carries <code>x-doca-job</code>.</label>
      <textarea class="input" id="sk-actions" data-default="" data-label="Actions (OpenAPI)" rows="6" spellcheck="false" style="width:100%;font-family:var(--font-mono);font-size:11px" placeholder="paths:\n  /items:\n    get:\n      operationId: listItems"></textarea>
      <div class="toolbar" style="gap:6px;flex-wrap:wrap;margin-top:4px"><button class="btn btn-xs" onclick="serviceReadActions()">Read the actions</button><span id="sk-actions-said" class="desc"></span></div>
      <div class="toolbar" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        <select class="input" id="sk-skill" data-default="" data-label="Its skill" style="width:auto;max-width:100%"><option value="">no skill linked</option>${skills.map(s => `<option value="${escHtml(s.name)}">skill: ${escHtml(s.name)}</option>`).join('')}</select>
        <button class="btn btn-xs" onclick="serviceAskSkill()">✨ Ask the agent to write one</button></div>`,
      { id: 'service-keys', label: 'Advanced — how the key is sent, who may use it, actions and skill' })}
    <div id="sk-saving" class="desc"></div>`;
  serviceKeysPlace();
  serviceDraftsRender();
}

/** The fields that only mean something for one way of sending the key. */
function serviceKeysPlace() {
  const how = document.getElementById('sk-place')?.value;
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('sk-field', ['header', 'query', 'exchange'].includes(how));
  show('sk-prefix', how === 'header');
  show('sk-token', how === 'exchange');
  const key = document.getElementById('sk-key');
  if (key) key.placeholder = _svcForm.keyHint || (how === 'exchange' ? 'the key: id:secret' : how === 'basic' ? 'the key: user:password' : 'the key');
}

function serviceTemplateChips(list) {
  return list?.length ? `Ready-made: ${list.map(t => `<button class="btn btn-xs" title="${escHtml(t.note)}" onclick="serviceUseTemplate(${jsArg(t.id)})">${escHtml(t.title)}</button>`).join(' ')}` : '';
}

let _svcFindTimer = null;
function serviceFindTyped() {
  clearTimeout(_svcFindTimer);
  const q = document.getElementById('sk-find').value.trim();
  if (/^https?:|\.[a-z]{2,}/i.test(q)) return;   // an address is looked up on Find or Enter: the hub reads the web for it
  _svcFindTimer = setTimeout(async () => {
    try { const r = await apiFetch('/api/connectors/services/find', { method: 'POST', body: { q } }); document.getElementById('sk-found').innerHTML = serviceTemplateChips(r.templates) || (q ? 'No ready-made service by that name — give its address or docs link.' : ''); } catch { /* the box stays */ }
  }, 250);
}

async function serviceFind() {
  const q = document.getElementById('sk-find').value.trim();
  const said = document.getElementById('sk-found');
  if (!q) return askFor(document.getElementById('sk-find'), 'A name (hi3d) or the service\'s address or docs link.');
  said.textContent = /^https?:|\.[a-z]{2,}/i.test(q) ? 'Looking for its OpenAPI document…' : '';
  let r;
  try { r = await apiFetch('/api/connectors/services/find', { method: 'POST', body: { q } }); } catch (e) { said.textContent = e.message; return; }
  if (r.definition) { serviceFill(r.definition, r.openapi); said.innerHTML = `Found its document at <code>${escHtml(r.found)}</code>: ${r.definition.actions?.length || 0} actions.${(r.warnings || []).map(w => ` ${escHtml(w)}.`).join('')} Paste the key and Add.`; return; }
  if (r.templates?.length === 1 && !r.tried?.length) return serviceUseTemplate(r.templates[0].id);
  said.innerHTML = `${serviceTemplateChips(r.templates)}${r.tried?.length ? ` No OpenAPI document found (tried ${r.tried.length} places).
    <button class="btn btn-xs" onclick="serviceAskDraft(${jsArg(r.docs || q)})">✨ Ask the agent to prepare it</button>` : ''}`;
}

async function serviceUseTemplate(id) {
  let r;
  try { r = await apiFetch('/api/connectors/services/read', { method: 'POST', body: { template: id } }); } catch (e) { return appAlert(e.message); }
  serviceFill(r.definition, r.openapi);
  document.getElementById('sk-found').innerHTML = `Filled from the ready-made <b>${escHtml(r.definition.title || id)}</b>${r.definition.keyHint ? ` — the key: ${escHtml(r.definition.keyHint)}` : ''}.`;
}

/** Put a definition in the form: the plain fields, then the fold (marked changed by advancedFold where it differs). */
function serviceFill(def, openapi, { draft = null, hasKey = false } = {}) {
  const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
  _svcForm = { draft, source: def.source || null, title: def.title || '', keyHint: def.keyHint || '', docs: def.docs || '', hasKey };
  set('sk-name', def.name || ''); set('sk-origin', def.server || def.origin || ''); set('sk-note', def.note || '');
  const a = def.auth || { type: 'bearer' };
  set('sk-place', { apiKey: a.in === 'query' ? 'query' : 'header', basic: 'basic', oauth2: 'exchange' }[a.type] || 'bearer');
  set('sk-field', a.type === 'apiKey' ? a.name : a.type === 'oauth2' ? a.tokenUrl : '');
  set('sk-prefix', a.prefix || ''); set('sk-token', a.tokenBody === 'json' ? 'json' : 'form');
  set('sk-actions', openapi ? JSON.stringify(openapi, null, 2) : '');
  const sk = document.getElementById('sk-skill');
  if (sk && def.skill && ![...sk.options].some(o => o.value === def.skill)) sk.add(new Option(`skill: ${def.skill}`, def.skill));
  set('sk-skill', def.skill || '');
  serviceKeysPlace();
  advancedFoldRefresh(document.getElementById('service-keys-card'));
  document.getElementById('sk-actions-said').textContent = def.actions?.length ? `${def.actions.length} actions: ${def.actions.map(x => x.name).slice(0, 12).join(', ')}${def.actions.length > 12 ? '…' : ''}` : '';
  document.getElementById('sk-key').focus();
}

/** How the key is sent, from the fold's fields. */
function serviceAuthOf() {
  const v = id => document.getElementById(id).value.trim(), how = v('sk-place');
  if (how === 'header') return { type: 'apiKey', in: 'header', name: v('sk-field') || 'Authorization', ...(v('sk-prefix') ? { prefix: document.getElementById('sk-prefix').value } : {}) };
  if (how === 'query') return { type: 'apiKey', in: 'query', name: v('sk-field') || 'api_key' };
  if (how === 'basic') return { type: 'basic' };
  if (how === 'exchange') return { type: 'oauth2', tokenUrl: v('sk-field'), tokenBody: v('sk-token') };
  return { type: 'bearer' };
}

async function serviceKeysAdd() {
  const v = id => document.getElementById(id).value.trim();
  const need = [['sk-name', 'Give the service a name the agent will use, e.g. hyper3d.'], ['sk-origin', 'Give the service\'s address, e.g. https://api.example.com — the key is sent only there.']]
    .find(([id]) => !v(id));
  if (need) return askFor(document.getElementById(need[0]), need[1]);
  if (!document.getElementById('sk-key').value && !_svcForm.hasKey) return askFor(document.getElementById('sk-key'), _svcForm.keyHint || 'Paste the key itself.');
  const body = { name: v('sk-name'), server: v('sk-origin'), key: document.getElementById('sk-key').value, who: v('sk-who'), note: v('sk-note'),
    auth: serviceAuthOf(), openapi: document.getElementById('sk-actions').value, skill: v('sk-skill'),
    title: _svcForm.title || undefined, keyHint: _svcForm.keyHint || undefined, docs: _svcForm.docs || undefined, source: _svcForm.source || undefined, draft: _svcForm.draft || undefined };
  try { await apiFetch('/api/connectors/services/all', { method: 'POST', body }); } catch (e) { return appAlert(e.message); }
  _svcForm = { draft: null, source: null, title: '', keyHint: '', docs: '', hasKey: false };
  serviceKeysRender();
}

async function serviceReadActions() {
  const said = document.getElementById('sk-actions-said');
  try {
    const r = await apiFetch('/api/connectors/services/read', { method: 'POST', body: { text: document.getElementById('sk-actions').value } });
    const acts = r.definition.actions || [];
    if (!document.getElementById('sk-origin').value.trim() && r.definition.server) document.getElementById('sk-origin').value = r.definition.server;
    said.textContent = `${acts.length} actions: ${acts.map(x => `${x.name}${x.job ? ' (job)' : ''}`).slice(0, 12).join(', ')}${(r.warnings || []).map(w => `. ${w}`).join('')}`;
  } catch (e) { said.textContent = e.message; }
}

/** Open the chat with a request the person sends themselves (never sent for them). */
function serviceAskAgent(text) {
  if (typeof chatOpen !== 'undefined' && !chatOpen) toggleChat();
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = text;
  input.focus();
}
function serviceAskDraft(link) { serviceAskAgent(`Prepare the API service at ${link} with service_draft: read its documentation, its actions (OpenAPI) and a skill — I will paste the key.`); }
function serviceAskSkill() {
  const name = document.getElementById('sk-name').value.trim() || 'this service';
  serviceAskAgent(`Write a skill for the API service "${name}": when to use it, which actions, and how to show what they make. Prepare it with service_draft so I can check and save it.`);
}

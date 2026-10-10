/* Field → Connectors → API services (modules/api-services/, modules/service-keys.js). From the top: what the agent
   prepared (service-rows.js — first, so it is found), the services kept, then one "Add a service" box (service-add.js,
   the same box as Field → API keys → Add: a chat model goes to the provider form, anything else here) and the form —
   name, address, the key (one box, or two for an id and a secret), what it is for — with one Advanced fold under it:
   how it signs in (service-auth.js), extra headers, a rate limit, its docs, its actions (OpenAPI, JSON or YAML) and
   its skill (service-skill-pick.js). Only the key is left for the person. What the form holds lives in _svcForm
   (service-form.js), so a redraw never loses what was typed; Add (new) or Save (a saved one, once changed) is below. */

async function serviceKeysRender() {
  const el = document.getElementById('service-keys-card');
  if (!el) return;
  let d, skills = [];
  try { d = await apiFetch('/api/connectors/services/all'); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  try { skills = (await apiFetch('/api/harness/skills')).skills || []; } catch { /* the skill box lists none */ }
  el.innerHTML = `<div class="card-title">API services</div>
    <p class="desc" style="margin-bottom:8px">A service with an API key — a 3D generator, a home server, anything with a REST API. Paste its key once: the hub adds it only to
      requests for that address and the agent never sees it. With its actions set up, the agent uses it by name (<code>service</code>) and the hub follows long jobs and keeps their files.</p>
    <div id="service-drafts-slot"></div>
    <div id="svc-rows">${serviceRowsHtml(d.services, d.jobs)}</div>
    ${serviceAddBoxHtml('services')}
    <div class="svc-form-head" id="sk-head"></div>
    <div class="toolbar svc-form-row" style="gap:6px;margin-top:4px;flex-wrap:wrap">
      <input class="input" id="sk-name" placeholder="name (hyper3d)" style="width:130px">
      <input class="input" id="sk-origin" placeholder="address (https://api.example.com)" style="flex:1;min-width:190px">
      ${serviceKeyBoxesHtml()}
      <input class="input" id="sk-note" placeholder="what it is for (the agent reads this)" style="flex:1;min-width:180px"></div>
    ${advancedFold(`${serviceAuthFieldsHtml()}
      <label class="desc" for="sk-actions" style="display:block;margin-top:8px">Actions — its OpenAPI document (JSON or YAML; a whole one, or only its <code>paths</code>). A long job carries <code>x-doca-job</code>.</label>
      <textarea class="input" id="sk-actions" data-default="" data-label="Actions (OpenAPI)" rows="6" spellcheck="false" style="width:100%;font-family:var(--font-mono);font-size:11px" placeholder="paths:\n  /items:\n    get:\n      operationId: listItems"></textarea>
      <div class="toolbar" style="gap:6px;flex-wrap:wrap;margin-top:4px"><button class="btn btn-xs" onclick="serviceReadActions()">Read the actions</button><span id="sk-actions-said" class="desc"></span></div>
      ${serviceSkillHtml(skills)}`,
      { id: 'service-keys', label: 'Advanced — how it signs in, headers, limits, actions and skill' })}
    <div class="svc-foot" id="sk-foot"></div>`;
  serviceFormPaint();
  serviceAddSuggest('services');
  await serviceDraftsRender();
  serviceAddResume();
}

async function serviceUseTemplate(id) {
  let r;
  try { r = await apiFetch('/api/connectors/services/read', { method: 'POST', body: { template: id } }); } catch (e) { return appAlert(e.message); }
  serviceFill(r.definition, r.openapi, { what: `the ready-made ${r.definition.title || id}` });
  serviceAddSay('services', `Filled from the ready-made <b>${escHtml(r.definition.title || id)}</b>${r.definition.keyHint ? ` — the key: ${escHtml(r.definition.keyHint)}` : ''}.`);
}

/** A definition into the form (through serviceFormLoad: what the person typed is asked about first). `editing`: a saved
 *  service, whose values are what Save compares with; `replace`: the form becomes it (Edit, a draft). */
function serviceFill(def, openapi, { draft = null, hasKey = false, editing = null, replace = !!(editing || draft), what = '' } = {}) {
  const a = serviceAuthValues(def.auth || { type: 'bearer' });
  const acts = def.actions || [];
  const values = { 'sk-name': def.name || '', 'sk-origin': def.server || def.origin || '', 'sk-note': def.note || '', ...a, 'sk-who': def.who || 'host',
    'sk-headers': serviceHeadersText(def.headers), 'sk-rate': def.rate?.perMinute ? String(def.rate.perMinute) : '', 'sk-docs': def.docs || '',
    'sk-actions': openapi ? JSON.stringify(openapi, null, 2) : '', 'sk-skill': def.skill || '' };
  const meta = { editing, draft, hasKey, source: def.source || null, title: def.title || '', keyHint: def.keyHint || '', docs: def.docs || '', actions: acts,
    actionsSaid: acts.length ? `${acts.length} actions: ${acts.map(x => x.name).slice(0, 12).join(', ')}${acts.length > 12 ? '…' : ''}` : '' };
  serviceFormLoad(values, meta, { replace, what: what || (def.name ? `“${def.name}”` : 'it') });
  const first = ['sk-id', 'sk-key', 'sk-name'].map(id => document.getElementById(id)).find(x => x && !x.hidden && !x.value);
  first?.focus();
}

async function serviceKeysAdd() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const how = v('sk-place');
  if (how === 'connector') return serviceKeysPlace();
  const need = [['sk-name', 'Give the service a name the agent will use, e.g. hyper3d.'], ['sk-origin', 'Give the service\'s address, e.g. https://api.example.com — the key is sent only there.']]
    .find(([id]) => !v(id));
  if (need) return askFor(document.getElementById(need[0]), need[1]);
  if (['exchange', 'client'].includes(how) && !v('sk-tokenurl')) return serviceAskIn('sk-tokenurl', 'Give the token address: where the id and secret are traded for a token.');
  const key = serviceKeyTyped();
  if (key instanceof Error) return askFor(document.getElementById(key.field), key.message);
  if (!key && !_svcForm.hasKey && how !== 'none') {
    const box = document.getElementById(SVC_TWO[how] ? 'sk-id' : 'sk-key');
    return askFor(box, _svcForm.keyHint || (SVC_TWO[how] ? `Paste the ${SVC_TWO[how][0].toLowerCase()} and the ${SVC_TWO[how][1].toLowerCase()}.` : 'Paste the key itself.'));
  }
  const body = { name: v('sk-name'), server: v('sk-origin'), key: key || '', who: v('sk-who'), note: v('sk-note'),
    auth: serviceAuthOf(), openapi: document.getElementById('sk-actions').value, skill: v('sk-skill'),
    headers: serviceHeadersOf(document.getElementById('sk-headers').value) || {}, rate: Number(v('sk-rate')) > 0 ? { perMinute: Number(v('sk-rate')) } : null, docs: v('sk-docs') || undefined,
    title: _svcForm.title || undefined, keyHint: _svcForm.keyHint || undefined, source: _svcForm.source || undefined, draft: _svcForm.draft || undefined };
  try { await apiFetch('/api/connectors/services/all', { method: 'POST', body }); } catch (e) { return appAlert(e.message); }
  // The form stays on the service just saved, now as saved: Save goes until something changes again.
  const values = { ..._svcForm.values, 'sk-name': body.name.toLowerCase() };
  _svcForm = { ..._svcForm, editing: values['sk-name'], draft: null, hasKey: _svcForm.hasKey || !!key || how === 'none', values, saved: { ...values },
    secrets: {}, touched: [], savedAt: Date.now() };
  serviceAddSay('services', '');
  await serviceKeysRefresh();
}

/** The saved services and the drafts again, the form left as it is. */
async function serviceKeysRefresh() {
  const rows = document.getElementById('svc-rows');
  if (!rows) return serviceKeysRender();
  try { const d = await apiFetch('/api/connectors/services/all'); rows.innerHTML = serviceRowsHtml(d.services, d.jobs); } catch { /* the rows as they were */ }
  await serviceDraftsRender();
  serviceFormPaint();
}

/** A field inside the fold: open it, then ask. */
function serviceAskIn(id, msg) {
  const el = document.getElementById(id);
  const fold = el?.closest('details');
  if (fold) fold.open = true;
  askFor(el, msg);
}

async function serviceReadActions() {
  const said = document.getElementById('sk-actions-said');
  try {
    const r = await apiFetch('/api/connectors/services/read', { method: 'POST', body: { text: document.getElementById('sk-actions').value } });
    const acts = r.definition.actions || [];
    const origin = document.getElementById('sk-origin');
    if (!origin.value.trim() && r.definition.server) { origin.value = r.definition.server; origin.dispatchEvent(new Event('input', { bubbles: true })); }
    _svcForm.actions = acts;
    _svcForm.actionsSaid = `${acts.length} actions: ${acts.map(x => `${x.name}${x.job ? ' (job)' : ''}`).slice(0, 12).join(', ')}${(r.warnings || []).map(w => `. ${w}`).join('')}`;
  } catch (e) { _svcForm.actionsSaid = e.message; }
  said.textContent = _svcForm.actionsSaid;
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

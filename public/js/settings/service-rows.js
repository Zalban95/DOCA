/* Field → Connectors → API services, the saved ones (service-keys.js draws the card and the form): a row per service with
   its address, how its key goes and who may use it, its actions (a long job marked), and Edit, Try (a read action),
   the OpenAPI document (download) and Remove; under them the services the agent prepared, opened in the same form. */
function serviceRowsHtml(services, jobs = []) {
  if (!services?.length) return '<div class="placeholder">None yet.</div>';
  return services.map(s => {
    const a = s.auth || {};
    const how = { bearer: 'Authorization: Bearer …', basic: 'user:password', oauth2: 'id:secret, traded for a token', none: 'no key' }[a.type]
      || (a.in === 'query' ? `?${a.name}=…` : `${a.name}: ${a.prefix || ''}…`);
    const reads = s.actions.filter(x => x.method === 'GET' && !x.job);
    const recent = jobs.filter(j => j.service === s.name).slice(0, 3);
    return `<div class="svc-row">
      <div class="disk-row row3"><span class="disk-label">${escHtml(s.name)}</span>
        <span class="disk-path">${escHtml(s.server)} · ${escHtml(how)} · ${s.who === 'everyone' ? 'everyone' : 'admins'}${s.needsKey ? ' · <b>key not pasted</b>' : ''}${s.note ? ` · ${escHtml(s.note)}` : ''}${s.skill ? ` · skill ${escHtml(s.skill)}` : ''}</span>
        ${rowActs([{ icon: 'edit', label: 'Edit', onclick: `serviceEdit(${jsArg(s.name)})` },
          { icon: 'download', label: 'Its OpenAPI document', onclick: `window.open('/api/connectors/services/${encodeURIComponent(s.name)}/openapi')`, disabled: !s.actions.length, why: 'no actions yet' },
          { label: '✨ Write its skill — asks the agent', more: true, onclick: `serviceRowSkill(${jsArg(s.name)})` },
          { icon: 'remove', label: 'Remove', more: true, onclick: `serviceKeysRemove(${jsArg(s.name)})` }])}</div>
      ${s.actions.length ? `<div class="svc-actions desc">${s.actions.map(x => `<span class="svc-act" title="${escHtml(`${x.method} ${x.path}${x.summary ? ` — ${x.summary}` : ''}`)}">${escHtml(x.name)}${x.job ? ' ⏳' : ''}</span>`).join(' ')}
        ${reads.length ? `<select class="input" id="svc-try-${escHtml(s.name)}" style="width:auto;font-size:11px">${reads.map(x => `<option>${escHtml(x.name)}</option>`).join('')}</select><button class="btn btn-xs" onclick="serviceTry(${jsArg(s.name)})">Try</button>` : ''}</div>
        <pre class="svc-try-out" id="svc-out-${escHtml(s.name)}" hidden></pre>` : '<div class="desc svc-actions">No actions: the agent reaches it with <code>api_call</code>. Edit → Advanced to add them.</div>'}
      ${recent.length ? `<div class="desc svc-actions">${recent.map(j => `${escHtml(j.operation)} ${escHtml(j.state)}${j.files?.length ? ` → ${j.files.map(f => escHtml(f.name)).join(', ')}` : ''}`).join(' · ')}</div>` : ''}</div>`;
  }).join('');
}

async function serviceEdit(name) {
  let r;
  try { r = await apiFetch(`/api/connectors/services/${encodeURIComponent(name)}/form`); } catch (e) { return appAlert(e.message); }
  serviceFill(r.definition, r.definition.actions?.length ? r.openapi : null, { hasKey: r.definition.hasKey, editing: r.definition.name });
  serviceAddSay('services', '');
  document.getElementById('sk-head')?.scrollIntoView({ block: 'start' });
}

/** ⋯ → Write its skill: the service in the form, and the request in the chat (sent by the person). */
async function serviceRowSkill(name) {
  await serviceEdit(name);
  if (_svcForm.editing === name) serviceAskSkill();
}

async function serviceTry(name) {
  const op = document.getElementById(`svc-try-${name}`)?.value;
  const out = document.getElementById(`svc-out-${name}`);
  out.hidden = false; out.textContent = 'Asking…';
  try { const r = await apiFetch(`/api/connectors/services/${encodeURIComponent(name)}/try`, { method: 'POST', body: { operation: op, params: {} } }); out.textContent = `HTTP ${r.status}\n${r.text}`; }
  catch (e) { out.textContent = e.message; }
}

function serviceKeysRemove(name) {
  appConfirm(`Forget the service "${name}" and its key here? (The key stays valid at the service until you revoke it there.)`, async () => {
    try { await apiFetch(`/api/connectors/services/${encodeURIComponent(name)}?key=1`, { method: 'DELETE' }); } catch (e) { return appAlert(e.message); }
    if (_svcForm.editing === name) _svcForm = serviceFormBlank();   // the one in the form is gone; anything else typed stays
    serviceKeysRefresh();
  });
}

/* Services the agent prepared (modules/service-drafts.js): everything but the key — at the top of the card, so they are
   found (asked 2026-10-10: the owner never found the hi3d draft under the form), opened in the form below. */
let _svcDrafts = [];
async function serviceDraftsRender() {
  const host = document.getElementById('service-drafts-slot');
  if (!host) return;
  try { _svcDrafts = (await apiFetch('/api/connectors/drafts/all')).drafts; } catch { return; }
  serviceDraftBadge(_svcDrafts);
  host.innerHTML = '';
  if (!_svcDrafts.length) return;
  const box = Object.assign(document.createElement('div'), { id: 'service-drafts', className: 'service-drafts' });
  box.innerHTML = `<div class="card-title" style="margin-top:4px">Prepared by the agent — ready to finish</div>${_svcDrafts.map(x => `<div class="service-draft" data-draft="${escHtml(x.id)}">
    <div><b>${escHtml(x.name)}</b> · ${escHtml(x.origin)}${x.definition ? ` · ${x.definition.actions.length} actions` : x.spec ? ' · its document is read when opened' : x.template ? ' · the ready-made service\'s actions' : ''}
      ${x.note ? `<br><span style="color:var(--muted)">${escHtml(x.note)}</span>` : ''}${x.docs ? ` · <a href="${escHtml(x.docs)}" target="_blank" rel="noopener">its docs</a>` : ''}
      ${x.skill ? `<details><summary>With the skill “${escHtml(x.skill.name)}”: when and why agents use it</summary><div class="service-draft-skill"></div></details>` : ''}</div>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap"><button class="btn btn-sm btn-primary" onclick="serviceDraftOpen(${jsArg(x.id)})">Finish it: paste the key</button>
      <button class="btn btn-sm" onclick="serviceDraftDismiss(${jsArg(x.id)})">Dismiss</button></div></div>`).join('')}`;
  host.append(box);
  _svcDrafts.forEach((x, i) => { const el = box.querySelectorAll('.service-draft-skill')[_svcDrafts.slice(0, i).filter(y => y.skill).length]; if (x.skill && el) mdInto(el, x.skill.body); });
}

/** A draft in the form: its key's way, its actions (read now from its document's address when it gave one); Add saves it with its skill. */
async function serviceDraftOpen(id) {
  const x = _svcDrafts.find(d => d.id === id);
  if (!x) return;
  let def = x.definition ? { ...x.definition } : { server: x.origin }, openapi = x.openapi || null;
  // No actions of its own: its document's (read now), else the ready-made service's at its address (hi3d's).
  const from = !x.definition && (x.spec ? { url: x.spec } : x.template ? { template: x.template } : null);
  if (from) {
    try { const r = await apiFetch('/api/connectors/services/read', { method: 'POST', body: from }); def = { ...r.definition, server: r.definition.server || x.origin }; openapi = r.openapi; }
    catch (e) { appAlert(`Its document could not be read: ${e.message}`); }
  }
  const auth = { header: x.field && x.field !== 'Authorization' ? { type: 'apiKey', in: 'header', name: x.field, prefix: x.prefix || '' } : { type: 'bearer' },
    query: { type: 'apiKey', in: 'query', name: x.field || 'api_key' }, basic: { type: 'basic' }, exchange: { type: 'oauth2', tokenUrl: x.field, tokenBody: 'json' } }[x.place];
  serviceFill({ ...def, name: x.name, note: x.note || def.note, docs: x.docs || def.docs, auth: def.auth && from ? def.auth : auth, source: 'draft', skill: x.skill?.name || def.skill }, openapi,
    { draft: id, what: `the agent's draft of ${x.name}` });
  serviceAddSay('services', `The agent's draft of <b>${escHtml(x.name)}</b>: check it, paste the key and Add${x.skill ? ' — its skill is saved with it' : ''}.`);
  document.querySelectorAll('.service-draft').forEach(el => el.classList.toggle('open', el.dataset.draft === id));
  document.getElementById('sk-name').scrollIntoView({ block: 'center' });
}

function serviceDraftDismiss(id) {
  confirmRemove('the agent\'s draft of this service', 'No key or skill was saved from it. The agent can prepare it again when asked.', async () => {
    try { await apiFetch(`/api/connectors/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { return appAlert(e.message); }
    if (_svcForm.draft === id) _svcForm = serviceFormBlank();
    serviceKeysRefresh();
  }, { verb: 'Dismiss' });
}

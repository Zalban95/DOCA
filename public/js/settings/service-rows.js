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
  serviceFill(r.definition, r.definition.actions?.length ? r.openapi : null, { hasKey: r.definition.hasKey });
  const who = document.getElementById('sk-who'); if (who) who.value = r.definition.who || 'host';
  advancedFoldRefresh(document.getElementById('service-keys-card'));
  document.getElementById('sk-found').textContent = `Editing ${name}: leave the key empty to keep it.`;
  document.getElementById('sk-name').scrollIntoView({ block: 'center' });
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
    try { await apiFetch(`/api/connectors/services/${encodeURIComponent(name)}?key=1`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    serviceKeysRender();
  });
}

/* Services the agent prepared (modules/service-drafts.js): everything but the key — opened in the form above. */
let _svcDrafts = [];
async function serviceDraftsRender() {
  const host = document.getElementById('service-keys-card');
  if (!host) return;
  try { _svcDrafts = (await apiFetch('/api/connectors/drafts/all')).drafts; } catch { return; }
  document.getElementById('service-drafts')?.remove();
  if (!_svcDrafts.length) return;
  const box = Object.assign(document.createElement('div'), { id: 'service-drafts', className: 'service-drafts' });
  box.innerHTML = `<div class="card-title" style="margin-top:4px">Prepared by the agent</div>${_svcDrafts.map(x => `<div class="service-draft">
    <div><b>${escHtml(x.name)}</b> · ${escHtml(x.origin)}${x.definition ? ` · ${x.definition.actions.length} actions` : x.spec ? ' · its document is read when opened' : ''}
      ${x.note ? `<br><span style="color:var(--muted)">${escHtml(x.note)}</span>` : ''}${x.docs ? ` · <a href="${escHtml(x.docs)}" target="_blank" rel="noopener">its docs</a>` : ''}
      ${x.skill ? `<details><summary>With the skill “${escHtml(x.skill.name)}”: when and why agents use it</summary><div class="service-draft-skill"></div></details>` : ''}</div>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap"><button class="btn btn-sm btn-teal" onclick="serviceDraftOpen(${jsArg(x.id)})">Open in the form</button>
      <button class="btn btn-sm" onclick="serviceDraftDismiss(${jsArg(x.id)})">Dismiss</button></div></div>`).join('')}`;
  host.append(box);
  _svcDrafts.forEach((x, i) => { const el = box.querySelectorAll('.service-draft-skill')[_svcDrafts.slice(0, i).filter(y => y.skill).length]; if (x.skill && el) mdInto(el, x.skill.body); });
}

/** A draft in the form: its key's way, its actions (read now from its document's address when it gave one); Add saves it with its skill. */
async function serviceDraftOpen(id) {
  const x = _svcDrafts.find(d => d.id === id);
  if (!x) return;
  let def = x.definition ? { ...x.definition } : { server: x.origin }, openapi = x.openapi || null;
  if (!x.definition && x.spec) {
    try { const r = await apiFetch('/api/connectors/services/read', { method: 'POST', body: { url: x.spec } }); def = { ...r.definition, server: r.definition.server || x.origin }; openapi = r.openapi; }
    catch (e) { appAlert(`Its document could not be read: ${e.message}`); }
  }
  const auth = { header: x.field && x.field !== 'Authorization' ? { type: 'apiKey', in: 'header', name: x.field, prefix: x.prefix || '' } : { type: 'bearer' },
    query: { type: 'apiKey', in: 'query', name: x.field || 'api_key' }, basic: { type: 'basic' }, exchange: { type: 'oauth2', tokenUrl: x.field, tokenBody: 'json' } }[x.place];
  serviceFill({ ...def, name: x.name, note: x.note, docs: x.docs, auth, source: 'draft', skill: x.skill?.name || def.skill }, openapi, { draft: id });
  if (x.skill) { const sk = document.getElementById('sk-skill'); if (sk && ![...sk.options].some(o => o.value === x.skill.name)) sk.add(new Option(`skill: ${x.skill.name} (new, from the draft)`, x.skill.name)); sk.value = x.skill.name; }
  document.getElementById('sk-found').textContent = `The agent's draft of ${x.name}: check it, paste the key and Add — its skill is saved with it.`;
  document.getElementById('sk-name').scrollIntoView({ block: 'center' });
}

async function serviceDraftDismiss(id) {
  try { await apiFetch(`/api/connectors/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
  serviceKeysRender();
}

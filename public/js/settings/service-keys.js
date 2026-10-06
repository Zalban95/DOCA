/* Settings → Connectors → Keys for services (modules/service-keys.js): an API that takes a key is set up by pasting
   it here once, tied to the service's own address. The agent calls the service with http_fetch naming the key, and the
   hub adds it only to that address — the agent never sees it. */
async function serviceKeysRender() {
  const el = document.getElementById('service-keys-card');
  if (!el) return;
  let d;
  try { d = await apiFetch('/api/connectors/keys/all'); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  el.innerHTML = `<div class="card-title">Keys for services</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">A service with an API key — a 3D generator, a home server, anything with a REST API. Paste its key once: the agent
      calls the service by the key's name (<code>http_fetch</code> with <code>key</code>), the hub adds the key only to requests for that address, and the agent never sees it.</p>
    ${d.keys.map(k => `<div class="disk-row"><span class="disk-label">${escHtml(k.name)}</span>
      <span class="disk-path">${escHtml(k.origin)} · ${k.place === 'query' ? `?${escHtml(k.field)}=…` : `${escHtml(k.field)}: ${escHtml(k.prefix)}…`} · ${k.who === 'everyone' ? 'everyone' : 'admins'}${k.note ? ` · ${escHtml(k.note)}` : ''}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="serviceKeysRemove(${jsArg(k.name)})">✕</button></span></div>`).join('') || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <input class="input" id="sk-name" placeholder="name (hyper3d)" style="width:130px">
      <input class="input" id="sk-origin" placeholder="address (https://api.example.com)" style="flex:1;min-width:190px">
      <input class="input" id="sk-key" type="password" autocomplete="new-password" placeholder="the key" style="flex:1;min-width:150px">
      <select class="input" id="sk-place" style="width:auto"><option value="bearer">Authorization: Bearer</option><option value="header">another header</option><option value="query">in the address (?param=)</option></select>
      <input class="input" id="sk-field" placeholder="header or parameter name" style="width:170px">
      <select class="input" id="sk-who" style="width:auto"><option value="host">admins' turns</option><option value="everyone">everyone</option></select>
      <input class="input" id="sk-note" placeholder="what it is for (the agent reads this)" style="flex:1;min-width:180px">
      <button class="btn btn-sm" onclick="serviceKeysAdd()">Add</button></div>`;
}

async function serviceKeysAdd() {
  const v = id => document.getElementById(id).value.trim(), how = v('sk-place');
  const body = { name: v('sk-name'), origin: v('sk-origin'), key: document.getElementById('sk-key').value, who: v('sk-who'), note: v('sk-note'),
    place: how === 'query' ? 'query' : 'header', ...(how === 'bearer' ? {} : { field: v('sk-field') || undefined, prefix: '' }) };
  try { await apiFetch('/api/connectors/keys/all', { method: 'POST', body }); } catch (e) { return appAlert(e.message); }
  serviceKeysRender();
}

function serviceKeysRemove(name) {
  appConfirm(`Forget the key "${name}" here? (It stays valid at the service until you revoke it there.)`, async () => {
    try { await apiFetch(`/api/connectors/keys/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    serviceKeysRender();
  });
}

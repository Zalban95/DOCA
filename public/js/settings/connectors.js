/* ═══════════════════════════════════════════════════════
   Field → Connectors (modules/connectors; TODO H9.3): the owner's
   accounts, service by service, each with its ways to connect simplest
   first — a calendar's secret address, an app password, a key you paste,
   then OAuth with your own app. Connected, a service is a tool the agents
   hold by name (connector_<id>), under levels, grants and approvals like
   any tool. The rows themselves are drawn by connectors-ways.js.
   ═══════════════════════════════════════════════════════ */

let _connData = null;

async function connectorsLoad() {
  const panel = document.getElementById('sp-connectors');
  if (!panel) return;
  // Without host, the accounts, keys and logins are the owner's: a person sees only their own secrets for their devices.
  if (typeof _settingsNoHost !== 'undefined' && _settingsNoHost) {
    panel.innerHTML = '<div class="card" id="sealed-card"></div>';
    if (typeof sealedRender === 'function') sealedRender();
    return;
  }
  try { _connData = await apiFetch('/api/connectors'); } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  _connData.others = _connData.others || [];
  connectorsDraw();
}

/** The page from what the hub said: the services, what a person added, then keys, logins and secrets for devices. */
function connectorsDraw() {
  const panel = document.getElementById('sp-connectors'), d = _connData;
  if (!panel || !d) return;
  const added = [...d.others.map(o => ({ ...o, label: `${o.name} — ${CONN_WAY_LABEL[o.via]}` })),
    ...d.connectors.filter(c => c.kind === 'custom').map(c => ({ via: 'oauth', id: c.id, state: c }))];
  panel.innerHTML = `<div class="card"><div class="card-title">Connectors</div>
    <p class="conn-help">Your accounts, for the agents to read and work with. Each service lists its ways to connect, simplest first: a calendar's secret address,
      an app password, a key you paste — and OAuth with an app you make in the service's console (DOCA ships none, so nobody sits between the hive and your accounts).
      Every way is tested when you save it, and a password, key or address is never shown again. Connected, a service is the tool <code>connector_&lt;id&gt;</code>;
      by default only admins' turns may use it.</p>
    <p class="conn-help">For OAuth, register this as the callback (redirect) address: <code>${escHtml(d.callback)}</code>
      <button class="btn btn-xs" onclick="navigator.clipboard?.writeText(${jsArg(d.callback)})">copy</button></p></div>
    ${d.services.map(svc => `<div class="card conn-service" data-service="${escHtml(svc.id)}"><div class="card-title">${escHtml(svc.label)}</div>
      ${svc.note ? `<p class="conn-help">${escHtml(svc.note)}${svc.link ? ` ${connLink(svc.link, 'Why')}` : ''}</p>` : ''}
      ${svc.ways.map(w => connWayRow(w, svc.label)).join('')}</div>`).join('')}
    <div class="card conn-service"><div class="card-title">Added by you</div>
      ${added.map(w => connWayRow(w, w.name || w.id)).join('') || '<p class="conn-help">Nothing yet.</p>'}
      <div class="toolbar" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <select class="input" id="conn-add-via" style="width:auto"><option value="ics">a calendar by its secret address</option><option value="mail">a mailbox (IMAP and SMTP) with an app password</option>
          <option value="dav">a CalDAV/CardDAV server with an app password</option><option value="oauth">another OAuth 2.0 service</option></select>
        <input class="input" id="conn-add-name" placeholder="a short name (school-calendar)" style="width:200px">
        <button class="btn btn-sm" onclick="connAddOther()">＋ Add</button></div></div>
    <div class="card" id="service-keys-card"></div>
    <div class="card" id="logins-card"></div>
    <div class="card" id="sealed-card"></div>`;
  if (typeof serviceKeysRender === 'function') serviceKeysRender();
  loginsRender();
  if (typeof sealedRender === 'function') sealedRender();
}

/** OAuth with the owner's own app: the app's id and secret, scopes, who may use it, then Connect. */
function connectorsOAuthRow(w) {
  const c = w.state;
  if (!c) return '';
  const id = c.id;
  return `<details class="conn-way" data-way="${escHtml(id)}" data-conn="${escHtml(id)}" ${_connOpen.has(id) ? 'open' : ''} ontoggle="connWayToggle(this)">
    <summary><span class="conn-way-label">${escHtml(c.kind === 'custom' ? `${c.label} — ${CONN_WAY_LABEL.oauth}` : CONN_WAY_LABEL.oauth)}</span>${connWayStatus(w)}</summary>
    <div class="conn-way-body"><p class="conn-help">${escHtml(CONN_WAY_ABOUT.oauth)}<br>Make the app at ${connLink(c.console)}.${c.docs ? ` The service's guide: ${connLink(c.docs, 'its OAuth docs')}.` : ''}</p>
      ${c.kind === 'custom' ? `<div class="toolbar" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <input class="input" data-f="authorize" placeholder="authorize address" value="${escHtml(c.urls?.authorize || '')}" style="flex:1;min-width:200px">
        <input class="input" data-f="token" placeholder="token address" value="${escHtml(c.urls?.token || '')}" style="flex:1;min-width:200px">
        <input class="input" data-f="api" placeholder="API address(es), comma-separated" value="${escHtml((c.urls?.api || []).join(', '))}" style="flex:1;min-width:200px"></div>` : ''}
      <div class="toolbar" style="gap:6px;flex-wrap:wrap">
        <input class="input" data-f="clientId" placeholder="${c.configured ? 'client id saved — type to replace' : 'client id'}" style="flex:1;min-width:160px">
        <input class="input" data-f="clientSecret" type="password" autocomplete="off" placeholder="${c.hasSecret ? 'secret saved — paste to replace' : 'client secret'}" style="flex:1;min-width:160px">
        <input class="input" data-f="scopes" placeholder="scopes" value="${escHtml(c.scopes ?? c.defaultScopes)}" style="flex:2;min-width:220px">
        ${connWho(c)}</div>
      <div class="toolbar" style="gap:6px;margin-top:8px;justify-content:flex-start">
        <button class="btn btn-sm" onclick="connectorsSave(${jsArg(id)})">Save</button>
        <button class="btn btn-sm btn-blue" onclick="connectorsConnect(${jsArg(id)})" ${c.configured ? '' : 'disabled title="Save its client id and secret first"'}>${c.connected ? 'Reconnect' : 'Connect'}</button>
        ${c.connected ? `<button class="btn btn-sm btn-red" onclick="connectorsDisconnect(${jsArg(id)})">Disconnect</button>` : ''}</div></div></details>`;
}

async function connectorsSave(id) {
  const card = document.querySelector(`#sp-connectors [data-conn="${CSS.escape(id)}"]`);
  const f = k => card.querySelector(`[data-f="${k}"]`)?.value.trim();
  const body = { scopes: f('scopes'), who: f('who') };
  if (f('clientId')) body.clientId = f('clientId');
  if (f('clientSecret')) body.clientSecret = f('clientSecret');
  if (card.querySelector('[data-f="authorize"]')) body.urls = { authorize: f('authorize'), token: f('token'), api: f('api').split(',').map(s => s.trim()).filter(Boolean) };
  _connOpen.add(id);
  try { await apiFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'POST', body }); } catch (e) { return appAlert(e.message); }
  connectorsLoad();
}

async function connectorsConnect(id) {
  try {
    const r = await apiFetch(`/api/connectors/${encodeURIComponent(id)}/connect`, { method: 'POST' });
    window.open(r.url, '_blank', 'noopener');
    appAlert('Sign in on the page that opened and allow access; then come back here.', () => connectorsLoad());
  } catch (e) { appAlert(e.message); }
}

function connectorsDisconnect(id) {
  appConfirm('Disconnect? Its tokens are forgotten here (revoke the app in the service too, to be sure). The OAuth app stays for next time.', async () => {
    try { await apiFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    connectorsLoad();
  });
}

/** Another OAuth 2.0 service, by a short name; its addresses are typed into its row. */
async function connectorsAdd(id) {
  try { await apiFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'POST', body: { label: id } }); } catch (e) { return appAlert(e.message); }
  _connOpen.add(id);
  connectorsLoad();
}

/* Logins for the agents' computers (modules/logins.js): the agent signs in with one without seeing its password. */
async function loginsRender() {
  const el = document.getElementById('logins-card');
  if (!el) return;
  let d;
  try { d = await apiFetch('/api/connectors/logins/all'); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  el.innerHTML = `<div class="card-title">Logins for the agents' computers</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">An agent signs in with one on a computer's browser (<code>computer_login</code>, asked every time): the hub checks the page is on
      the login's own site and types the password itself — the agent never sees it, and a look-alike site gets nothing.</p>
    ${d.logins.map(l => `<div class="disk-row"><span class="disk-label">${escHtml(l.label)}</span><span class="disk-path">${escHtml(l.username)} · ${escHtml(l.site)}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="loginsRemove(${jsArg(l.id)})">✕</button></span></div>`).join('') || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <input class="input" id="lg-site" placeholder="site (https://github.com)" style="flex:1;min-width:170px">
      <input class="input" id="lg-user" placeholder="username or email" style="flex:1;min-width:150px">
      <input class="input" id="lg-pass" type="password" autocomplete="new-password" placeholder="password" style="flex:1;min-width:140px">
      <input class="input" id="lg-label" placeholder="name (optional)" style="width:130px">
      <button class="btn btn-sm" onclick="loginsAdd()">Add</button></div>`;
}

async function loginsAdd() {
  const v = id => document.getElementById(id).value.trim();
  try { await apiFetch('/api/connectors/logins/all', { method: 'POST', body: { site: v('lg-site'), username: v('lg-user'), password: document.getElementById('lg-pass').value, label: v('lg-label') } }); }
  catch (e) { return appAlert(e.message); }
  loginsRender();
}

function loginsRemove(id) {
  appConfirm('Forget this login here? (Its password is not changed at the site.)', async () => {
    try { await apiFetch(`/api/connectors/logins/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    loginsRender();
  });
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-connectors' })));

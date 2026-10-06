/* ═══════════════════════════════════════════════════════
   Settings → Connectors (modules/connectors; TODO H9.3): the owner's accounts
   — GitHub, Google, Microsoft, any OAuth 2.0 service — connected with the
   owner's own OAuth app, each then a tool the agents hold by name
   (connector_<id>), under levels, grants and approvals like any tool.
   ═══════════════════════════════════════════════════════ */

async function connectorsLoad() {
  const panel = document.getElementById('sp-connectors');
  if (!panel) return;
  let d;
  try { d = await apiFetch('/api/connectors'); } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  panel.innerHTML = `<div class="card"><div class="card-title">Connectors</div>
    <p style="font-size:11px;color:var(--muted)">Your accounts, reached through their own APIs. Each uses an OAuth app you make in that service's console — DOCA ships none,
      so nobody sits between the hive and your accounts. Register this as the callback / redirect URL: <code>${escHtml(d.callback)}</code>
      <button class="btn btn-xs" onclick="navigator.clipboard?.writeText(${jsArg(d.callback)})">copy</button>.
      Connected, a service is the tool <code>connector_&lt;id&gt;</code>: changes are asked about like any change, and by default only people who hold host may use it.</p></div>
    ${d.connectors.map(c => `<div class="card" data-conn="${escHtml(c.id)}">
      <div class="card-title" style="display:flex;gap:8px;align-items:center">${escHtml(c.label)}
        <span style="font-size:11px;text-transform:none;letter-spacing:0;color:${c.connected ? 'var(--green)' : 'var(--muted)'}">${c.connected ? `● connected${c.account ? ` as ${escHtml(c.account)}` : ''}` : c.configured ? '○ not connected' : '○ no app yet'}</span></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Make the app at ${escHtml(c.console)}.</div>
      ${c.kind === 'custom' ? `<div class="toolbar" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <input class="input" data-f="authorize" placeholder="authorize address" value="${escHtml(c.urls?.authorize || '')}" style="flex:1;min-width:200px">
        <input class="input" data-f="token" placeholder="token address" value="${escHtml(c.urls?.token || '')}" style="flex:1;min-width:200px">
        <input class="input" data-f="api" placeholder="API address(es), comma-separated" value="${escHtml((c.urls?.api || []).join(', '))}" style="flex:1;min-width:200px"></div>` : ''}
      <div class="toolbar" style="gap:6px;flex-wrap:wrap">
        <input class="input" data-f="clientId" placeholder="client id" style="flex:1;min-width:160px">
        <input class="input" data-f="clientSecret" type="password" autocomplete="off" placeholder="${c.hasSecret ? 'secret saved — paste to replace' : 'client secret'}" style="flex:1;min-width:160px">
        <input class="input" data-f="scopes" placeholder="scopes" value="${escHtml(c.scopes ?? c.defaultScopes)}" style="flex:2;min-width:220px">
        <select class="input" data-f="who" style="width:auto"><option value="host" ${c.who !== 'everyone' ? 'selected' : ''}>hosts only</option><option value="everyone" ${c.who === 'everyone' ? 'selected' : ''}>everyone</option></select>
        <button class="btn btn-sm" onclick="connectorsSave(${jsArg(c.id)})">Save</button>
        <button class="btn btn-sm btn-blue" onclick="connectorsConnect(${jsArg(c.id)})" ${c.configured ? '' : 'disabled'}>${c.connected ? 'Reconnect' : 'Connect'}</button>
        ${c.connected ? `<button class="btn btn-sm btn-red" onclick="connectorsDisconnect(${jsArg(c.id)})">Disconnect</button>` : ''}</div></div>`).join('')}
    <div class="card"><button class="btn btn-sm" onclick="connectorsAdd()">＋ Another OAuth 2.0 service</button></div>
    <div class="card" id="service-keys-card"></div>
    <div class="card" id="logins-card"></div>`;
  if (typeof serviceKeysRender === 'function') serviceKeysRender();
  loginsRender();
  for (const c of d.connectors) { const el = panel.querySelector(`[data-conn="${CSS.escape(c.id)}"] [data-f="clientId"]`); if (el && c.configured) el.placeholder = 'client id saved — type to replace'; }
}

async function connectorsSave(id) {
  const card = document.querySelector(`#sp-connectors [data-conn="${CSS.escape(id)}"]`);
  const f = k => card.querySelector(`[data-f="${k}"]`)?.value.trim();
  const body = { scopes: f('scopes'), who: f('who') };
  if (f('clientId')) body.clientId = f('clientId');
  if (f('clientSecret')) body.clientSecret = f('clientSecret');
  if (card.querySelector('[data-f="authorize"]')) body.urls = { authorize: f('authorize'), token: f('token'), api: f('api').split(',').map(s => s.trim()).filter(Boolean) };
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

function connectorsAdd() {
  appPrompt('A short id for it (lower-case, e.g. "linear"):', async id => {
    if (!id) return;
    try { await apiFetch(`/api/connectors/${encodeURIComponent(id.trim().toLowerCase())}`, { method: 'POST', body: { label: id.trim() } }); } catch (e) { return appAlert(e.message); }
    connectorsLoad();
  });
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

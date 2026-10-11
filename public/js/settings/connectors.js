/* ═══════════════════════════════════════════════════════
   Field → Connectors (modules/connectors; TODO H9.3): the owner's accounts
   — GitHub, Google, Microsoft, any OAuth 2.0 service — connected with the
   owner's own OAuth app, each then a tool the agents hold by name
   (connector_<id>), under levels, grants and approvals like any tool.
   ═══════════════════════════════════════════════════════ */

async function connectorsLoad() {
  const panel = document.getElementById('sp-connectors');
  if (!panel) return;
  // Without host, the accounts, keys and logins are the owner's: a person sees only their own secrets for their devices.
  if (typeof _settingsNoHost !== 'undefined' && _settingsNoHost) {
    panel.innerHTML = '<div class="card" id="sealed-card"></div>';
    if (typeof sealedRender === 'function') sealedRender();
    return;
  }
  let d;
  try { d = await apiFetch('/api/connectors'); } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  panel.innerHTML = `<div class="card"><div class="card-title">Connectors</div>
    <p style="font-size:11px;color:var(--muted)">Let the agents use your own accounts (GitHub, Google, Microsoft…). When the service asks for a callback or redirect address, give it this one:
      <code>${escHtml(d.callback)}</code> <button class="btn btn-xs" onclick="navigator.clipboard?.writeText(${jsArg(d.callback)})">copy</button></p>
    <details class="desc page-about" style="margin-top:6px;font-size:11px"><summary>How connecting works</summary>Each account is reached through its own API, with an
      OAuth app you make yourself in that service's console (its developer settings) — none is shipped with this hub, so nobody sits between the hive and your
      accounts. Make the app there, paste its client id and secret here, Save, then Connect and allow access on the page that opens. Connected, a service is the
      tool <code>connector_&lt;id&gt;</code>: changes are asked about like any change, and by default only admins may use it.</details></div>
    ${d.connectors.map(c => `<div class="card" data-conn="${escHtml(c.id)}">
      <div class="card-title" style="display:flex;gap:8px;align-items:center">${escHtml(c.label)}
        <span style="font-size:11px;text-transform:none;letter-spacing:0;color:${c.connected ? 'var(--green)' : 'var(--muted)'}">${c.connected ? `● connected${c.account ? ` as ${escHtml(c.account)}` : ''}` : c.configured ? '○ not connected' : '○ no app yet'}</span></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Make the app at ${escHtml(c.console)}.</div>
      ${c.kind === 'custom' ? `<div class="toolbar" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
<label class="svc-field" style="flex:1;min-width:200px"><span class="field-label">Sign-in page ${infoBtn("The service's authorization address, where you are sent to allow access (its OAuth documentation names it).")}</span><input class="input" data-f="authorize" placeholder="https://…/authorize" value="${escHtml(c.urls?.authorize || '')}"></label>
        <label class="svc-field" style="flex:1;min-width:200px"><span class="field-label">Token address ${infoBtn('The address the hub trades the sign-in for a token at (its OAuth documentation names it).')}</span><input class="input" data-f="token" placeholder="https://…/token" value="${escHtml(c.urls?.token || '')}"></label>
        <label class="svc-field" style="flex:1;min-width:200px"><span class="field-label">API addresses ${infoBtn("Where the service's API answers. The agent's requests with this account go only to these addresses; several are separated by commas.")}</span><input class="input" data-f="api" placeholder="https://api.example.com" value="${escHtml((c.urls?.api || []).join(', '))}"></label></div>` : ''}
      <div class="toolbar" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
        <label class="svc-field" style="flex:1;min-width:160px"><span class="field-label">Client id ${infoBtn("The id of the OAuth app you made in this service's console; it is shown there when the app is made. After saving, the box stays empty and says it is saved.")}</span><input class="input" data-f="clientId" placeholder="client id"></label>
        <label class="svc-field" style="flex:1;min-width:160px"><span class="field-label">Client secret ${infoBtn('The secret of that same OAuth app, shown in the console next to its id. Kept in a protected file on this machine and never shown again; paste a new one to replace it.')}</span><input class="input" data-f="clientSecret" type="password" autocomplete="off" placeholder="${c.hasSecret ? 'secret saved — paste to replace' : 'client secret'}"></label>
        <button class="btn btn-sm" onclick="connectorsSave(${jsArg(c.id)})">Save</button>
        <button class="btn btn-sm btn-blue" onclick="connectorsConnect(${jsArg(c.id)})" ${c.configured ? '' : 'disabled title="Save its client id and secret first"'}>${c.connected ? 'Reconnect' : 'Connect'}</button>
        ${c.connected ? `<button class="btn btn-sm btn-red" onclick="connectorsDisconnect(${jsArg(c.id)})">Disconnect</button>` : ''}
        <span class="status-line" data-f="status"></span></div>
      ${advancedFold(`<div class="toolbar" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
        <label class="svc-field" style="flex:2;min-width:220px"><span class="field-label">Scopes ${infoBtn("What the app asks the service to allow, space-separated in the service's own words. The default is the read-only access this service offers. A change takes effect at the next Connect.")}</span><input class="input" data-f="scopes" placeholder="scopes" data-default="${escHtml(c.defaultScopes ?? '')}" data-label="Scopes" value="${escHtml(c.scopes ?? c.defaultScopes)}"></label>
        <label class="svc-field" style="width:auto"><span class="field-label">Who may use it ${infoBtn("Whose conversations may use this account: only admins' (the default), or everyone who chats on this hub.")}</span><select class="input" data-f="who" data-default="host" data-label="Who may use it"><option value="host" ${c.who !== 'everyone' ? 'selected' : ''}>admins only</option><option value="everyone" ${c.who === 'everyone' ? 'selected' : ''}>everyone</option></select></label></div>`,
        { id: 'connector', label: 'Advanced — scopes, who may use it' })}</div>`).join('')}
    <div class="card"><button class="btn btn-sm" onclick="connectorsAdd()">＋ Another OAuth 2.0 service</button></div>
    <div class="card" id="service-keys-card"></div>
    <div class="card" id="logins-card"></div>
    <div class="card" id="sealed-card"></div>`;
  if (typeof serviceKeysRender === 'function') serviceKeysRender();
  loginsRender();
  if (typeof sealedRender === 'function') sealedRender();
  for (const c of d.connectors) { const el = panel.querySelector(`[data-conn="${CSS.escape(c.id)}"] [data-f="clientId"]`); if (el && c.configured) el.placeholder = 'client id saved — type to replace'; }
}

async function connectorsSave(id) {
  const card = document.querySelector(`#sp-connectors [data-conn="${CSS.escape(id)}"]`);
  const f = k => card.querySelector(`[data-f="${k}"]`)?.value.trim();
  // Nothing typed into an app that has none saved: say what is missing (deep test B, R4: Save did nothing visible).
  const idIn = card.querySelector('[data-f="clientId"]');
  if (!f('clientId') && !f('clientSecret') && !/saved/.test(idIn?.placeholder || ''))
    return askFor(idIn, 'Paste the client id and secret of the OAuth app you made in its console first.');
  const body = { scopes: f('scopes'), who: f('who') };
  if (f('clientId')) body.clientId = f('clientId');
  if (f('clientSecret')) body.clientSecret = f('clientSecret');
  if (card.querySelector('[data-f="authorize"]')) body.urls = { authorize: f('authorize'), token: f('token'), api: f('api').split(',').map(s => s.trim()).filter(Boolean) };
  try { await apiFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'POST', body }); } catch (e) { return appAlert(e.message); }
  await connectorsLoad();
  setStatus(document.querySelector(`#sp-connectors [data-conn="${CSS.escape(id)}"] [data-f="status"]`), '✓ Saved', 'ok');
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
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Usernames and passwords an agent may sign in with on its computer's browser, without ever seeing the password.</p>
    <details class="desc page-about" style="margin:0 0 8px;font-size:11px"><summary>How it stays safe</summary>You are asked every time an agent uses one (<code>computer_login</code>).
      The hub checks the page is on the login's own site and types the password itself — the agent never sees it, and a look-alike site gets nothing.</details>
    ${d.logins.map(l => `<div class="disk-row"><span class="disk-label">${escHtml(l.label)}</span><span class="disk-path">${escHtml(l.username)} · ${escHtml(l.site)}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="loginsRemove(${jsArg(l.id)})">✕</button></span></div>`).join('') || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
      <label class="svc-field" style="flex:1;min-width:170px"><span class="field-label">Site ${infoBtn('The web address the login belongs to (https://github.com). The password is typed only on a page of this exact site.')}</span><input class="input" id="lg-site" placeholder="https://github.com"></label>
      <label class="svc-field" style="flex:1;min-width:150px"><span class="field-label">Username ${infoBtn('The username or email to sign in with on that site.')}</span><input class="input" id="lg-user" placeholder="username or email"></label>
      <label class="svc-field" style="flex:1;min-width:140px"><span class="field-label">Password ${infoBtn('The password for that site. Kept in a protected file on this machine; it is never shown again, not even to the agent.')}</span><input class="input" id="lg-pass" type="password" autocomplete="new-password" placeholder="password"></label>
      <label class="svc-field" style="width:130px"><span class="field-label">Name ${infoBtn("A short name the agent asks for this login by. Optional: empty, the site's name is used.")}</span><input class="input" id="lg-label" placeholder="optional"></label>
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

/* ═══════════════════════════════════════════════════════
   Field → Connectors → Secrets for devices (modules/sealed; TODO P1.3,
   CONSTITUTION S4): a password, a PIN or a key the agent can have typed or
   pasted on one of your devices without seeing it — you are asked every
   time, the device gets it sealed for one use and a short time. Kept in the
   database encrypted; never shown again here. Where each was used is listed.
   An admin keeps the hub's (/sealed/all); anyone who chats keeps their own,
   for their own devices (/sealed/mine) — nobody else sees or uses those.
   Keeping or forgetting one asks for your password (lib/api.js asks).
   ═══════════════════════════════════════════════════════ */

const _sealedBase = () => (typeof _settingsNoHost !== 'undefined' && _settingsNoHost ? '/api/connectors/sealed/mine' : '/api/connectors/sealed/all');
const _sealedMine = () => _sealedBase().endsWith('/mine');

async function sealedRender() {
  const el = document.getElementById('sealed-card');
  if (!el) return;
  let d;
  try { d = await apiFetch(_sealedBase()); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const when = t => { try { return new Date(t).toLocaleString(); } catch { return t; } };
  const mine = _sealedMine();
  const row = (s, del) => `<div class="disk-row"><span class="disk-label">${escHtml(s.name)}</span><span class="disk-path">${s.origin ? appLinkify(s.origin) : 'any place'}${s.note ? ` · ${escHtml(s.note)}` : ''}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="${del}" title="Forget it here">✕</button></span></div>`;
  el.dataset.helpAsk = 'Help me keep a secret for my devices: what to name it, whether it needs a site, and which device can use it (never ask me for the secret itself).';
  el.innerHTML = `<div class="card-title">Secrets for your devices</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">A PIN, a password or a code an agent can have typed on one of your own devices without ever seeing it. You are asked every time.</p>
    <details class="desc page-about" style="margin:0 0 8px;font-size:11px"><summary>How it works</summary>The agent asks for it by name (<code>secret_use</code>);
      the device gets it sealed for itself, for one use (or a few pastes) and a few seconds, then forgets it. Into a web page only on
      its own site. ${mine ? 'These are yours: used only on your own turns, on your own devices — nobody else sees or uses them.'
      : 'These are the hub\'s, used on an admin\'s turn. A login\'s password (<code>login:&lt;name&gt;</code>) and a key for services (<code>key:&lt;name&gt;</code>) can be used the same way.'}
      Keeping or forgetting one asks for your password. Needs the desktop client (doca-client) or the browser extension on the device.</details>
    ${d.secrets.map(s => row(s, `sealedRemove(${jsArg(s.name)})`)).join('') || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:flex-end">
      <label class="svc-field" style="width:140px"><span class="field-label">Name ${infoBtn('What the agent asks for it by (bank-pin). Only the name is ever shown.')}</span><input class="input" id="sl-name" placeholder="bank-pin"></label>
      <label class="svc-field" style="flex:1;min-width:140px"><span class="field-label">Secret ${infoBtn('The secret itself. Kept encrypted on this machine and never shown again, to anyone.')}</span><input class="input" id="sl-value" type="password" autocomplete="new-password" placeholder="the secret"></label>
      <label class="svc-field" style="flex:1;min-width:170px"><span class="field-label">Its site ${infoBtn("For a secret used on a web page: that page's address. It is then filled only into a page of that site, never typed or pasted anywhere else. Optional.")}</span><input class="input" id="sl-site" placeholder="optional"></label>
      <label class="svc-field" style="width:150px"><span class="field-label">Note ${infoBtn('A few words for yourself about what it is. Optional; the agent sees it too.')}</span><input class="input" id="sl-note" placeholder="optional"></label>
      <button class="btn btn-sm" onclick="sealedAdd()">Keep</button></div>
    ${d.people?.length ? `<div style="font-size:11px;color:var(--muted);margin:10px 0 4px">Kept by people for their own devices (names only; only they use them)</div>
      ${d.people.map(s => row({ ...s, name: `${s.name} · ${s.person}` }, `sealedRemove(${jsArg(s.name)}, ${jsArg(s.person)})`)).join('')}` : ''}
    <div style="font-size:11px;color:var(--muted);margin:10px 0 4px">Where they were used</div>
    ${d.uses.map(u => `<div class="disk-row"><span class="disk-label">${escHtml(u.secret)}</span>
      <span class="disk-path">${escHtml(when(u.at))} · ${escHtml(u.device || u.deviceId || '?')} · ${escHtml(u.target || '')}</span>
      <span class="disk-free" style="color:${u.outcome === 'done' ? 'var(--green)' : 'var(--muted)'}">${escHtml(u.outcome === 'done' ? 'used' : u.outcome || '')}</span></div>`).join('')
      || '<div class="placeholder">Not used yet.</div>'}`;
}

async function sealedAdd() {
  const v = id => document.getElementById(id).value.trim();
  const value = document.getElementById('sl-value').value;
  try { await apiFetch(_sealedBase(), { method: 'POST', body: { name: v('sl-name'), value, origin: v('sl-site'), note: v('sl-note') } }); }
  catch (e) { return appAlert(e.message); }
  sealedRender();
}

function sealedRemove(name, person) {
  const url = _sealedMine() ? `/api/connectors/sealed/mine/${encodeURIComponent(name)}`
    : `/api/connectors/sealed/${encodeURIComponent(name)}${person ? `?person=${encodeURIComponent(person)}` : ''}`;
  appConfirm(`Forget "${name}" here? An agent can no longer use it; where it was used stays listed.`, async () => {
    try { await apiFetch(url, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    sealedRender();
  });
}

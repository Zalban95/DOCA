/* ═══════════════════════════════════════════════════════
   Field → Connectors → Secrets for devices (modules/sealed; TODO P1.3,
   CONSTITUTION S4): a password, a PIN or a key the agent can have typed or
   pasted on one of your devices without seeing it — you are asked every
   time, the device gets it sealed for one use and a short time. Kept in the
   database encrypted; never shown again here. Where each was used is listed.
   ═══════════════════════════════════════════════════════ */

async function sealedRender() {
  const el = document.getElementById('sealed-card');
  if (!el) return;
  let d;
  try { d = await apiFetch('/api/connectors/sealed/all'); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const when = t => { try { return new Date(t).toLocaleString(); } catch { return t; } };
  el.innerHTML = `<div class="card-title">Secrets for your devices</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">An agent can have one typed or pasted on one of your own devices (<code>secret_use</code>) without ever seeing it:
      you are asked every time, and the device gets it sealed for itself, for one use (or a few pastes) and a few seconds, then forgets it. Into a web page only on
      its own site. A login's password (<code>login:&lt;name&gt;</code>) and a key for services (<code>key:&lt;name&gt;</code>) can be used the same way.
      Needs doca-client or the DOCA browser extension on the device.</p>
    ${d.secrets.map(s => `<div class="disk-row"><span class="disk-label">${escHtml(s.name)}</span><span class="disk-path">${escHtml(s.origin || 'any place')}${s.note ? ` · ${escHtml(s.note)}` : ''}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="sealedRemove(${jsArg(s.name)})" title="Forget it here">✕</button></span></div>`).join('') || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <input class="input" id="sl-name" placeholder="name (bank-pin)" style="width:140px">
      <input class="input" id="sl-value" type="password" autocomplete="new-password" placeholder="the secret" style="flex:1;min-width:140px">
      <input class="input" id="sl-site" placeholder="its site, for a web page (optional)" style="flex:1;min-width:170px">
      <input class="input" id="sl-note" placeholder="note (optional)" style="width:150px">
      <button class="btn btn-sm" onclick="sealedAdd()">Keep</button></div>
    <div style="font-size:11px;color:var(--muted);margin:10px 0 4px">Where they were used</div>
    ${d.uses.map(u => `<div class="disk-row"><span class="disk-label">${escHtml(u.secret)}</span>
      <span class="disk-path">${escHtml(when(u.at))} · ${escHtml(u.device || u.deviceId || '?')} · ${escHtml(u.target || '')}</span>
      <span class="disk-free" style="color:${u.outcome === 'done' ? 'var(--green)' : 'var(--muted)'}">${escHtml(u.outcome === 'done' ? 'used' : u.outcome || '')}</span></div>`).join('')
      || '<div class="placeholder">Not used yet.</div>'}`;
}

async function sealedAdd() {
  const v = id => document.getElementById(id).value.trim();
  const value = document.getElementById('sl-value').value;
  try { await apiFetch('/api/connectors/sealed/all', { method: 'POST', body: { name: v('sl-name'), value, origin: v('sl-site'), note: v('sl-note') } }); }
  catch (e) { return appAlert(e.message); }
  sealedRender();
}

function sealedRemove(name) {
  appConfirm(`Forget "${name}" here? An agent can no longer use it; where it was used stays listed.`, async () => {
    try { await apiFetch(`/api/connectors/sealed/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    sealedRender();
  });
}

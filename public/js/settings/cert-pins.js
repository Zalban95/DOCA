/* Field → Connectors → Certificates you trust (modules/cert-pins.js): a home server that makes its own certificate —
   Proxmox VE, a NAS — is trusted by name, one exact certificate per address, after looking at its fingerprint; never
   "any self-signed certificate". Only your own addresses. Trusting says why it matters first; forgetting does not. */
async function certPinsRender() {
  const el = document.getElementById('certs-card');
  if (!el) return;
  let d = { certs: [] };
  try { d = await apiFetch('/api/connectors/certs'); } catch { return; }
  el.innerHTML = `<div class="card-title">Certificates you trust</div>
    <p class="desc">A server on your own network that makes its own certificate (Proxmox VE, a NAS) is refused until you trust that exact certificate here. Look at it first; its fingerprint is what you can compare with the server's own pages.</p>
    ${d.certs.map(c => `<div class="disk-row row3"><span class="disk-label">${escHtml(c.origin)}</span><span class="disk-path" title="${escHtml(c.fingerprint)}">${escHtml(c.subject || '')} · ${escHtml(String(c.fingerprint).slice(0, 29))}… · until ${escHtml(c.validTo || '')}</span>
      <span class="disk-free"><button class="btn btn-xs" onclick="certPinForget(${jsArg(c.origin)})">Forget</button></span></div>`).join('')}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><input class="input" id="cert-origin" placeholder="https://pve.lan:8006" style="flex:1;min-width:200px">
      <button class="btn btn-sm" onclick="certPinLook()">Look at its certificate</button></div><div id="cert-seen"></div>`;
}

async function certPinLook() {
  const origin = document.getElementById('cert-origin').value.trim(), box = document.getElementById('cert-seen');
  box.innerHTML = '<p class="desc">Looking…</p>';
  try {
    const c = await apiFetch('/api/connectors/certs/look', { method: 'POST', body: { origin } });
    box.innerHTML = `<div class="desc" style="margin-top:8px"><b>${escHtml(c.origin)}</b> presents ${c.selfSigned ? 'its own certificate' : 'a certificate'} for <b>${escHtml(c.subject || '?')}</b>, from ${escHtml(c.issuer || '?')}, valid until ${escHtml(c.validTo || '?')}.
      <br>Fingerprint (SHA-256): <code style="word-break:break-all">${escHtml(c.fingerprint)}</code>
      <br>Compare it with what the server itself shows (Proxmox: the node's System → Certificates) before trusting it.
      <div style="margin-top:6px"><button class="btn btn-sm btn-teal" onclick="certPinTrust(${jsArg(c.origin)}, ${jsArg(c.fingerprint)})">Trust this certificate</button></div></div>`;
  } catch (e) { box.innerHTML = `<p class="desc" style="color:var(--red)">${escHtml(e.message)}</p>`; }
}

async function certPinTrust(origin, fingerprint) {
  try { await apiFetch('/api/connectors/certs', { method: 'POST', body: { origin, fingerprint } }); certPinsRender(); }
  catch (e) { appAlert(e.message); }
}

function certPinForget(origin) {
  confirmRemove(`trust in ${origin}'s certificate`, 'Calls to it are refused again until you trust it once more.', async () => {
    try { await apiFetch(`/api/connectors/certs?origin=${encodeURIComponent(origin)}`, { method: 'DELETE' }); certPinsRender(); } catch (e) { appAlert(e.message); }
  });
}

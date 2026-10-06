/* Settings → System → Network (modules/network.js): who can reach this hub, and what may be done from outside
   Tailscale. A change of how it listens takes effect at the next start; the restart waits for running work. */
async function networkCard() {
  const panel = document.getElementById('sp-system');
  if (!panel) return;
  let s;
  try { s = await apiFetch('/api/network'); } catch { document.getElementById('network-card')?.remove(); return; }   // not an admin
  let card = document.getElementById('network-card');
  if (!card) { card = Object.assign(document.createElement('div'), { className: 'card form-help-skip', id: 'network-card' }); const caps = document.getElementById('host-caps-card'); if (caps) caps.after(card); else panel.prepend(card); }
  const opt = (v, label, hint) => `<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;margin:6px 0"><input type="radio" name="net-listen" value="${v}" ${s.saved === v ? 'checked' : ''} ${s.env ? 'disabled' : ''}>
    <span><b>${label}</b><br><span style="color:var(--muted);font-size:11px">${hint}</span></span></label>`;
  card.innerHTML = `<div class="card-title">Network — who can reach this hub</div>
    ${s.env ? `<p style="font-size:11px;color:var(--amber)">Set by DOCA_LISTEN=${escHtml(s.env)} in the environment, which wins over this setting.</p>` : ''}
    ${opt('tailnet', 'Tailscale and this machine', 'The default: every device on your tailnet, nothing else.')}
    ${opt('lan', 'Tailscale and the local network', 'Also phones and computers on the same Wi-Fi or LAN — pairing works without Tailscale. Managing the machine from there stays off unless allowed below.')}
    ${opt('local', 'This machine only', 'Reach it through tailscale serve or an SSH tunnel.')}
    ${opt('all', 'Every network', 'Every interface, the internet included if the machine is exposed. Only behind a firewall or proxy you control.')}
    <label style="display:flex;gap:8px;align-items:center;font-size:12px;margin-top:10px"><input type="checkbox" id="net-lanadmin" ${s.lanAdmin ? 'checked' : ''}>
      Allow managing the machine from outside Tailscale <span style="color:var(--muted);font-size:11px">(off: from the local network people read and chat; admin work stays on Tailscale or this machine)</span></label>
    <div class="toolbar" style="margin-top:8px"><button class="btn btn-sm btn-blue" onclick="networkSave()">Save</button>
      <span class="status-line" id="net-status">Now: ${escHtml(s.listen)}</span></div>`;
}

async function networkSave() {
  const listen = document.querySelector('input[name="net-listen"]:checked')?.value;
  const lanAdmin = document.getElementById('net-lanadmin').checked;
  const go = async () => {
    let r;
    try { r = await apiFetch('/api/network', { method: 'POST', body: { listen, lanAdmin } }); } catch (e) { return appAlert(e.message); }
    setStatus(document.getElementById('net-status'), r.restartNeeded ? `Saved — ${r.saved} from the next start (Settings → General → Restart).` : '✓ Saved', 'ok', { clear: 0 });
  };
  if (listen === 'all') appConfirm('Every network: anyone who can reach this machine can try to sign in. Only do this behind a firewall or a proxy you control.', go);
  else go();
}

/* 📱 in the header: this hub as QR codes, to open it on a phone; and on a phone's browser, the DOCA app offered. */
async function hubLinksOpen() {
  let d;
  try { d = await apiFetch('/api/hub/links'); } catch (e) { return appAlert(e.message); }
  const ov = Object.assign(document.createElement('div'), { className: 'model3d-full hub-links' });
  ov.innerHTML = `<div class="model3d-bar"><b>Open DOCA on another device</b><span style="flex:1"></span><button class="btn btn-xs" type="button">✕</button></div>
    <div class="hub-links-body">${d.links.map(l => `<div class="hub-link"><div class="hub-qr">${l.qr || ''}</div><div><b>${escHtml(l.label)}</b><br><code>${escHtml(l.url)}</code></div></div>`).join('')
      || '<p>No address another device can reach: this hub listens to this machine only (Settings → System → Network).</p>'}
      <div class="hub-pair"><button class="btn btn-sm btn-teal" type="button" onclick="hubPairPhone(this)">📱 Pair a phone</button>
        <span>Three steps: scan the code above on the phone and sign in → install the app it offers → open the app and scan the pairing code that appears here.</span></div>
      <p class="hub-links-note">Scan with the phone's camera. On a phone the page offers the DOCA app; to pair it, Settings → API Keys → Pair a device.${d.mode === 'tailnet' ? ' The phone needs Tailscale — or allow the local network in Settings → System → Network.' : ''}</p></div>`;
  document.body.append(ov);
  const release = overlayBack(() => ov.remove());
  ov.querySelector('.model3d-bar button').onclick = () => { release(); ov.remove(); };
}

/** The pairing code for a phone, in the same window: one place from "open DOCA there" to "paired". */
async function hubPairPhone(btn) {
  let p;
  try { p = await apiFetch('/api/devices/pair', { method: 'POST', body: { name: 'Phone', preset: 'phone' } }); }
  catch (e) { return appAlert(`${e.message} (pairing is an admin's, from Tailscale or this machine)`); }
  const box = btn.closest('.hub-pair');
  box.innerHTML = `<div class="hub-link"><div class="hub-qr">${p.qr || ''}</div><div><b>In the DOCA app: Pair → scan this</b><br>
    or type the code <code style="font-size:18px">${escHtml(p.code)}</code><br><span style="color:#aaa">Valid until ${escHtml(new Date(p.expiresAt).toLocaleTimeString())}.
    The phone appears in Settings → API Keys once paired; rename it there.</span></div></div>`;
}

function hubAppBanner() {
  const ua = navigator.userAgent || '';
  if (!/Android/i.test(ua) || /DocaMobile\//.test(ua)) return;   // a phone's browser, not the app itself
  try { if (localStorage.getItem('doca.app.banner') === 'no') return; } catch { /* blocked: shown */ }
  const b = Object.assign(document.createElement('div'), { className: 'hub-app-banner' });
  b.innerHTML = `<span>📱 <b>The DOCA app</b> — notifications, voice and your watch.</span>
    <a class="btn btn-xs btn-teal" href="/api/clients/apps/docamobile/apk">Download</a><button class="btn btn-xs" type="button">Not now</button>`;
  b.querySelector('button').onclick = () => { try { localStorage.setItem('doca.app.banner', 'no'); } catch { /* blocked */ } b.remove(); };
  document.body.append(b);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') window.addEventListener('load', () => {
  if (!document.getElementById('chat-fab')) return;
  const btn = Object.assign(document.createElement('button'), { className: 'btn btn-xs solo-open', textContent: '📱', title: 'Open DOCA on another device: QR codes to this hub' });
  btn.onclick = hubLinksOpen;
  document.getElementById('header-search')?.before(btn);
  hubAppBanner();
});

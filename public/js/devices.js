/* ═══════════════════════════════════════════════════════
   DOCA PANEL — DOCA DEVICE TOKENS  (/api/v1 registry)
   ═══════════════════════════════════════════════════════ */

let _devData = { presets: {}, pairTtlSec: 300, trusted: true };
let _devCountdown = null;

/* ── List ─────────────────────────────────────────────── */

async function devicesLoad() {
  const list = document.getElementById('doca-devices-list');
  if (!list) return;
  try {
    const data = await apiFetch('/api/devices');
    _devData = data;
    devOwnApply(data);   // "Your devices" for a person without the devices right (devices-own.js)
    _devShowing = data.own ? {} : (await apiFetch('/api/screens/showing').catch(() => ({}))).screens || {};   // what each screen shows now (screens/showing.js)
    devPopulatePresets();

    const pairBtn  = document.getElementById('dev-pair-btn');
    const issueBtn = document.getElementById('dev-issue-btn');
    if (!data.trusted) {
      if (pairBtn)  pairBtn.disabled  = true;
      if (issueBtn) issueBtn.disabled = true;
    }

    if (!data.devices?.length) {
      list.innerHTML = `<div class="placeholder">
        No devices yet. ${data.trusted ? 'Use <strong>Pair a device</strong> to enrol a phone or watch.' : 'Issue one on the host with <code>npm run token</code>.'}
      </div>`;
      return;
    }

    list.innerHTML = data.devices.map(d => {
      const revoked = !!d.revokedAt;
      const expired = d.expiresAt && Date.parse(d.expiresAt) < Date.now();
      const dead    = revoked || expired;
      if (d.kind === 'browser' || d.kind === 'channel') return devSessionCardHtml(d, dead);
      return `
      <div class="provider-card ${dead ? 'no-key' : 'has-key'}">
        <div class="provider-header">
          <span class="provider-name">${escHtml(d.name)}</span>
          <span class="provider-badge ${dead ? 'no' : 'ok'}"${!dead && d.approval?.state === 'pending' ? ' style="background:var(--bg-amber);color:var(--amber)"' : ''}>${revoked ? (d.approval?.state === 'refused' ? 'REFUSED' : 'REVOKED') : expired ? 'EXPIRED' : d.approval?.state === 'pending' ? 'WAITING' : d.kind === 'agent' ? 'AGENT' : 'ACTIVE'}</span>
        </div>
        <div class="provider-models">
          <code>${escHtml(d.id)}</code> · ${escHtml(d.caps?.formFactor || 'other')}
          · last seen ${d.lastSeenAt ? escHtml(new Date(d.lastSeenAt).toLocaleString()) : 'never'}
        </div>
        <div class="provider-models">${d.scopes.map(s => `<code>${escHtml(s)}</code>`).join(' ')}</div>${devApprovalHtml(d)}
        ${d.missingScopes?.length ? `<div class="input-label mt8" style="text-transform:none;letter-spacing:0;color:var(--amber)">
          Paired before its preset (${escHtml(d.preset)}) gained: ${d.missingScopes.map(s => `<code>${escHtml(s)}</code>`).join(' ')}
          <button class="btn btn-xs" onclick="devGrant(${jsArg(d.id)}, ${jsArg(d.missingScopes.join(','))})" title="Add these to this device — same id, queue and token">+ Grant</button></div>` : ''}
        ${dead || _devData.own ? '' : devHandsHtml(d)}
        ${dead ? `
        <div class="toolbar-right">
          <button class="btn btn-xs btn-red" onclick="devForget(${jsArg(d.id)},${jsArg(d.name)})" title="Remove this row and everything kept under its id">🗑 Forget</button>
        </div>` : `
        <div class="toolbar-right">
          ${d.mine ? `<a class="btn btn-xs" href="/d/${encodeURIComponent(d.id)}/" target="_blank" rel="noopener" title="Its own page: its look, tabs and notifications, as it shows them">⧉ Its page</a>` : ''}
          <button class="btn btn-xs"        onclick="devRename(${jsArg(d.id)},${jsArg(d.name)})" title="Give it another name">✎ Rename</button>
          <button class="btn btn-xs"        onclick="devRotate(${jsArg(d.id)},${jsArg(d.name)})" title="Issue a replacement token">↻ Rotate</button>
          <button class="btn btn-xs btn-red" onclick="devRevoke(${jsArg(d.id)},${jsArg(d.name)})" title="Invalidate this token now">✕ Revoke</button>
        </div>`}
        <div class="status-line" id="dev-status-${escHtml(d.id)}"></div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

/** What each role is for, in the person's words: a role picked by its name alone paired doca-client as a watch (no mcp:self), and its tools never arrived. */
const DEV_ROLE_FOR = {
  phone: 'a phone (DocaMobile), or a computer: DocaDesk, doca-client',
  watch: 'a Wear OS watch (DocaWear) — no tools of its own to lend',
  extension: 'the DOCA browser extension',
  agent: 'a program that acts on your devices',
  viewer: 'reads only',
  hub: 'another DOCA hub, to send this one packs',
  registry: 'another DOCA hub, to fetch what this one publishes',
  admin: 'full control of this server',
};

function devPopulatePresets() {
  const describe = p => (_devData.presets?.[p] || []).join(' ');
  for (const kind of ['pair', 'issue']) {
    const sel = document.getElementById(`dev-${kind}-preset`);
    if (!sel || sel.options.length) continue;
    // Pairing asks what the device is rather than guessing: every role but one is wrong for most devices.
    sel.innerHTML = (kind === 'pair' ? '<option value="" selected disabled>Choose what you are pairing…</option>' : '') +
      Object.keys(_devData.presets || {}).map(p =>
        `<option value="${escHtml(p)}"${kind === 'issue' && p === 'agent' ? ' selected' : ''}>${escHtml(p)}${DEV_ROLE_FOR[p] ? ` — ${escHtml(DEV_ROLE_FOR[p])}` : ''}</option>`
      ).join('');
    const show = () => {
      const el = document.getElementById(`dev-${kind}-scopes`);
      if (el && !sel.value) { el.textContent = 'A computer running doca-client or DocaDesk is "phone": it needs mcp:self to lend its tools.'; return; }
      const warn = sel.value === 'admin' ? ' <strong style="color:var(--red)">— full control of this server</strong>'
        : sel.value === 'extension' ? ' — for the DOCA browser extension: <a href="/api/clients/browser.zip">download it</a> (Chrome, Edge, Brave: Extensions → Developer mode → Load unpacked, from the unzipped folder; Firefox: about:debugging → Load Temporary Add-on → manifest.json)'
        // A home node (doca-client home setup) is the household's link to Home Assistant: it has to stay on.
        : sel.value === 'phone' ? ' — for a <b>home node</b> (doca-client keeping Home Assistant), pick a machine that stays on: a mini PC, a Pi, a NAS. A laptop that sleeps takes the home with it.' : '';
      if (el) el.innerHTML = `Scopes: <code>${escHtml(describe(sel.value))}</code>${warn}`;
    };
    sel.onchange = show;
    show();
  }
}

/* ── Forms ────────────────────────────────────────────── */

function devShowForm(which) {
  devHideForms();
  const el = document.getElementById(`dev-${which}-form`);
  if (el) el.style.display = 'block';
  devPopulatePresets();
}

function devHideForms() {
  for (const w of ['pair', 'issue']) {
    const el = document.getElementById(`dev-${w}-form`);
    if (el) el.style.display = 'none';
  }
}

function devClearResult() {
  if (_devCountdown) { clearInterval(_devCountdown); _devCountdown = null; }
  const el = document.getElementById('dev-result');
  if (el) el.innerHTML = '';
}

/* ── Pair (preferred) ─────────────────────────────────── */

async function devPairStart() {
  const name   = document.getElementById('dev-pair-name')?.value.trim();
  const preset = document.getElementById('dev-pair-preset')?.value;
  const status = document.getElementById('dev-pair-status');
  if (!name) { setStatus(status, 'Give the device a name first', 'err'); return; }
  if (!preset) { setStatus(status, 'Choose what you are pairing (its role) first', 'err'); return; }

  try {
    const p = await apiFetch('/api/devices/pair', { method: 'POST', body: { name, preset, forUser: devPairFor() } });
    setStatus(status, '', '');
    devHideForms();
    devRenderPairing(p);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function devRenderPairing(p) {
  devClearResult();
  const el = document.getElementById('dev-result');
  if (!el) return;

  el.innerHTML = `
    <div class="card mt8" style="border-color:var(--teal)">
      <div class="card-title">Pairing ${escHtml(p.name)}</div>
      <div class="row" style="align-items:center;gap:16px;flex-wrap:wrap">
        <!-- The QR is sized by the box, not by whatever intrinsic size the
             encoder happened to emit: one rule here, and a code that scans. -->
        <div class="dev-qr" style="flex:0 0 auto;background:#fff;padding:8px;border-radius:var(--radius);width:180px;height:180px">
          ${p.qr || '<div class="placeholder">No QR: the encoder is not installed on this host '
            + '(npm install qrcode). The code beside this still pairs.</div>'}
        </div>
        <div class="flex1" style="min-width:200px">
          <div class="input-label">Enter this code in the app</div>
          <div style="font-family:var(--font-mono);font-size:32px;letter-spacing:4px;color:var(--accent)">${escHtml(p.code)}</div>
          <div class="status-line info" id="dev-pair-countdown"></div>
          <!-- The link as text too, for a machine with no camera: doca-client pairs from it in one step (self-test 2026-10-08). -->
          ${p.url ? `<div class="input-label mt8">Or this link: <code style="user-select:all;word-break:break-all;text-transform:none">${escHtml(p.url)}</code></div>` : ''}
          <div class="input-label mt8">Scopes: <code>${escHtml((p.scopes || []).join(' '))}</code></div>${devPairCanHtml(p)}
          <div class="toolbar-right mt8">
            <button class="btn btn-xs" onclick="devCopy(${jsArg(p.url)}, this)">Copy link</button>
            <button class="btn btn-xs" onclick="devClearResult()">Done</button>
          </div>
        </div>
      </div>
      <div class="input-label mt8">
        Single use. The device mints its own token when it completes pairing — nothing secret is shown here.
      </div>
    </div>`;

  const deadline = Date.parse(p.expiresAt);
  const tick = () => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const cd = document.getElementById('dev-pair-countdown');
    if (!cd) return;
    if (left <= 0) {
      cd.textContent = 'Expired — generate a new code.';
      cd.className = 'status-line err';
      clearInterval(_devCountdown); _devCountdown = null;
      devicesLoad();
      return;
    }
    cd.textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  _devCountdown = setInterval(tick, 1000);
}

/* ── Issue directly (advanced) ────────────────────────── */

async function devIssue() {
  const name   = document.getElementById('dev-issue-name')?.value.trim();
  const preset = document.getElementById('dev-issue-preset')?.value;
  const status = document.getElementById('dev-issue-status');
  if (!name) { setStatus(status, 'Give the device a name first', 'err'); return; }

  try {
    const r = await apiFetch('/api/devices', { method: 'POST', body: { name, preset } });
    setStatus(status, '', '');
    devHideForms();
    devRenderToken(r.device, r.token, 'Token issued');
    devicesLoad();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function devRenderToken(device, token, title) {
  devClearResult();
  const el = document.getElementById('dev-result');
  if (!el) return;
  el.innerHTML = `
    <div class="card mt8" style="border-color:var(--red)">
      <div class="card-title">${escHtml(title)} — ${escHtml(device.name)}</div>
      <div class="status-line warn">Shown once. Only a hash is stored, so it cannot be recovered — copy it now.</div>
      <pre class="code-out" style="white-space:pre-wrap;word-break:break-all;margin-top:8px">${escHtml(token)}</pre>
      <div class="input-label">Scopes: <code>${escHtml((device.scopes || []).join(' '))}</code></div>
      <div class="toolbar-right mt8">
        <button class="btn btn-xs btn-green" onclick="devCopy(${jsArg(token)}, this)">Copy token</button>
        <button class="btn btn-xs" onclick="devClearResult()">Dismiss</button>
      </div>
    </div>`;
}

/**
 * A browser someone signed in on (modules/screens) or a linked chat (channels/telegram): no token, so no
 * scopes to show, no hands and nothing to rotate — revoking signs the browser out or unlinks the chat.
 */
function devSessionCardHtml(d, dead) {
  const what = d.kind === 'browser' ? 'BROWSER' : String(d.caps?.ext?.channel || 'chat').toUpperCase();
  return `
      <div class="provider-card ${dead ? 'no-key' : 'has-key'}">
        <div class="provider-header">
          <span class="provider-name">${escHtml(d.name)}</span>
          <span class="provider-badge ${dead ? 'no' : 'ok'}">${dead ? 'REVOKED' : what}</span>
        </div>
        <div class="provider-models"><code>${escHtml(d.id)}</code> · ${d.kind === 'browser' ? 'its own look, tabs and sections; signed in by password' : 'a linked chat'}
          · last seen ${d.lastSeenAt ? escHtml(new Date(d.lastSeenAt).toLocaleString()) : 'never'}${_devShowingHtml(d, dead)}</div>${devApprovalHtml(d)}
        <div class="toolbar-right">
          ${dead ? `<button class="btn btn-xs btn-red" onclick="devForget(${jsArg(d.id)},${jsArg(d.name)})" title="Remove this row and its settings">🗑 Forget</button>`
            : `<button class="btn btn-xs btn-red" onclick="devRevoke(${jsArg(d.id)},${jsArg(d.name)})" title="${d.kind === 'browser' ? 'Sign this browser out now' : 'Stop this chat reaching the hive'}">✕ ${d.kind === 'browser' ? 'Sign out' : 'Unlink'}</button>`}
        </div>
        <div class="status-line" id="dev-status-${escHtml(d.id)}"></div>
      </div>`;
}

let _devShowing = {};
/** A screen: the page it shows now, and a page sent to it — alone, for a screen given to one thing (solo.js). */
function _devShowingHtml(d, dead) {
  if (d.kind !== 'browser' || dead || _devData.own) return '';   // sending a page to a screen is a host's (screens/showing.js)
  const s = _devShowing[d.id], label = t => (typeof NAV_LABELS !== 'undefined' && NAV_LABELS[t]) || t;
  const pages = typeof NAV_TABS !== 'undefined' ? NAV_TABS : [];
  return `<br>${s ? `showing <b>${escHtml(label(s.page || '?'))}</b>${s.solo ? ' alone' : ''}${s.visible ? '' : ' (hidden)'}` : 'not open now'}
    <span class="dev-show">show here <select class="input" id="dev-show-${escHtml(d.id)}" style="width:auto;padding:2px 4px">${pages.map(t => `<option value="${t}">${escHtml(label(t))}</option>`).join('')}</select>
    <label style="font-size:11px"><input type="checkbox" id="dev-solo-${escHtml(d.id)}" checked> alone</label>
    <button class="btn btn-xs" onclick="devShowHere(${jsArg(d.id)})">Show</button></span>`;   // one group, wrapping whole (des 29)
}

async function devShowHere(id) {
  const page = document.getElementById(`dev-show-${id}`)?.value, solo = !!document.getElementById(`dev-solo-${id}`)?.checked;
  try { const r = await apiFetch(`/api/screens/${encodeURIComponent(id)}/show`, { method: 'POST', body: { page, solo } }); setStatus(document.getElementById(`dev-status-${id}`), `Sent — ${r.showing}.`, 'ok'); }
  catch (e) { devFailed(id, e); }
}

/* ── Rotate / revoke ──────────────────────────────────── */

/**
 * Report a failure on the card it belongs to.
 *
 * These were `appAlert()`, which put a modal over the whole page to say that
 * one card's button did not work. Not silent, but heavier than the answer
 * deserves — every other action in this panel reports inline, and the card has
 * a status line for exactly this. The modal also had to be dismissed before
 * anything else could be done, including retrying the thing that failed.
 *
 * Only failures come here. A success re-renders the list, which would wipe the
 * line before it was read, so success keeps its own feedback (the token card,
 * or the row simply changing state).
 */
function devFailed(id, e) {
  const el = document.getElementById(`dev-status-${id}`);
  // The card can be gone if the list re-rendered underneath us; falling back to
  // the modal is better than swallowing the only report of a failure.
  if (el) setStatus(el, `✗ ${e.message}`, 'err');
  else appAlert(`Error: ${e.message}`);
}

function devRotate(id, name) {
  appConfirm(`Rotate the token for "${name}"? The current one keeps working for a short grace period, then stops.`, async () => {
    try {
      const r = await apiFetch(`/api/devices/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
      devRenderToken(r.device, r.token, 'Token rotated');
      devicesLoad();
    } catch (e) { devFailed(id, e); }
  });
}

function devRevoke(id, name) {
  appConfirm(`Revoke "${name}"? Its token stops working immediately and any live stream is closed. The row stays, so you can see it was revoked.`, async () => {
    try {
      await apiFetch(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
      devicesLoad();
    } catch (e) { devFailed(id, e); }
  });
}

// Revoking leaves the row on purpose; without this there was no way to clear one,
// so every re-pair left a REVOKED card behind for good.
function devForget(id, name) {
  appConfirm(`Forget "${name}"? The row disappears along with its queued events and its saved profile. Nothing here will show that this device ever existed.`, async () => {
    try {
      await apiFetch(`/api/devices/${encodeURIComponent(id)}?purge=1`, { method: 'DELETE' });
      devicesLoad();
    } catch (e) { devFailed(id, e); }
  });
}

/* ── Clipboard ────────────────────────────────────────── */

async function devCopy(text, btn) {
  const label = btn?.textContent;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) btn.textContent = '✓ Copied';
  } catch {
    // Insecure origin or denied permission: fall back to a selectable prompt.
    appPrompt('Copy manually:', () => {}, text);
    return;
  }
  if (btn) setTimeout(() => { btn.textContent = label; }, 1500);
}

/** Add the scopes a device's preset now grants and its record lacks (devices-panel.handleGrant). */
function devGrant(id, list) {
  const add = String(list).split(',').filter(Boolean);
  appConfirm(`Give this device ${add.join(', ')}? It keeps its id, its queue and its token.`, async () => {
    try { await apiFetch(`/api/devices/${encodeURIComponent(id)}/scopes`, { method: 'POST', body: { add } }); devicesLoad(); }
    catch (e) { setStatus(document.getElementById(`dev-status-${id}`), `✗ ${e.message}`, 'err'); }
  });
}

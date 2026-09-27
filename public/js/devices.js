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
      return `
      <div class="provider-card ${dead ? 'no-key' : 'has-key'}">
        <div class="provider-header">
          <span class="provider-name">${escHtml(d.name)}</span>
          <span class="provider-badge ${dead ? 'no' : 'ok'}">${revoked ? 'REVOKED' : expired ? 'EXPIRED' : d.kind === 'agent' ? 'AGENT' : 'ACTIVE'}</span>
        </div>
        <div class="provider-models">
          <code>${escHtml(d.id)}</code> · ${escHtml(d.caps?.formFactor || 'other')}
          · last seen ${d.lastSeenAt ? escHtml(new Date(d.lastSeenAt).toLocaleString()) : 'never'}
        </div>
        <div class="provider-models">${d.scopes.map(s => `<code>${escHtml(s)}</code>`).join(' ')}</div>
        ${d.missingScopes?.length ? `<div class="input-label mt8" style="text-transform:none;letter-spacing:0;color:var(--amber)">
          Paired before its preset (${escHtml(d.preset)}) gained: ${d.missingScopes.map(s => `<code>${escHtml(s)}</code>`).join(' ')}
          <button class="btn btn-xs" onclick="devGrant(${jsArg(d.id)}, ${jsArg(d.missingScopes.join(','))})" title="Add these to this device — same id, queue and token">+ Grant</button></div>` : ''}
        ${dead ? '' : devHandsHtml(d) + devConsoleHtml(d)}
        ${dead ? `
        <div class="toolbar-right">
          <button class="btn btn-xs btn-red" onclick="devForget(${jsArg(d.id)},${jsArg(d.name)})" title="Remove this row and everything kept under its id">🗑 Forget</button>
        </div>` : `
        <div class="toolbar-right">
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

function devPopulatePresets() {
  const describe = p => (_devData.presets?.[p] || []).join(' ');
  for (const kind of ['pair', 'issue']) {
    const sel = document.getElementById(`dev-${kind}-preset`);
    if (!sel || sel.options.length) continue;
    sel.innerHTML = Object.keys(_devData.presets || {}).map(p =>
      `<option value="${escHtml(p)}"${p === (kind === 'pair' ? 'watch' : 'agent') ? ' selected' : ''}>${escHtml(p)}</option>`
    ).join('');
    const show = () => {
      const el = document.getElementById(`dev-${kind}-scopes`);
      const warn = sel.value === 'admin' ? ' <strong style="color:var(--red)">— full control of this server</strong>' : '';
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

  try {
    const p = await apiFetch('/api/devices/pair', { method: 'POST', body: { name, preset } });
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
          <div class="input-label mt8">Scopes: <code>${escHtml((p.scopes || []).join(' '))}</code></div>
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

/* ── Devices as hands (modules/devices-control.js; docs/design/devices-as-hands.md) ── */

const DEV_FAMILY_LABEL = { files: 'Files', shell: 'Shell', processes: 'Processes', screen: 'Screen', input: 'Input',
  apps: 'Apps', device: 'Device', elevated: 'Admin', mcp: 'MCP' };

/** What a device lets the harness do, and the actions on it. */
function devHandsHtml(d) {
  const c = d.control || { grants: {}, revoked: [], history: [], families: Object.keys(DEV_FAMILY_LABEL) };
  const id = jsArg(d.id);
  const chips = c.families.map(f => {
    const granted = c.grants?.[f] === true, revoked = c.revoked?.includes(f);
    const state = revoked ? 'revoked here' : granted ? 'granted' : c.grants?.[f] === false ? 'refused on the device' : 'not reported';
    const cls = revoked ? 'dev-fam revoked' : granted ? 'dev-fam on' : 'dev-fam';
    const act = revoked ? 'restore' : granted ? 'revoke' : 'ask';
    const tip = revoked ? 'Revoked here — click to allow again' : granted ? 'Granted on the device — click to take it back from here' : 'Click to ask the device for it';
    return `<button class="${cls}" title="${escHtml(`${DEV_FAMILY_LABEL[f]}: ${state}. ${tip}`)}" onclick="devControl(${id}, '${act}', '${f}')">${escHtml(DEV_FAMILY_LABEL[f])}</button>`;
  }).join('');
  const last = c.history?.[0];
  const lastLine = last ? `Last: ${escHtml(last.action)}${last.family ? ` ${escHtml(last.family)}` : ''} ${escHtml(new Date(last.at).toLocaleTimeString())} —
      ${last.ackAt ? (last.ok ? `done${last.detail ? `: ${escHtml(last.detail)}` : ''}` : `refused: ${escHtml(last.detail || '')}`) : 'not answered yet'}` : '';
  return `<div class="dev-hands">
      <div class="dev-fams">${chips}</div>
      <div class="dev-acts">
        <button class="btn btn-xs" onclick="devControl(${id}, 'refresh')" title="The device reports its caps, permissions and state again">⟳ Refresh</button>
        <button class="btn btn-xs" onclick="devControl(${id}, 'reconnect')" title="Drop and reopen its connection">⇄ Reconnect</button>
        <button class="btn btn-xs" onclick="devControl(${id}, 'disconnect')" title="End its sessions and stop its services until it is opened again — it stays paired">⏻ Disconnect</button>
        ${c.disconnected ? '<span class="dev-off">disconnected</span>' : ''}
      </div>
      ${lastLine ? `<div class="input-label" style="text-transform:none;letter-spacing:0">${lastLine}</div>` : ''}
    </div>`;
}

/* ── A device as a console (modules/device-console.js): its live stream, and who receives it ── */

function devConsoleHtml(d) {
  if (!d.scopes?.includes('sensors:report')) return '';
  return `<details class="dev-console" style="margin-top:6px" ontoggle="devConsoleToggle(this, ${jsArg(d.id)})">
      <summary class="input-label" style="cursor:pointer">Console — motion, heading, crown, A/B/C</summary>
      <div class="dev-console-live" style="font-size:11px;margin:4px 0">…</div>
      <div class="dev-console-links" style="font-size:11px"></div>
    </details>`;
}

// ponytail: polls once a second while open; an SSE feed if a console ever needs more than a glance
async function devConsoleToggle(el, id) {
  if (!el.open) return;
  const url = `/api/devices/${encodeURIComponent(id)}/console`;
  try {
    const [{ devices }, c] = await Promise.all([apiFetch('/api/devices'), apiFetch(url)]);
    const others = devices.filter(x => x.id !== id && !x.revokedAt);
    el.querySelector('.dev-console-links').innerHTML = others.length
      ? `Send it to: ${others.map(x => `<label style="margin-right:10px"><input type="checkbox" value="${escHtml(x.id)}" ${c.links.includes(x.id) ? 'checked' : ''}
          onchange="devConsoleLinks(this.closest('details'), ${jsArg(id)})"> ${escHtml(x.name)}</label>`).join('')}`
      : 'No other device to send it to.';
  } catch (e) { el.querySelector('.dev-console-live').textContent = `✗ ${e.message}`; return; }
  const draw = async () => {
    if (!el.open || !el.isConnected) return clearInterval(timer);
    try {
      const c = await apiFetch(url);
      const f = c.frames.at(-1) || {};
      const crown = c.frames.reduce((s, x) => s + (x.crown || 0), 0);
      el.querySelector('.dev-console-live').innerHTML = `
        <b>${c.enabled ? 'ENABLED' : 'off'}</b>${c.at ? ` · last input ${escHtml(new Date(c.at).toLocaleTimeString())}` : ' · nothing received yet'}<br>
        accel ${f.accel ? f.accel.map(v => v.toFixed(1)).join(', ') : '—'} · heading ${f.heading !== undefined ? `${Math.round(f.heading)}°` : '—'}
        · crown ${crown ? crown.toFixed(1) : '—'} (last ${c.frames.length} frames)<br>
        presses ${c.presses.length ? c.presses.slice(-8).reverse().map(p => `<code>${escHtml(p.press)}</code> ${escHtml(new Date(p.at).toLocaleTimeString())}`).join(' · ') : '—'}`;
    } catch { /* the next tick tries again */ }
  };
  const timer = setInterval(draw, 1000);
  draw();
}

async function devConsoleLinks(el, id) {
  const links = [...el.querySelectorAll('.dev-console-links input:checked')].map(i => i.value);
  try { await apiFetch(`/api/devices/${encodeURIComponent(id)}/console`, { method: 'PUT', body: { links } }); }
  catch (e) { setStatus(document.getElementById(`dev-status-${id}`), `✗ ${e.message}`, 'err'); }
}

async function devControl(id, action, family) {
  const go = async () => {
    try {
      await apiFetch(`/api/devices/${encodeURIComponent(id)}/control`, { method: 'POST', body: { action, ...(family ? { family } : {}) } });
      setStatus(document.getElementById(`dev-status-${id}`), `✓ ${action}${family ? ` ${family}` : ''} sent`, 'ok');
      devicesLoad(); devThisDevice();
    } catch (e) { setStatus(document.getElementById(`dev-status-${id}`), `✗ ${e.message}`, 'err'); }
  };
  if (action === 'disconnect') appConfirm('Disconnect this device? Its sessions end and its services stop until it is opened again. It stays paired.', go);
  else go();
}

/** On a device's own page (/d/<id>/): a "This device" card at the top of Settings. */
const DOCA_DEVICE_ID = (location.pathname.match(/^\/d\/([^/]+)\//) || [])[1] || null;
async function devThisDevice() {
  if (!DOCA_DEVICE_ID) return;
  const panel = document.getElementById('sp-general');
  if (!panel) return;
  let card = document.getElementById('dev-this-card');
  if (!card) {
    card = Object.assign(document.createElement('div'), { className: 'card', id: 'dev-this-card' });
    panel.prepend(card);
  }
  try {
    const { devices } = await apiFetch('/api/devices');
    const d = devices.find(x => x.id === DOCA_DEVICE_ID);
    if (!d) { card.remove(); return; }
    card.innerHTML = `<div class="card-title">This device — ${escHtml(d.name)}</div>
      <p style="font-size:11px;color:var(--muted);margin-bottom:8px">What this device lets DOCA's agents do here, and its connection.
        Permissions are granted on the device itself; you can take any of them back from here.</p>
      ${devHandsHtml(d)}${devConsoleHtml(d)}<div class="status-line" id="dev-status-${escHtml(d.id)}"></div>
      ${/DocaMobile\//.test(navigator.userAgent) ? '<a class="btn" href="doca://settings" style="display:inline-block;margin-top:8px">App settings — connection and permissions</a>' : ''}`;
  } catch { card.remove(); }
}
if (typeof document !== 'undefined' && DOCA_DEVICE_ID) document.addEventListener('DOMContentLoaded', () => setTimeout(devThisDevice, 500));

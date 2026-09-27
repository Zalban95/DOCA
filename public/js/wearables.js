/* ── Settings → Wearables, and a device as a console (modules/device-console.js): its live stream, and who receives it ── */

function devConsoleHtml(d) {
  if (!d.scopes?.includes('sensors:report')) return '<p class="input-label" style="text-transform:none;letter-spacing:0">No console: this device was not granted <code>sensors:report</code>.</p>';
  return `<details class="dev-console" open data-id="${escHtml(d.id)}" ontoggle="devConsoleToggle(this, ${jsArg(d.id)})">
      <summary class="input-label" style="cursor:pointer">Console — motion, heading, crown, A/B/C</summary>
      <div class="dev-console-live" style="font-size:11px;margin:4px 0">…</div>
      <div class="dev-console-links" style="font-size:11px"></div>
    </details>`;
}

/** Settings → Wearables: one card per paired wearable (DocaWear on a watch), its console inside. */
const DEV_WEARABLE = { watch: 'DocaWear', glasses: 'Glasses' };
async function wearablesLoad() {
  const panel = document.getElementById('sp-wearables');
  if (!panel) return;
  try {
    const { devices } = await apiFetch('/api/devices');
    const wear = devices.filter(d => DEV_WEARABLE[d.caps?.formFactor] && !d.revokedAt);
    panel.innerHTML = wear.length ? wear.map(d => `<div class="card">
        <div class="card-title">${DEV_WEARABLE[d.caps.formFactor]} — ${escHtml(d.name)}</div>
        <div class="provider-models"><code>${escHtml(d.id)}</code> · last seen ${d.lastSeenAt ? escHtml(new Date(d.lastSeenAt).toLocaleString()) : 'never'}</div>
        ${devConsoleHtml(d)}<div class="status-line" id="dev-status-${escHtml(d.id)}"></div>
      </div>`).join('')
      : '<div class="card"><div class="placeholder">No wearable paired. Pair a watch from Settings → API Keys → Devices.</div></div>';
    panel.querySelectorAll('details.dev-console').forEach(el => devConsoleToggle(el, el.dataset.id));
  } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">✗ ${escHtml(e.message)}</div></div>`; }
}

// ponytail: polls once a second while open; an SSE feed if a console ever needs more than a glance
async function devConsoleToggle(el, id) {
  if (!el.open || el._live) return;   // the toggle event also fires for a card drawn open
  el._live = true;
  const url = `/api/devices/${encodeURIComponent(id)}/console`;
  try {
    const [{ devices }, c] = await Promise.all([apiFetch('/api/devices'), apiFetch(url)]);
    const others = devices.filter(x => x.id !== id && !x.revokedAt);
    el.querySelector('.dev-console-links').innerHTML = others.length
      ? `Send it to: ${others.map(x => `<label style="margin-right:10px"><input type="checkbox" value="${escHtml(x.id)}" ${c.links.includes(x.id) ? 'checked' : ''}
          onchange="devConsoleLinks(this.closest('details'), ${jsArg(id)})"> ${escHtml(x.name)}</label>`).join('')}`
      : 'No other device to send it to.';
  } catch (e) { el.querySelector('.dev-console-live').textContent = `✗ ${e.message}`; el._live = false; return; }
  const draw = async () => {
    if (!el.open || !el.isConnected) { el._live = false; return clearInterval(timer); }
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

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-wearables' })));

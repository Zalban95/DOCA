/* ── Settings → Wearables, and a device as a console (modules/device-console.js): its live stream, and who receives it ── */

function devConsoleHtml(d) {
  if (!d.scopes?.includes('sensors:report')) return '<p class="input-label" style="text-transform:none;letter-spacing:0">No console: this device was not granted <code>sensors:report</code>.</p>';
  return `<details class="dev-console" open data-id="${escHtml(d.id)}" ontoggle="devConsoleToggle(this, ${jsArg(d.id)})">
      <summary class="input-label" style="cursor:pointer">Console — motion, heading, crown, A/B/C</summary>
      <div class="dev-console-live" style="font-size:11px;margin:4px 0">…</div>
      <div class="dev-console-links" style="font-size:11px"></div>
      <div class="dev-console-buttons" style="font-size:11px;margin-top:6px"></div>
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
      : '<div class="card"><div class="placeholder">No wearable paired. Pair a watch from Field → API keys → Devices.</div></div>';
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
    const box = (value, on, label) => `<label style="margin-right:10px"><input type="checkbox" value="${escHtml(value)}" ${on ? 'checked' : ''}
          onchange="devConsoleLinks(this.closest('details'), ${jsArg(id)})"> ${label}</label>`;
    el.querySelector('.dev-console-links').innerHTML = `Send it to: ${others.map(x => box(x.id, c.links.includes(x.id), escHtml(x.name))).join('')}
        ${box('host', c.host, '<b>this host</b> (runs the commands)')}
      <br>As: <select onchange="devConsoleLinks(this.closest('details'), ${jsArg(id)})" class="input dev-console-mode" style="width:auto">
        <option value="keys" ${c.mode === 'keys' ? 'selected' : ''}>keys — A/B/C run their macros</option>
        <option value="joystick" ${c.mode === 'joystick' ? 'selected' : ''}>joystick — tilt and crown are axes</option></select>
      <span style="opacity:.7">(the watch switches it too: tap its centre)</span>`;
    el.querySelector('.dev-console-buttons').innerHTML = devConsoleButtonsHtml(id, c.buttons);
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
        presses ${c.presses.length ? c.presses.slice(-8).reverse().map(p => `<code>${escHtml(p.press)}${p.down === false ? ' off' : ''}</code> ${escHtml(new Date(p.at).toLocaleTimeString())}`).join(' · ') : '—'}
        · latched ${Object.keys(c.toggles).filter(k => c.toggles[k]).join(' ') || '—'}
        ${c.mode === 'joystick' && c.joystick ? `<br>joystick x ${c.joystick.x ?? '—'} · y ${c.joystick.y ?? '—'} · crown ${c.joystick.crown}` : ''}
        ${c.lastRun ? `<br>host ran ${escHtml(c.lastRun.button)} ${escHtml(new Date(c.lastRun.at).toLocaleTimeString())}: ${c.lastRun.running ? 'running…'
          : `${c.lastRun.timedOut ? 'timed out' : `exit ${c.lastRun.code}`}${c.lastRun.out ? ` — <code>${escHtml(c.lastRun.out.slice(-160))}</code>` : ''}`}` : ''}`;
    } catch { /* the next tick tries again */ }
  };
  const timer = setInterval(draw, 1000);
  draw();
}

async function devConsoleLinks(el, id) {
  const ticked = [...el.querySelectorAll('.dev-console-links input:checked')].map(i => i.value);
  const body = { links: ticked.filter(v => v !== 'host'), host: ticked.includes('host'), mode: el.querySelector('.dev-console-mode').value };
  try { await apiFetch(`/api/devices/${encodeURIComponent(id)}/console`, { method: 'PUT', body }); }
  catch (e) { setStatus(document.getElementById(`dev-status-${id}`), `✗ ${e.message}`, 'err'); }
}

/** A row per button: how it behaves, and its macro — keys for the devices, a command for this host. */
function devConsoleButtonsHtml(id, buttons) {
  const row = k => `<tr data-k="${k}"><td><b>${k}</b></td>
      <td><select class="input dcb-behaviour"><option value="button" ${buttons[k].behaviour === 'button' ? 'selected' : ''}>button</option>
        <option value="toggle" ${buttons[k].behaviour === 'toggle' ? 'selected' : ''}>toggle</option></select></td>
      <td><input class="input dcb-keys" placeholder="keys, e.g. ctrl+s" value="${escHtml(buttons[k].keys)}"></td>
      <td><input class="input dcb-run" placeholder="command on this host" value="${escHtml(buttons[k].run)}"></td></tr>`;
  return `<table style="width:100%;font-size:11px"><tr style="opacity:.7"><td></td><td>behaviour</td><td>keys → devices</td>
      <td title="Runs only when this host is ticked above. Told DOCA_BUTTON and DOCA_BUTTON_STATE (on/off).">command → this host ⓘ</td></tr>
      ${['A', 'B', 'C'].map(row).join('')}</table>
    <button class="btn btn-sm" onclick="devConsoleButtonsSave(this.closest('details'), ${jsArg(id)})">Save buttons</button>
    <span style="opacity:.7">Macros apply in keys mode; in joystick mode A/B/C are plain buttons.</span>`;
}

async function devConsoleButtonsSave(el, id) {
  const buttons = {};
  el.querySelectorAll('.dev-console-buttons tr[data-k]').forEach(tr => {
    buttons[tr.dataset.k] = { behaviour: tr.querySelector('.dcb-behaviour').value, keys: tr.querySelector('.dcb-keys').value, run: tr.querySelector('.dcb-run').value };
  });
  const status = document.getElementById(`dev-status-${id}`);
  try { await apiFetch(`/api/devices/${encodeURIComponent(id)}/console/buttons`, { method: 'PUT', body: { buttons } }); setStatus(status, '✓ Buttons saved', 'ok'); }
  catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-wearables' })));

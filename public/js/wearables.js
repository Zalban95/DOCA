/* ── Settings → Wearables, and a device as a console (modules/device-console.js): its live stream, and who receives it ── */

function devConsoleHtml(d) {
  if (!d.scopes?.includes('sensors:report')) return '<p class="input-label" style="text-transform:none;letter-spacing:0">No console: this device was not granted <code>sensors:report</code>.</p>';
  return `<details class="dev-console" open data-id="${escHtml(d.id)}" ontoggle="devConsoleToggle(this, ${jsArg(d.id)})">
      <summary class="input-label" style="cursor:pointer">Console — motion, heading, crown, A/B/C${infoBtn('The watch as a small remote: its tilt, heading, crown and buttons, live. While this is open the panel reads it once a second. Below: which devices receive it, and what each button does.')}</summary>
      <div class="dev-console-live" style="font-size:11px;margin:4px 0">…</div>
      <div class="dev-console-links" style="font-size:11px"></div>
      <div class="dev-console-buttons" style="font-size:11px;margin-top:6px"></div>
    </details>`;
}

/** Settings → Wearables: one card per paired wearable (DocaWear on a watch), its console inside. */
const DEV_WEARABLE = { watch: 'Watch', glasses: 'Glasses' };
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
      : emptyStateHtml({ title: 'No wearable paired', text: 'A watch running the watch app shows up here once paired, with its buttons and movement as a remote. Pair one from Field → API keys → Devices.', action: { label: 'Pair a watch', onclick: "nav('apikeys')" } });
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
    el.querySelector('.dev-console-links').innerHTML = `Send it to${infoBtn('Which of your devices hear this watch\'s presses and movement. Tick "this host" to have the hub itself run the buttons\' commands. Nothing ticked: the console goes nowhere. Saved as you tick.')}: ${others.map(x => box(x.id, c.links.includes(x.id), escHtml(x.name))).join('')}
        ${box('host', c.host, '<b>this host</b> (runs the commands)')}
      <br>As${infoBtn('Keys (the default): buttons A, B and C each send their macro below. Joystick: tilt and the crown become axes and the buttons are plain buttons, with no macros. Saved at once.')}: <select onchange="devConsoleLinks(this.closest('details'), ${jsArg(id)})" class="input dev-console-mode" style="width:auto">
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

/** A row per button: how it behaves, the word the watch shows on it, and its macro — keys for the devices, a command
 *  for this host. On the watch A–C are held (let go, they are off) and D–E latch; the behaviour says what the hub does. */
const DEV_CONSOLE_BEHAVIOURS = { button: 'button — a press', momentary: 'momentary — on while held', toggle: 'toggle — on, then off' };
function devConsoleButtonsHtml(id, buttons) {
  const row = k => `<tr data-k="${k}"><td><b>${k}</b></td>
      <td><select class="input dcb-behaviour" aria-label="${k} behaviour">${Object.entries(DEV_CONSOLE_BEHAVIOURS).map(([v, t]) =>
        `<option value="${v}" ${buttons[k].behaviour === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input class="input dcb-label" aria-label="${k} label" maxlength="12" placeholder="${k}" value="${escHtml(buttons[k].label || '')}"></td>
      <td><input class="input dcb-keys" aria-label="${k} keys" placeholder="keys, e.g. ctrl+s" value="${escHtml(buttons[k].keys)}"></td>
      <td><input class="input dcb-run" aria-label="${k} command" placeholder="command on this host" value="${escHtml(buttons[k].run)}"></td></tr>`;
  return advancedFold(`<div class="scroll-x"><table style="width:100%;font-size:11px"><tr style="opacity:.7"><td></td>
      <td>behaviour${infoBtn('Button: one press. Momentary: on while held, off when let go. Toggle: one press turns it on, the next off. On the watch A–C are held and D–E latch.')}</td>
      <td>label${infoBtn('A few letters (up to 12) the watch writes on the button. Empty: its letter.')}</td>
      <td>keys → devices${infoBtn('Keys the linked devices type at a press, e.g. ctrl+s. Only in keys mode.')}</td>
      <td>command → this host${infoBtn('A command this hub runs at a press — only when "this host" is ticked above, and only in keys mode. It is told DOCA_BUTTON and DOCA_BUTTON_STATE (on/off); a momentary button runs at the press (on) and when let go (off).')}</td></tr>
      ${Object.keys(buttons).map(row).join('')}</table></div>
    <button class="btn btn-sm" onclick="devConsoleButtonsSave(this.closest('details'), ${jsArg(id)})">Save buttons</button>`,
    { id: 'wear-buttons', label: 'Advanced — what each button does', count: Object.keys(buttons).length * 4 });
}

async function devConsoleButtonsSave(el, id) {
  const buttons = {};
  el.querySelectorAll('.dev-console-buttons tr[data-k]').forEach(tr => {
    buttons[tr.dataset.k] = { behaviour: tr.querySelector('.dcb-behaviour').value, label: tr.querySelector('.dcb-label').value, keys: tr.querySelector('.dcb-keys').value, run: tr.querySelector('.dcb-run').value };
  });
  const status = document.getElementById(`dev-status-${id}`);
  try { await apiFetch(`/api/devices/${encodeURIComponent(id)}/console/buttons`, { method: 'PUT', body: { buttons } }); setStatus(status, '✓ Buttons saved', 'ok'); }
  catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-wearables' })));

/* ═══════════════════════════════════════════════════════
   A device's own page (/d/<id>/; docs/design/devices-as-hands.md §5, TODO H2.4):
   the panel personalised for the device that opened it — what it lets DOCA's
   agents do, its connection, and its notifications. Its look (theme, tabs,
   sections) is saved as this device's own through lib/screen.js.
   ═══════════════════════════════════════════════════════ */

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
      ${devHandsHtml(d)}<div class="status-line" id="dev-status-${escHtml(d.id)}"></div>
      <div id="dev-this-notify" style="margin-top:12px"></div>
      <div id="dev-this-call" style="margin-top:12px"></div>
      ${/DocaMobile\//.test(navigator.userAgent) ? '<a class="btn" href="doca://settings" style="display:inline-block;margin-top:8px">App settings — connection and permissions</a>' : ''}`;
    devNotifyRender(); devCallRender();
  } catch { card.remove(); }
}

/** This device's notifications (its profile): whether it is asked, haptics, quiet hours. Saved on the device's profile. */
async function devNotifyRender() {
  const box = document.getElementById('dev-this-notify');
  if (!box) return;
  let p;
  try { ({ profile: p } = await apiFetch(`/api/screen/profile?device=${encodeURIComponent(DOCA_DEVICE_ID)}`)); } catch { box.remove(); return; }
  const q = p.quietHours || {};
  box.innerHTML = `<div class="card-subtitle">Notifications on this device</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:12px">
      <label><input type="checkbox" id="dn-receive" ${p.prompts?.receive !== false ? 'checked' : ''}> The agent may ask here</label>
      <label><input type="checkbox" id="dn-haptic" ${p.prompts?.haptic !== false ? 'checked' : ''}> Vibrate for urgent ones</label>
      <label>Quiet from <input class="input" style="width:auto;display:inline-block" type="time" id="dn-from" value="${escHtml(q.from || '')}"> to <input class="input" style="width:auto;display:inline-block" type="time" id="dn-to" value="${escHtml(q.to || '')}"></label>
      <label><input type="checkbox" id="dn-urgent" ${q.allowUrgent !== false ? 'checked' : ''}> urgent still comes through</label>
      <button class="btn btn-xs btn-blue" onclick="devNotifySave()">Save</button><span class="status-line" id="dn-status"></span></div>`;
}

async function devNotifySave() {
  const v = id => document.getElementById(id);
  const from = v('dn-from').value, to = v('dn-to').value;
  try {
    await apiFetch(`/api/screen/profile?device=${encodeURIComponent(DOCA_DEVICE_ID)}`, { method: 'POST', body: {
      prompts: { receive: v('dn-receive').checked, haptic: v('dn-haptic').checked },
      quietHours: from && to ? { from, to, allowUrgent: v('dn-urgent').checked } : null } });
    setStatus(v('dn-status'), '✓ Saved — the device is told', 'ok');
  } catch (e) { setStatus(v('dn-status'), `✗ ${e.message}`, 'err'); }
}
/**
 * How a call on this device hears a pause (call.silenceMs on this device's own layer; realtime/call-pause.js): how long a
 * pause sends what was said. A pause shorter than it never cuts — speech that resumes inside it goes on the same request.
 */
const DEV_CALL_DEFAULT_MS = 1400;
async function devCallRender() {
  const box = document.getElementById('dev-this-call');
  if (!box) return;
  let s;
  try { s = await apiFetch(`/api/screen?device=${encodeURIComponent(DOCA_DEVICE_ID)}`); } catch { box.remove(); return; }
  const c = s.settings?.call || {}, from = s.from?.call;
  const ms = c.silenceMs >= 300 ? c.silenceMs : DEV_CALL_DEFAULT_MS;
  const whose = !c.silenceMs ? `the default for a device's call, ${DEV_CALL_DEFAULT_MS / 1000} s` : from === 'device' ? 'set for this device' : from === 'person' ? 'from your own settings' : 'from the hive\'s settings';
  box.innerHTML = `<div class="card-subtitle">Calls on this device</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:12px">
      <label>Pause before sending <input class="input" style="width:80px;display:inline-block" type="number" min="0.3" max="10" step="0.1" id="dc-silence" value="${ms / 1000}"> s</label>
      <span class="desc" style="color:var(--muted)">${escHtml(whose)}. A pause shorter than this never cuts: carry on and it is the same request.</span>
      <button class="btn btn-xs btn-blue" onclick="devCallSave()">Save</button>
      ${from === 'device' && c.silenceMs ? '<button class="btn btn-xs" onclick="devCallSave(true)">Use the default</button>' : ''}<span class="status-line" id="dc-status"></span></div>`;
}

async function devCallSave(reset = false) {
  const st = document.getElementById('dc-status');
  try {
    const s = await apiFetch(`/api/screen?device=${encodeURIComponent(DOCA_DEVICE_ID)}`);
    const { silenceMs, ...rest } = s.settings?.call || {};
    const secs = parseFloat(document.getElementById('dc-silence').value);
    if (!reset && !(secs >= 0.3 && secs <= 10)) throw new Error('A pause from 0.3 to 10 seconds.');
    const call = reset ? (Object.keys(rest).length ? rest : null) : { ...rest, silenceMs: Math.round(secs * 1000) };
    await apiFetch(`/api/screen/settings?device=${encodeURIComponent(DOCA_DEVICE_ID)}`, { method: 'POST', body: { call } });
    setStatus(st, '✓ Saved — the next call uses it', 'ok');
    devCallRender();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

if (typeof document !== 'undefined' && DOCA_DEVICE_ID) document.addEventListener('DOMContentLoaded', () => setTimeout(devThisDevice, 500));

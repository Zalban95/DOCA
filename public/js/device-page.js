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
      ${/DocaMobile\//.test(navigator.userAgent) ? '<a class="btn" href="doca://settings" style="display:inline-block;margin-top:8px">App settings — connection and permissions</a>' : ''}`;
    devNotifyRender();
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
if (typeof document !== 'undefined' && DOCA_DEVICE_ID) document.addEventListener('DOMContentLoaded', () => setTimeout(devThisDevice, 500));

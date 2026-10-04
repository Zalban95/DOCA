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
      ${/DocaMobile\//.test(navigator.userAgent) ? '<a class="btn" href="doca://settings" style="display:inline-block;margin-top:8px">App settings — connection and permissions</a>' : ''}`;
  } catch { card.remove(); }
}
if (typeof document !== 'undefined' && DOCA_DEVICE_ID) document.addEventListener('DOMContentLoaded', () => setTimeout(devThisDevice, 500));

/* ═══════════════════════════════════════════════════════
   "This page is being looked at": a heartbeat while the panel is visible, and
   one more when it is hidden (modules/presence.js). It tells the agent whether
   the chat reaches the owner or a device has to.
   ═══════════════════════════════════════════════════════ */

let _presenceTimer = null;

function _presenceSend(visible) {
  // keepalive, so the "hidden" beat survives the tab being closed.
  fetch('/api/presence', { method: 'POST', keepalive: true, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    // tz: this screen's own zone, so a reminder's "at 6" and a schedule's "09:00" are the person's clock (timezones.js).
    body: JSON.stringify({ visible, page: typeof currentTab !== 'undefined' ? currentTab : null, solo: typeof SOLO_PAGE !== 'undefined' && !!SOLO_PAGE,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) }).catch(() => {});
}

/** Say now which page this screen shows (a page was opened): the Devices list reads it (screens/showing.js). */
function presenceNow() { if (document.visibilityState === 'visible') _presenceSend(true); }

function presenceStart() {
  const tick = () => { if (document.visibilityState === 'visible') _presenceSend(true); };
  document.addEventListener('visibilitychange', () => _presenceSend(document.visibilityState === 'visible'));
  clearInterval(_presenceTimer);
  _presenceTimer = setInterval(tick, 30000);
  tick();
}

// Only in the real panel: the front-end tests evaluate this file against a DOM stub.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && document.getElementById('chat-fab')) presenceStart();

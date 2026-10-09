/* ═══════════════════════════════════════════════════════
   The phone app's own settings, findable (asked 2026-10-09: "I can't find where I can log in to other hives
   or download updates of DocaWear and DocaMobile"). DocaMobile opens its native settings — hives, security,
   updates, what the phone lends — from `doca://settings`, which used to be linked only from the device's own
   page, the launcher's long-press and the ongoing notification. Inside the app (its user agent says
   DocaMobile/), the panel shows it at the top of the sidebar (☰) and of Settings → General. Elsewhere: nothing.
   ═══════════════════════════════════════════════════════ */

const IN_PHONE_APP = typeof navigator !== 'undefined' && /DocaMobile\//.test(navigator.userAgent || '');

function _appSettingsHtml(where) {
  return `<a class="btn" href="doca://settings" style="display:block;text-align:center${where === 'card' ? ';margin-top:8px' : ''}">`
    + '📱 App settings — hives, updates, security</a>';
}

function appSettingsLinkMount() {
  if (!IN_PHONE_APP) return;
  const side = document.querySelector('aside.sidebar');
  if (side && !document.getElementById('app-settings-side')) {
    const s = document.createElement('div');
    s.className = 'sidebar-section'; s.id = 'app-settings-side';
    s.innerHTML = `<div class="sec-label">This phone</div>${_appSettingsHtml('side')}`;
    side.prepend(s);
  }
  const general = document.getElementById('sp-general');
  if (general && !document.getElementById('app-settings-card')) {
    const c = document.createElement('div');
    c.className = 'card'; c.id = 'app-settings-card';
    c.innerHTML = '<div class="card-title">This phone\'s app</div><p class="desc">Add or switch hives, the app lock, '
      + 'updates for the phone and the watch, and what this phone lends — in the app\'s own settings.</p>' + _appSettingsHtml('card');
    general.prepend(c);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appSettingsLinkMount);
  else appSettingsLinkMount();
}

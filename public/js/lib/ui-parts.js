/* ═══════════════════════════════════════════════════════
   The shared parts of one style system (wave E, TODO E2; docs/audits/2026-10-06-design.md des 5, 9, 10, 18):
     rowActs([...])      one row-action component — the same icons in the same order on every container, service and
                         computer row; what removes or deletes lives behind ⋯, neutral at rest, red only in its
                         confirmation (appConfirm)
     emptyStateHtml({})  one empty state: a point of light, a sentence, one action
     pageHeadHtml({})    one page header: a title and one line on the left, the page's actions on the right
   Each returns markup built from the caller's own labels (escaped here) and onclick strings the caller wrote,
   attribute-ready as jsArg() makes them (they are not escaped a second time).
   Styles: css/system.css.
   ═══════════════════════════════════════════════════════ */

const _uiEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Icon buttons for a row: [{icon, label, onclick, more, disabled, why}]. `more` puts an action in the ⋯ menu (Remove,
 * Delete — anything that cannot be taken back); `why` is the reason a disabled action is shown disabled.
 */
function rowActs(actions) {
  const shown = actions.filter(a => a && !a.more), more = actions.filter(a => a && a.more);
  const btn = a => `<button type="button" class="icon-btn" aria-label="${_uiEsc(a.label)}" title="${_uiEsc(a.disabled && a.why ? `${a.label} — ${a.why}` : a.label)}"${a.disabled ? ' disabled' : ''} onclick="${a.onclick}">${uiIcon(a.icon)}</button>`;
  const menu = more.length ? `<span class="row-more"><button type="button" class="icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded="false" title="More" onclick="rowMoreToggle(this)">${uiIcon('more')}</button>
    <span class="row-more-menu" role="menu" hidden>${more.map(a => `<button type="button" role="menuitem" class="row-more-item"${a.disabled ? ' disabled' : ''} onclick="rowMoreClose(); ${a.onclick}">${a.icon ? uiIcon(a.icon, 14) : ''}<span>${_uiEsc(a.label)}</span></button>`).join('')}</span></span>` : '';
  return `<div class="row-acts">${shown.map(btn).join('')}${menu}</div>`;
}

/** Open or close a row's ⋯ menu (one open at a time; Escape or a click elsewhere closes it). */
function rowMoreToggle(btn) {
  const menu = btn.nextElementSibling;
  const open = menu.hidden;
  rowMoreClose();
  if (!open) return;
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // Opened upwards when the row sits low on the screen, so the menu is never cut by the page's edge.
  const r = btn.getBoundingClientRect();
  menu.classList.toggle('up', r.bottom + menu.offsetHeight + 12 > window.innerHeight);
  menu.querySelector('button:not([disabled])')?.focus();
}

function rowMoreClose() {
  document.querySelectorAll('.row-more-menu:not([hidden])').forEach(m => {
    m.hidden = true;
    m.previousElementSibling?.setAttribute('aria-expanded', 'false');
  });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', e => { if (!e.target.closest?.('.row-more')) rowMoreClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') rowMoreClose(); });
}

/** One empty state: {title, text, action: {label, onclick}}. */
function emptyStateHtml({ title, text = '', action = null }) {
  return `<div class="empty-state"><span class="empty-glyph" aria-hidden="true"></span>
    <div class="empty-title">${_uiEsc(title)}</div>${text ? `<p class="empty-text">${_uiEsc(text)}</p>` : ''}
    ${action ? `<button type="button" class="btn btn-primary" onclick="${action.onclick}">${_uiEsc(action.label)}</button>` : ''}</div>`;
}

/** One page header: {title, sub, actions (markup the caller built)}. */
function pageHeadHtml({ title, sub = '', actions = '' }) {
  return `<div class="page-head"><div class="page-head-text"><h1 class="page-title">${_uiEsc(title)}</h1>${sub ? `<p class="page-sub">${_uiEsc(sub)}</p>` : ''}</div>
    ${actions ? `<div class="page-head-acts">${actions}</div>` : ''}</div>`;
}

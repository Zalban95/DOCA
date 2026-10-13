/* Open a setting where it is edited and mark it (moved from global-search.js as it was): the header search, the
   question when a switch is off (lib/switch-ask.js) and the agent's links all land here. */


/**
 * Open a setting where it is edited and mark it: its page (or Settings section), a panel action first when the form is
 * closed (the ⚙ on Controls), then the field or card — every Advanced fold around it opened, scrolled into view and
 * outlined for a moment. Pages draw themselves after nav(), so the element is waited for, briefly.
 */
async function settingJump(r) {
  const [top, sub] = String(r.page || '').split('/');
  if (top === 'settings' && sub) { if (typeof _settingsActiveSubtab !== 'undefined') _settingsActiveSubtab = sub; nav('settings'); settingsSubNav(sub); }
  else if (top) nav(top);
  if (r.open === 'harnessParams' && typeof settingsOpenHarnessParams === 'function') { try { await settingsOpenHarnessParams(); } catch { /* the page still opened */ } }
  // On the page in view: drawn, or folded inside an Advanced fold that is itself drawn (its summary shows).
  const shown = el => {
    if (!el) return false;
    if (el.getClientRects().length) return true;
    let outer = null;
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) outer = d;
    return !!outer && outer.getClientRects().length > 0;
  };
  const byCard = () => r.card && [...document.querySelectorAll('.card-title')]
    .find(t => t.textContent.trim().toLowerCase().startsWith(r.card.toLowerCase()) && shown(t))?.closest('.card');
  // The field first: a card draws at once while its Advanced fields come from a request of their own, so taking the card
  // as soon as it showed marked the card and never the field on a slow machine (Windows CI, 2026-10-13). The card is
  // the answer only once the field has had its time, or when there is no field to wait for.
  let el = null;
  // With no card to fall back on, the field alone is waited for longer: a slow page's Advanced fields (the MCP page's
  // on Windows CI) came after six seconds, and nothing was marked at all.
  for (let i = 0, most = r.card ? 60 : 150; i < most && !el; i++) {
    let f = null; try { f = r.field ? document.querySelector(r.field) : null; } catch { /* not a selector */ }
    el = (shown(f) && f) || ((!r.field || i >= 40) && byCard()) || null;
    if (!el) await new Promise(res => setTimeout(res, 100));
  }
  window._settingJumpLast = { field: r.field || null, card: r.card || null, found: !!el, isField: false, at: Date.now() };   // what the last jump did: for a test's failure message
  if (!el) return;
  try { window._settingJumpLast.isField = !!(r.field && el.matches(r.field)); } catch { /* not a selector */ }
  _settingMark(el);
  // A page that draws its fields again just after (the MCP page reloads its list) replaces the marked one, and a field
  // that came after the card was marked in its place: for a few seconds, the field is found again and marked — or the mark lands on a node nobody sees (Windows CI, 2026-10-13).
  // Watched up to 12 s while it is not the field yet (a slow page's Advanced fields), 3 s once it is.
  for (let i = 0, settled = 0; r.field && i < 60 && settled < 15; i++) {
    await new Promise(res => setTimeout(res, 200));
    let isField = false; try { isField = el.matches(r.field); } catch { /* not a selector */ }
    if (el.isConnected && isField) { settled++; continue; }   // still there, and the field itself — not the card it fell back to
    settled = 0;
    let f = null; try { f = document.querySelector(r.field); } catch { /* not a selector */ }
    if (f && shown(f)) { el = f; _settingMark(el); }
  }
}

/** Open the folds around a setting, bring it into view and outline it for a moment. */
function _settingMark(el) {
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('setting-found');
  void el.offsetWidth;   // restart the mark when the same setting is opened twice
  el.classList.add('setting-found');
  setTimeout(() => el.classList.remove('setting-found'), 2600);
}

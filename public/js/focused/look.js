/* Light, dark or as the device is: the Focused view's ground, from the Points palettes (look-points.js). Light and
   Dark are this screen's theme (`theme`: pointsDaylight or points — the same setting Extended's Appearance writes, so
   both views agree); Auto follows the device's own light or dark (prefers-color-scheme) and is kept in this browser,
   since it is how this device looks rather than a colour. The points take the new ground (fcDotsRedraw). */
const _fcDark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function fcGroundChoice() {
  try { if (localStorage.getItem('doca.focused.ground') === 'auto') return 'auto'; } catch { /* not kept */ }
  return document.documentElement.dataset.ground === 'light' ? 'light' : 'dark';
}

let _fcLookLent = false;   // Points' palette lent to a screen whose theme was never chosen, while Focused shows

/** At open, and when the device turns light or dark: Auto's ground — and Points' palette for a screen that never chose
 *  one (the view is drawn in Points' tokens), given back to the default when Extended shows again (fcLookGiveBack). */
function fcLookApply() {
  if (typeof applyTheme !== 'function') return;
  const theme = typeof _screen !== 'undefined' ? _screen?.settings?.theme : null;
  if (fcGroundChoice() !== 'auto' && theme && theme !== 'default') return;
  if (fcGroundChoice() !== 'auto') _fcLookLent = true;
  const want = _fcDark?.matches === false ? 'pointsDaylight' : 'points';
  if (typeof _currentTheme !== 'undefined' && _currentTheme === want) return;
  applyTheme(want);
  if (typeof fcDotsRedraw === 'function') fcDotsRedraw();
}
_fcDark?.addEventListener?.('change', () => { if (typeof focusedOn === 'function' && focusedOn()) fcLookApply(); });

/** Light, Dark or Auto, from the settings sheet. */
async function fcGroundSet(choice) {
  try { localStorage.setItem('doca.focused.ground', choice === 'auto' ? 'auto' : ''); } catch { /* this page only */ }
  if (choice === 'auto') fcLookApply();
  else {
    _fcLookLent = false;
    const theme = choice === 'light' ? 'pointsDaylight' : 'points';
    if (typeof applyTheme === 'function') applyTheme(theme);
    try { await screenSave({ theme }); } catch (e) { appAlert(`Not kept: ${e.message}`); }
    if (typeof fcDotsRedraw === 'function') fcDotsRedraw();
  }
  document.querySelectorAll('[data-ground-pick]').forEach(b => { const on = b.dataset.groundPick === choice; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
}

/** Leaving Focused: a palette it lent goes back to the screen's own. */
function fcLookGiveBack() {
  if (!_fcLookLent) return;
  _fcLookLent = false;
  if (typeof themeApplyOnLoad === 'function') themeApplyOnLoad();
}

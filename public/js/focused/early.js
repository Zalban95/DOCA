/* Focused or Extended, before the page is drawn (focused/boot.js decides for real once the hub answers): the mode this
   browser showed last, so a screen in Focused does not flash the whole panel first. `?view=focused` asks for it here. */
(function focusedEarly() {
  let m = null;
  try { m = new URLSearchParams(location.search).get('view') === 'focused' ? 'focused' : localStorage.getItem('doca.panelMode'); } catch { /* a private window */ }
  if (m === 'focused' || m === 'extended') document.documentElement.dataset.mode = m;
})();

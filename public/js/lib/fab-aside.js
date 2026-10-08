/* ═══════════════════════════════════════════════════════
   The chat button steps aside from a control it would cover (self-test 2026-10-08: it sat on Save in Spending and
   Channels, on fields in Settings → Harness and Ambient). The 72 px at a page's end (css/system.css) lets the last
   controls scroll clear of it; this covers the rest — whatever a page has under the button where it is scrolled
   now. Then it slides to the edge of the screen, a sliver still showing, and comes back when hovered or focused, or
   when nothing is under it. Read after a scroll, a resize, or a change in what the page holds — never on a timer.
   ═══════════════════════════════════════════════════════ */

const FAB_CONTROL = 'button, input, textarea, select, a[href], [onclick], [contenteditable="true"]';

function fabAsideCheck() {
  const fab = document.getElementById('chat-fab');
  if (!fab || fab.classList.contains('active') || getComputedStyle(fab).display === 'none') return document.body.classList.remove('fab-aside');
  // Where it sits at home, not where it slid to: offsets ignore the transform that moves it aside.
  const r = { left: fab.offsetLeft, top: fab.offsetTop, right: fab.offsetLeft + fab.offsetWidth, bottom: fab.offsetTop + fab.offsetHeight, width: fab.offsetWidth, height: fab.offsetHeight }, pad = 4;
  // The button is round: its middle, the four edges' middles and four points just inside its rim.
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, k = r.width / 2 - pad, d = k * 0.7;
  const points = [[cx, cy], [cx - k, cy], [cx + k, cy], [cx, cy - k], [cx, cy + k], [cx - d, cy - d], [cx + d, cy - d], [cx - d, cy + d], [cx + d, cy + d]];
  const under = points.some(([x, y]) => document.elementsFromPoint(x, y).some(el =>
    el !== fab && !fab.contains(el) && !el.closest('.face-corner, .chat-panel') && el.closest(FAB_CONTROL)));
  document.body.classList.toggle('fab-aside', under);
}

let _fabAsideQueued = false;
function fabAsideSoon() {
  if (_fabAsideQueued) return;
  _fabAsideQueued = true;
  requestAnimationFrame(() => { _fabAsideQueued = false; fabAsideCheck(); });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('scroll', fabAsideSoon, { capture: true, passive: true });   // any scrolling box on the page
  window.addEventListener('resize', fabAsideSoon);
  // A page or section drawn, a form opened: what the page holds changed. Settled first (a page draws in pieces).
  let settle = null;
  const changed = () => { clearTimeout(settle); settle = setTimeout(fabAsideSoon, 250); };
  window.addEventListener('load', () => {
    const main = document.querySelector('main.content');
    if (main && typeof MutationObserver === 'function') new MutationObserver(changed).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open'] });
    setTimeout(fabAsideSoon, 1500);
  });
}

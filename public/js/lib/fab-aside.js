/* ═══════════════════════════════════════════════════════
   The chat button (and the Live call's circle beside it) steps aside from a control it would cover (self-test 2026-10-08: it sat on Save in Spending and
   Channels, on fields in Settings → Harness and Ambient). The 72 px at a page's end (css/system.css) lets the last
   controls scroll clear of it; this covers the rest — whatever a page has under the button where it is scrolled
   now. Then it slides to the edge of the screen, a sliver still showing, and comes back when hovered or focused, or
   when nothing is under it. Read after a scroll, a resize, or a change in what the page holds — never on a timer.
   ═══════════════════════════════════════════════════════ */

const FAB_CONTROL = 'button, input, textarea, select, a[href], [onclick], [contenteditable="true"]';

/** Whether a page control lies under this round button where it sits at home. */
function fabAsideUnder(btn) {
  // Where it sits at home, not where it slid to: offsets ignore the transform that moves it aside.
  const r = { left: btn.offsetLeft, top: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight }, pad = 4;
  // The button is round: its middle, the four edges' middles and four points just inside its rim.
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, k = r.width / 2 - pad, d = k * 0.7;
  const points = [[cx, cy], [cx - k, cy], [cx + k, cy], [cx, cy - k], [cx, cy + k], [cx - d, cy - d], [cx + d, cy - d], [cx - d, cy + d], [cx + d, cy + d]];
  return points.some(([x, y]) => document.elementsFromPoint(x, y).some(el =>
    el !== btn && !btn.contains(el) && !el.closest('.face-corner, .chat-fab, .chat-panel') && el.closest(FAB_CONTROL)));
}

function fabAsideCheck() {
  const fab = document.getElementById('chat-fab');
  const fabUp = fab && !fab.classList.contains('active') && getComputedStyle(fab).display !== 'none';
  document.body.classList.toggle('fab-aside', !!fabUp && fabAsideUnder(fab));
  // The Live call's circle (face/corner.js) does the same wherever this screen placed it.
  const face = document.getElementById('face-corner');
  document.body.classList.toggle('face-aside', !!face && getComputedStyle(face).display !== 'none' && fabAsideUnder(face));
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

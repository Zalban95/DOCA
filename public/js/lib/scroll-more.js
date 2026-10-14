/* ═══════════════════════════════════════════════════════
   A row that scrolls sideways says so. Settings' pills and the open group's pages scroll with no scrollbar drawn, so on
   a phone the pills past the right edge (Backups, System, Harnesses at 390 px) looked like they were not there (run 1,
   2026-10-14). Each such row gets data-scroll-more — "right", "left" or "both" — while there is more that way, and
   css/system.css fades that edge. Read after a scroll, a resize, or a change in what the row holds — never on a timer.
   ═══════════════════════════════════════════════════════ */

const SCROLL_MORE_ROWS = '.settings-subnav, .nav-pages';

/** Which way a row has more than it shows: '' when it all fits. */
function scrollMoreOf(el) {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 1) return '';
  const left = el.scrollLeft > 1, right = el.scrollLeft < max - 1;
  return left && right ? 'both' : left ? 'left' : right ? 'right' : '';
}

function scrollMoreMark(el) {
  const more = scrollMoreOf(el);
  if (more) el.dataset.scrollMore = more; else delete el.dataset.scrollMore;
}

function scrollMoreAll() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(SCROLL_MORE_ROWS).forEach(scrollMoreMark);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('scroll', e => { if (e.target?.matches?.(SCROLL_MORE_ROWS)) scrollMoreMark(e.target); }, { capture: true, passive: true });
  window.addEventListener('resize', scrollMoreAll);
  window.addEventListener('load', () => {
    // A row shown, hidden or filled with pills (Settings draws its own; the second row comes and goes): marked again.
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(es => es.forEach(e => scrollMoreMark(e.target))) : null;
    const seen = new WeakSet();
    const observe = () => document.querySelectorAll(SCROLL_MORE_ROWS).forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      watch?.observe(el);
      if (typeof MutationObserver === 'function') new MutationObserver(() => scrollMoreMark(el)).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    observe();
    // The second Settings row is made later (settings/subnav.js): find rows that appear.
    if (typeof MutationObserver === 'function') new MutationObserver(() => { observe(); }).observe(document.getElementById('settings-subnav')?.parentElement || document.body, { childList: true });
    scrollMoreAll();
  });
}

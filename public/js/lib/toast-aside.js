/* A toast never covers an open dialog's controls (found by a newcomer, 2026-10-14: the page-reload notice sat over the
   folder picker's Select, and the question it waited on could not be answered). The toasts stay above every dialog —
   an Undo for something removed inside one must be reachable — but while a dialog's box would be under them, they step
   to the top of the screen; when the box fills that too (a phone's full-height sheet), they go under the dialog's
   shade until it closes. Read again whenever the page changes (coalesced to a frame) and on resize; the toasts' own
   class changes are not a change. */

const TOAST_DIALOGS = '.modal-overlay, .app-confirm-backdrop, .fp-overlay, .select-sheet, .ww-pick, [aria-modal="true"]';

/** The boxes of the dialogs open now: what a full-screen shade holds, or the dialog itself when it is not a shade. */
function _toastDialogBoxes(host) {
  const out = [];
  for (const el of document.querySelectorAll(TOAST_DIALOGS)) {
    if (host.contains(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const shade = r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.95;
    const kids = shade ? [...el.children].map(c => c.getBoundingClientRect()).filter(k => k.width && k.height) : [r];
    out.push(...kids);
  }
  return out;
}

const _toastHits = (host, boxes) => {
  const r = host.getBoundingClientRect();
  return boxes.some(b => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom);
};

function toastAsideCheck() {
  const host = document.getElementById('undo-toasts');
  if (!host) return;
  const set = (top, under) => { host.classList.toggle('aside-top', top); host.classList.toggle('under', under); };
  const boxes = host.children.length ? _toastDialogBoxes(host) : [];
  if (!boxes.length) return set(false, false);
  set(false, false);
  if (!_toastHits(host, boxes)) return;
  set(true, false);
  if (_toastHits(host, boxes)) set(false, true);
}

(function toastAsideStart() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  let queued = false;
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; toastAsideCheck(); }); };
  const start = () => {
    new MutationObserver(records => {
      const host = document.getElementById('undo-toasts');
      if (!host?.children.length) { if (host?.className !== 'undo-toasts' && host) soon(); return; }
      if (records.some(r => !(r.type === 'attributes' && host.contains(r.target)))) soon();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'open'] });
    addEventListener('resize', soon);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();

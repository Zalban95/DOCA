/* ═══════════════════════════════════════════════════════
   ⓘ beside a field: what it is, in a sentence, when asked (the owner, 2026-10-11: "an info button on every field so
   everything that is not necessary can go on the advanced section"). A field keeps only its name on the page; its
   explanation opens under it on a tap, one at a time, and Escape or a tap elsewhere closes it.

   Three ways a page gives a field its explanation, all upgraded here, wherever and whenever the markup appears:
     infoBtn(text)            markup for the button, for pages that build their fields in script
     data-info="…"            on a label (or any element): the button is added after its text
     <… class="field-help">   the explanation as its own element under the field (the older pages' hint line): it is
                              hidden, and the nearest label before it in the same field gets the button
   ═══════════════════════════════════════════════════════ */

function infoBtn(text) {
  return text ? `<button type="button" class="info-btn" aria-label="What this is" aria-expanded="false" data-info-text="${_uiEsc(text)}">${uiIcon('info', 14)}</button>` : '';
}

function _infoClose(except) {
  document.querySelectorAll('.info-pop').forEach(p => { if (p !== except) { p.previousInfoBtn?.setAttribute('aria-expanded', 'false'); p.remove(); } });
}

function _infoToggle(btn) {
  const open = btn._pop && btn._pop.isConnected;
  _infoClose();
  if (open) return;
  const pop = document.createElement('div');
  pop.className = 'info-pop';
  pop.setAttribute('role', 'note');
  pop.textContent = btn.dataset.infoText || '';
  pop.previousInfoBtn = btn;
  // Under the label's line: after the label element when the button sits in one, else right after the button.
  const anchor = btn.closest('.input-label, label, .field-label, .models-settings-label, .card-title, summary') || btn;
  // A label that is a cell of a grid (label | field): the explanation goes at the top of its field's cell instead.
  const grid = anchor.parentElement && getComputedStyle(anchor.parentElement).display === 'grid' && anchor.nextElementSibling;
  if (grid) anchor.nextElementSibling.prepend(pop); else anchor.insertAdjacentElement('afterend', pop);
  btn._pop = pop;
  btn.setAttribute('aria-expanded', 'true');
}

// Only in a page (a test that loads the shared scripts into a stub document has none of these).
const _infoLive = typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof MutationObserver === 'function';
if (_infoLive) document.addEventListener('click', e => {
  const btn = e.target.closest?.('.info-btn');
  if (btn) { e.preventDefault(); e.stopPropagation(); _infoToggle(btn); return; }
  if (!e.target.closest?.('.info-pop')) _infoClose();
}, true);
if (_infoLive) document.addEventListener('keydown', e => { if (e.key === 'Escape') _infoClose(); });

/** Upgrade what a page drew: data-info labels and field-help lines. Safe to run again on the same markup. */
function fieldInfoUpgrade(root = document) {
  root.querySelectorAll?.('[data-info]:not([data-info-done])').forEach(el => {
    el.dataset.infoDone = '1';
    el.insertAdjacentHTML('beforeend', ' ' + infoBtn(el.dataset.info));
  });
  root.querySelectorAll?.('.field-help:not([data-info-done])').forEach(help => {
    help.dataset.infoDone = '1';
    const box = help.closest('.field, .form-row, .setting-row, .row, .card') || help.parentElement;
    const labels = [...(box?.querySelectorAll('.input-label, label, .field-label') || [])].filter(l => l !== help && !help.contains(l)
      && (l.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING));
    const label = labels.pop();
    const text = help.textContent.replace(/\s+/g, ' ').trim();
    if (!label || !text) return;   // nothing to hang it on: the line stays as it was
    label.insertAdjacentHTML('beforeend', ' ' + infoBtn(text));
    help.hidden = true;
  });
  // Each button named after what it explains: forty buttons all called "What this is" told a screen reader, or a
  // newcomer hovering one, nothing about which (newcomer run 2026-10-14, b3).
  root.querySelectorAll?.('.info-btn:not([data-named])').forEach(btn => {
    btn.dataset.named = '1';
    const anchor = btn.closest('.input-label, label, .field-label, .models-settings-label, .card-title, summary');
    const name = anchor ? [...anchor.childNodes].filter(n => !['BUTTON', 'SELECT', 'TEXTAREA', 'DETAILS'].includes(n.tagName))
      .map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    if (name) { btn.setAttribute('aria-label', `What “${name}” is`); btn.title = `What “${name}” is`; }
  });
}

(function fieldInfoWatch() {
  if (!_infoLive) return;
  let queued = false;
  const run = () => { queued = false; fieldInfoUpgrade(document); };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  const start = () => { run(); mo.observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

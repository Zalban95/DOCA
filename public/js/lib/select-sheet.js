/* A list on a phone that follows the panel (asked 2026-10-06: "when we open the list the layout in the app doesn't
   follow"): on a narrow or touch screen, a tap on a select box opens its choices as a sheet drawn by the panel — the
   theme's colours and fonts, full width, long labels wrapped, the chosen one marked — instead of the WebView's own
   picker. The select box stays the source of truth: choosing sets its value and fires `change`, so every page works
   unchanged. A desk with a mouse keeps the native list. */
const SELECT_SHEET_MQ = '(max-width: 768px), (pointer: coarse)';

function selectSheetOpen(sel) {
  document.getElementById('select-sheet')?.remove();
  const back = Object.assign(document.createElement('div'), { id: 'select-sheet', className: 'select-sheet' });
  const label = sel.labels?.[0]?.textContent || sel.closest('.field, label')?.querySelector('.input-label, label')?.textContent || sel.getAttribute('aria-label') || '';
  back.innerHTML = `<div class="select-sheet-box" role="listbox">${label ? `<div class="select-sheet-title">${escHtml(label.trim())}</div>` : ''}</div>`;
  const box = back.firstElementChild;
  for (const el of sel.children) {
    const opts = el.tagName === 'OPTGROUP' ? [...el.children] : [el];
    if (el.tagName === 'OPTGROUP') box.append(Object.assign(document.createElement('div'), { className: 'select-sheet-group', textContent: el.label }));
    for (const o of opts) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `select-sheet-item${o.value === sel.value ? ' active' : ''}`, textContent: o.textContent, disabled: o.disabled });
      b.onclick = () => { release(); back.remove(); if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); } };
      box.append(b);
    }
  }
  const release = typeof overlayBack === 'function' ? overlayBack(() => back.remove()) : () => {};
  back.onclick = e => { if (e.target === back) { release(); back.remove(); } };
  document.body.append(back);
  box.querySelector('.active')?.scrollIntoView({ block: 'center' });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  // A finger opens the WebView's picker at the end of the touch, a mouse at mousedown: both are taken here.
  const take = e => {
    const sel = e.target.closest?.('select');
    if (!sel || sel.multiple || sel.disabled || sel.size > 1 || !window.matchMedia(SELECT_SHEET_MQ).matches) return;
    e.preventDefault();
    if (e.type === 'touchend' || !sel._sheetTouched) selectSheetOpen(sel);
    sel._sheetTouched = e.type === 'touchend' ? Date.now() : 0;
  };
  document.addEventListener('touchend', take, { capture: true, passive: false });
  document.addEventListener('mousedown', e => { const sel = e.target.closest?.('select'); if (sel && Date.now() - (sel._sheetTouched || 0) < 800) { e.preventDefault(); return; } take(e); }, true);
}

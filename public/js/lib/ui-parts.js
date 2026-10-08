/* ═══════════════════════════════════════════════════════
   The shared parts of one style system (wave E, TODO E2; docs/audits/2026-10-06-design.md des 5, 9, 10, 18):
     rowActs([...])      one row-action component — the same icons in the same order on every container, service and
                         computer row; what removes or deletes lives behind ⋯, neutral at rest, red only in its
                         confirmation (appConfirm)
     emptyStateHtml({})  one empty state: a point of light, a sentence, one action
     pageHeadHtml({})    one page header: a title and one line on the left, the page's actions on the right
     advancedFold(x, {}) one disclosure for the fields most people never touch: "Advanced · N", closed until opened,
                         remembered per browser, marked when anything inside differs from its default
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

/* ── Organized: the common few, the rest under Advanced (asked 2026-10-08) ──
   advancedFold(content, {label, id, count, changed})
     content  an HTML string → returns markup; an element, or a list of them → returns the <details>, put where the first
              one was and holding them all (how a form written in index.html is folded without growing it)
     label    what the summary says ("Advanced" by default); count is how many fields it holds (counted when not given)
     id       what its open or closed state is remembered by, in this browser (localStorage doca.fold.<id>)
     changed  how many inside differ from their defaults, when the caller knows better than the fields do
   A field that knows its default carries data-default (a checkbox "true" or "false"; a list one item per line); the
   summary then shows a point and "changed" whenever one differs, so a changed advanced setting is never hidden
   silently. The marks are read again on every input and change inside, when a fold is added to the page, and on
   advancedFoldRefresh() after a page fills its fields itself. A value the agent drafts into a closed fold (form_fill)
   opens it, so the draft is seen. */
const _FOLD_KEY = id => `doca.fold.${id}`;

function _foldRemembered(id) {
  if (!id) return false;
  try { return localStorage.getItem(_FOLD_KEY(id)) === '1'; } catch { return false; }
}

function _foldSummary(label, count, changed) {
  return `<summary class="adv-fold-sum"><span class="adv-fold-label">${_uiEsc(label)}</span>${count ? `<span class="adv-fold-count" title="${count} setting${count === 1 ? '' : 's'} inside">${count}</span>` : '<span class="adv-fold-count" hidden></span>'}`
    + `<span class="adv-fold-changed"${changed ? '' : ' hidden'}>changed</span></summary>`;
}

function advancedFold(content, { label = 'Advanced', id = '', count = null, changed = 0 } = {}) {
  const open = _foldRemembered(id);
  const attrs = `class="adv-fold"${id ? ` data-fold-id="${_uiEsc(id)}"` : ''}${changed ? ` data-changed="${Number(changed)}"` : ''}${open ? ' open' : ''}`;
  if (typeof content === 'string') {
    const n = count ?? (content.match(/<(input|select|textarea)\b(?![^>]*type="(hidden|button|submit|radio)")/g) || []).length;
    return `<details ${attrs}>${_foldSummary(label, n, changed)}<div class="adv-fold-body">${content}</div></details>`;
  }
  const els = (content instanceof Element ? [content] : [...content]).filter(Boolean);
  const box = document.createElement('div');
  box.innerHTML = `<details ${attrs}>${_foldSummary(label, 0, changed)}<div class="adv-fold-body"></div></details>`;
  const det = box.firstElementChild;
  if (els[0]?.parentNode) els[0].before(det);
  det.lastElementChild.append(...els);
  if (count != null) det.dataset.count = String(count);
  advancedFoldMark(det);
  return det;
}

/** Does a field hold something other than its data-default? */
function _foldDiffers(el) {
  const d = el.dataset.default;
  if (d === undefined) return false;
  if (el.type === 'checkbox') return String(el.checked) !== d;
  if (el.type === 'radio') return el.checked && el.value !== d;   // a group: only the chosen one speaks
  const norm = v => String(v ?? '').split('\n').map(s => s.trim()).filter(Boolean).join('\n');
  const a = norm(el.value), b = norm(d);
  if (el.type === 'number' && ['', '0'].includes(a) && ['', '0'].includes(b)) return false;   // "empty or 0 is none"
  if (a !== '' && b !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) !== Number(b);
  return a !== b;
}

const _foldName = el => (el.dataset.label || el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.closest('label')?.textContent || el.id || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Read a fold's count and changed mark again from its fields. */
function advancedFoldMark(det) {
  if (!det?.classList?.contains('adv-fold')) return;
  const body = det.querySelector(':scope > .adv-fold-body');
  if (!body) return;
  const fields = [...body.querySelectorAll('input, select, textarea')].filter(el => !['hidden', 'button', 'submit'].includes(el.type) && !el.hidden);
  const radios = new Set(fields.filter(el => el.type === 'radio').map(el => el.name));
  const count = det.dataset.count ? Number(det.dataset.count) : fields.filter(el => el.type !== 'radio').length + radios.size;
  const differ = fields.filter(_foldDiffers);
  const names = [...new Set(differ.map(_foldName))];
  const n = Math.max(differ.length, Number(det.dataset.changed || 0));
  const c = det.querySelector(':scope > summary .adv-fold-count');
  if (c) { c.hidden = !count; c.textContent = String(count); c.title = `${count} setting${count === 1 ? '' : 's'} inside`; }
  const m = det.querySelector(':scope > summary .adv-fold-changed');
  if (m) {
    m.hidden = !n;
    m.textContent = n > 1 ? `${n} changed` : 'changed';
    m.title = n ? `Not the default: ${names.join(', ') || `${n} setting${n === 1 ? '' : 's'}`}` : '';
  }
  det.classList.toggle('adv-changed', !!n);
}

/** After a page has put values into its fields itself (no input event): read every fold under root, and around it, again. */
function advancedFoldRefresh(root = document) {
  if (!root) return;
  for (let d = root.closest?.('details.adv-fold'); d; d = d.parentElement?.closest('details.adv-fold')) advancedFoldMark(d);
  root.querySelectorAll?.('details.adv-fold').forEach(advancedFoldMark);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  // The open or closed state, remembered per browser per id ('toggle' does not bubble, so it is heard on the way down).
  document.addEventListener('toggle', e => {
    const det = e.target;
    if (!det?.classList?.contains('adv-fold') || !det.dataset.foldId) return;
    try { localStorage.setItem(_FOLD_KEY(det.dataset.foldId), det.open ? '1' : '0'); } catch { /* blocked: closed next time */ }
  }, true);
  const edited = e => {
    const det = e.target?.closest?.('details.adv-fold');
    if (!det) return;
    if (!e.isTrusted && !det.open) det.open = true;   // a draft the agent typed in (form_fill) is never hidden
    for (let d = det; d; d = d.parentElement?.closest('details.adv-fold')) advancedFoldMark(d);
  };
  document.addEventListener('input', edited, true);
  document.addEventListener('change', edited, true);
  if (typeof MutationObserver === 'function') document.addEventListener('DOMContentLoaded', () => {
    let queued = false;
    new MutationObserver(muts => {
      if (queued || !muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches('details.adv-fold') || n.querySelector('details.adv-fold'))))) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; advancedFoldRefresh(); });
    }).observe(document.body, { childList: true, subtree: true });
  });
}

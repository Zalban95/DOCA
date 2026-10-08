/* Type or pick (asked 2026-10-08: "we can manually edit and type from scratch where we can select … or use a drop-down
   menu to see what is available from the specific service"). One component for every setting that names something a
   service offers — a voice, a model, an address, a place: a text box that keeps whatever is typed, with a list of what
   the service in use offers beside it, each choice saying where it is ("served here", "at 10.0.0.5:8880").

     choiceInput({id, value, load, items, source, placeholder, allowCustom, width, attrs})  → markup
     choiceInputAttach(input, {load, items, source, …})                                       an existing box, in place
     choiceInputSet(id, {items, source})                                                       a list known later

   `load(force, typed)` returns {items, source} or a list of items — {value, label, where} or plain strings — and is called
   only when the list is first opened (and again by ↻); with `search: true` it is asked again as the person types (a
   place by name), with what is typed. A value the list does not hold is kept as typed and says so
   under the box: "not offered by <source> — kept as typed", never replaced. The box is the source of truth: picking
   sets its value and fires input and change, so a page reads it as before (document.getElementById(id).value).
   Keyboard: ↓ opens and moves, ↑ moves, Enter picks, Escape closes; Alt+↓ opens with every choice shown. On a phone
   (select-sheet.js's media query) ▾ opens the choices as a sheet in the theme. Styles: css/system.css (.choice). */
const _choiceSpecs = {};   // id → {load, items, source, allowCustom, loading}
let _choiceSeq = 0;

const _choiceEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const _choiceNorm = list => (Array.isArray(list) ? list : []).map(x => (typeof x === 'string' ? { value: x } : x)).filter(x => x && x.value !== undefined && x.value !== '');

function _choiceSpec(id, o) {
  _choiceSpecs[id] = { load: o.load || null, items: o.items ? _choiceNorm(o.items) : null, source: o.source || '', allowCustom: o.allowCustom !== false, search: !!o.search };
  return _choiceSpecs[id];
}

// Inline handlers find their box by its wrapper (data-choice), so an id is never spliced into script.
const _CHOICE_ID = "this.closest('.choice').dataset.choice";

function _choiceParts(source) {
  return `<button type="button" class="choice-open" tabindex="-1" aria-label="Show what ${_choiceEsc(source || 'the service')} offers" title="Show what ${_choiceEsc(source || 'the service')} offers"
      onmousedown="event.preventDefault()" onclick="choiceToggle(${_CHOICE_ID})">▾</button>`;
}

function choiceInput({ id, value = '', load = null, items = null, source = '', placeholder = '', allowCustom = true, search = false, width = '', attrs = '' } = {}) {
  id = id || `choice-${++_choiceSeq}`;
  _choiceSpec(id, { load, items, source, allowCustom, search });
  const e = _choiceEsc(id), note = _choiceNoteText(id, value);
  return `<span class="choice" data-choice="${e}"${width ? ` style="width:${_choiceEsc(width)}"` : ''}><span class="choice-box">
      <input class="input choice-field" id="${e}" value="${_choiceEsc(value)}" placeholder="${_choiceEsc(placeholder)}" autocomplete="off" spellcheck="false"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${e}-list" ${attrs}>${_choiceParts(source)}</span>
    <div class="choice-list" id="${e}-list" role="listbox" hidden></div><span class="choice-note" id="${e}-note"${note ? '' : ' hidden'}>${_choiceEsc(note)}</span></span>`;
}

/** Make an existing box a choiceInput where it stands (its id, value, style and handlers kept). */
function choiceInputAttach(input, o = {}) {
  if (!input || input.closest('.choice')) { if (input) choiceInputSet(input.id, o); return input; }
  if (!input.id) input.id = `choice-${++_choiceSeq}`;
  const id = input.id;
  _choiceSpec(id, o);
  const wrap = document.createElement('span');
  wrap.className = 'choice'; wrap.dataset.choice = id;
  if (input.style.flex) { wrap.style.flex = input.style.flex; input.style.flex = ''; }
  if (input.style.width) { wrap.style.width = input.style.width; input.style.width = ''; }
  input.before(wrap);
  wrap.innerHTML = `<span class="choice-box">${_choiceParts(o.source)}</span><div class="choice-list" id="${_choiceEsc(id)}-list" role="listbox" hidden></div><span class="choice-note" id="${_choiceEsc(id)}-note" hidden></span>`;
  wrap.firstElementChild.prepend(input);
  input.classList.add('choice-field');
  Object.entries({ autocomplete: 'off', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${id}-list` }).forEach(([k, v]) => input.setAttribute(k, v));
  _choiceNote(id);
  return input;
}

/** A list (or its source's name) known after the box was drawn. */
function choiceInputSet(id, { items, source, load } = {}) {
  const s = _choiceSpecs[id] || _choiceSpec(id, {});
  if (items) s.items = _choiceNorm(items);
  if (source !== undefined) s.source = source;
  if (load) s.load = load;
  _choiceNote(id);
}

/** "not offered by <source> — kept as typed", when the list is known and does not hold the value. */
function _choiceNoteText(id, value) {
  const s = _choiceSpecs[id];
  const v = String(value ?? '').trim();
  if (!s?.items || !v || !s.items.length || s.items.some(i => String(i.value) === v)) return '';
  if (s.search && s.items.some(i => String(i.value).toLowerCase().startsWith(v.toLowerCase()))) return '';   // a search's answers name the place in full
  return `not offered by ${s.source || 'the service'} — kept as typed`;
}

function _choiceNote(id) {
  const el = document.getElementById(`${id}-note`), input = document.getElementById(id);
  if (!el || !input) return;
  const t = _choiceNoteText(id, input.value);
  el.textContent = t; el.hidden = !t;
}

async function _choiceLoad(id, force = false) {
  const s = _choiceSpecs[id];
  if (!s?.load || (s.items && !force && !s.search)) return;
  s.loading = true; s.error = '';
  try {
    const got = await s.load(force, String(document.getElementById(id)?.value || '').trim());
    if (Array.isArray(got)) s.items = _choiceNorm(got);
    else { s.items = _choiceNorm(got?.items); if (got?.source) s.source = got.source; }
  } catch (e) { s.error = e.message || String(e); s.items = s.items || null; }
  s.loading = false;
  _choiceNote(id);
}

const _choicePhone = () => typeof window !== 'undefined' && typeof SELECT_SHEET_MQ !== 'undefined' && window.matchMedia?.(SELECT_SHEET_MQ).matches;

/** Open or close a box's list (▾). */
function choiceToggle(id) {
  const list = document.getElementById(`${id}-list`);
  if (list && !list.hidden) return choiceClose(id);
  return choiceOpen(id, { all: true });
}

/** Open the list: every choice, or — once the person has typed in the box — those that match what is typed. */
async function choiceOpen(id, { all = !_choiceSpecs[id]?.typed } = {}) {
  const input = document.getElementById(id);
  if (!input) return;
  if (_choicePhone()) return _choiceSheet(id);
  document.querySelectorAll('.choice-list:not([hidden])').forEach(l => { if (l.id !== `${id}-list`) choiceClose(l.id.replace(/-list$/, '')); });
  const list = document.getElementById(`${id}-list`);
  list.hidden = false; input.setAttribute('aria-expanded', 'true');
  list.dataset.all = all ? '1' : '';
  _choiceDraw(id);
  if (!_choiceSpecs[id]?.items || _choiceSpecs[id].search) { await _choiceLoad(id); if (!list.hidden) _choiceDraw(id); }
}

function choiceClose(id) {
  const list = document.getElementById(`${id}-list`);
  if (list) { list.hidden = true; list.innerHTML = ''; }
  document.getElementById(id)?.setAttribute('aria-expanded', 'false');
  document.getElementById(id)?.removeAttribute('aria-activedescendant');
}

/** The choices that fit what is typed (all of them when it was opened with ▾, or nothing is typed). */
function _choiceShown(id, all) {
  const s = _choiceSpecs[id] || {}, typed = String(document.getElementById(id)?.value || '').trim().toLowerCase();
  const items = s.items || [];
  if (all || s.search || !typed || items.some(i => String(i.value).toLowerCase() === typed)) return items;
  return items.filter(i => `${i.value} ${i.label || ''}`.toLowerCase().includes(typed));
}

function _choiceItemHtml(id, i, n, cur) {
  const label = i.label && i.label !== i.value ? `${_choiceEsc(i.label)} <span class="choice-val">${_choiceEsc(i.value)}</span>` : _choiceEsc(i.value);
  return `<div class="choice-item${String(i.value) === cur ? ' chosen' : ''}" role="option" id="${_choiceEsc(id)}-opt-${n}" data-value="${_choiceEsc(i.value)}"
      onmousedown="event.preventDefault()" onclick="choicePick(${_CHOICE_ID}, this.dataset.value)"><span class="choice-label">${label}</span>${i.where ? `<span class="choice-where">${_choiceEsc(i.where)}</span>` : ''}</div>`;
}

function _choiceDraw(id) {
  const list = document.getElementById(`${id}-list`), input = document.getElementById(id), s = _choiceSpecs[id] || {};
  if (!list || list.hidden) return;
  const cur = String(input.value || '').trim();
  const shown = _choiceShown(id, list.dataset.all === '1');
  const head = `<div class="choice-head"><span>${_choiceEsc(s.source ? `From ${s.source}` : 'Choices')}</span>${s.load ? `<button type="button" class="choice-refresh" title="Ask again" aria-label="Ask again"
      onmousedown="event.preventDefault()" onclick="choiceRefresh(${_CHOICE_ID})">↻</button>` : ''}</div>`;
  const body = s.loading && !s.items ? '<div class="choice-empty">Asking…</div>'
    : s.error && !s.items ? `<div class="choice-empty">Could not ask: ${_choiceEsc(s.error)} — type a value.</div>`
    : !shown.length ? `<div class="choice-empty">${s.items?.length ? 'Nothing listed matches — what you typed is kept.' : 'Nothing listed — type a value.'}</div>`
    : shown.map((i, n) => _choiceItemHtml(id, i, n, cur)).join('');
  list.innerHTML = head + body;
  list.querySelector('.choice-item.chosen')?.scrollIntoView?.({ block: 'nearest' });
}

async function choiceRefresh(id) {
  await _choiceLoad(id, true);
  _choiceDraw(id);
}

/** A choice taken: into the box, as if typed (input and change fire). */
function choicePick(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  choiceClose(id);
  document.getElementById('choice-sheet')?.remove();
  if (_choiceSpecs[id]) _choiceSpecs[id].typed = false;
  if (input.value !== value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  _choiceNote(id);
  input.focus();
}

/** ↑ ↓ move the highlighted choice; returns it. */
function _choiceMove(id, step) {
  const items = [...document.querySelectorAll(`#${CSS.escape(id)}-list .choice-item`)];
  if (!items.length) return null;
  const at = items.findIndex(el => el.classList.contains('active'));
  const next = items[(at + step + items.length) % items.length] || items[0];
  items.forEach(el => el.classList.toggle('active', el === next));
  next.scrollIntoView?.({ block: 'nearest' });
  document.getElementById(id)?.setAttribute('aria-activedescendant', next.id);
  return next;
}

/** On a phone: the choices as a sheet in the panel's theme, with ↻ and a way to keep what is typed. */
async function _choiceSheet(id) {
  document.getElementById('choice-sheet')?.remove();
  const s = _choiceSpecs[id] || {}, input = document.getElementById(id);
  const back = Object.assign(document.createElement('div'), { id: 'choice-sheet', className: 'select-sheet choice-sheet' });
  const release = typeof overlayBack === 'function' ? overlayBack(() => back.remove()) : () => {};
  const draw = () => {
    const cur = String(input.value || '').trim();
    back.innerHTML = `<div class="select-sheet-box" role="listbox"><div class="select-sheet-title choice-head"><span>${_choiceEsc(s.source ? `From ${s.source}` : 'Choices')}</span>
      ${s.load ? '<button type="button" class="choice-refresh" aria-label="Ask again">↻</button>' : ''}</div>
      ${s.loading && !s.items ? '<div class="choice-empty">Asking…</div>' : (s.items || []).map(i => `<button type="button" class="select-sheet-item${String(i.value) === cur ? ' active' : ''}" data-value="${_choiceEsc(i.value)}">${_choiceEsc(i.label || i.value)}${
        i.where ? `<span class="choice-where">${_choiceEsc(i.where)}</span>` : ''}</button>`).join('') || `<div class="choice-empty">${s.error ? `Could not ask: ${_choiceEsc(s.error)}` : 'Nothing listed'} — type a value.</div>`}
      ${cur ? `<button type="button" class="select-sheet-item choice-keep" data-value="${_choiceEsc(cur)}">Keep “${_choiceEsc(cur)}” as typed</button>` : ''}</div>`;
    back.querySelectorAll('[data-value]').forEach(b => { b.onclick = () => { release(); choicePick(id, b.dataset.value); }; });
    const again = back.querySelector('.choice-refresh');
    if (again) again.onclick = async () => { await _choiceLoad(id, true); if (back.isConnected) draw(); };
  };
  back.onclick = e => { if (e.target === back) { release(); back.remove(); } };
  draw();
  document.body.append(back);
  if (!s.items) { await _choiceLoad(id); if (back.isConnected) draw(); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('keydown', e => {
    const input = e.target;
    if (!input?.classList?.contains('choice-field')) return;
    const id = input.id, list = document.getElementById(`${id}-list`), open = list && !list.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { choiceOpen(id, e.altKey ? { all: true } : {}); return; }
      _choiceMove(id, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && open) {
      const active = list.querySelector('.choice-item.active');
      e.preventDefault();
      if (active) choicePick(id, active.dataset.value); else { choiceClose(id); _choiceNote(id); }
    } else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); choiceClose(id); }
    else if (e.key === 'Tab' && open) choiceClose(id);
  }, true);
  document.addEventListener('input', e => {
    const input = e.target;
    if (!input?.classList?.contains('choice-field')) return;
    const list = document.getElementById(`${input.id}-list`);
    if (list && !list.hidden) { list.dataset.all = ''; _choiceDraw(input.id); }
    const s = _choiceSpecs[input.id];
    if (s) s.typed = true;   // from here on, opening shows what matches what is typed
    if (s?.search) {   // asked again once the typing pauses, and the list opened on what came back
      clearTimeout(s.timer);
      s.timer = setTimeout(async () => { await _choiceLoad(input.id, true); if (document.activeElement === input) choiceOpen(input.id); }, 350);
      return;
    }
    _choiceNote(input.id);
  });
  document.addEventListener('focusout', e => {
    const box = e.target?.closest?.('.choice');
    if (!box) return;
    // A box taken off the page (a card drawn again) leaves its id to the new one, which is not this box's to close.
    setTimeout(() => { if (box.isConnected && !box.contains(document.activeElement)) { choiceClose(box.dataset.choice); _choiceNote(box.dataset.choice); } }, 120);
  });
}

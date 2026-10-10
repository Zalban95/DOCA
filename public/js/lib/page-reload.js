/* Every page shows the version the hub runs (asked 2026-10-10: "the version isn't shown updated unless the app is
   closed and reopened"). Two ways a page learns it should load again:
     - the live feed's hello names the hub's version (live/routes.js); a page that reconnects to another one — after a
       switch or an update, both of which restart the hub — has old scripts, and reloads
     - an admin's "Reload every screen" (or a person's "Reload my screens"): the `screen` topic's `reload`
   A page reloads at once when nothing on it would be lost; while a form holds what someone typed, a call or a meeting
   is on, or a question is open, it says so with a Reload button and reloads by itself once that is over. A phone's or
   a desk's app shows the panel as a page, so it hears both without an update of its own. */

let _prVersion = null;          // the version this page's scripts came with (the first hello's)
let _prTimer = null, _prBar = null;
const _prEdited = new Set();    // fields typed into since the page loaded

/** When this page could reload without losing anything ("once the call ends"); '' when it can now. */
function pageReloadBusy() {
  if (typeof _callActive !== 'undefined' && _callActive) return 'once the call ends';
  if (typeof MEET !== 'undefined' && MEET?.id) return 'once you leave the meeting';
  if (document.querySelector('#app-confirm-modal.open, #app-prompt-modal.open') || document.getElementById('fp-modal')?.style.display === 'flex') return 'once the open question is answered';
  for (const el of _prEdited) {
    if (!el.isConnected) { _prEdited.delete(el); continue; }
    const v = el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked : String(el.value ?? '') !== String(el.defaultValue ?? '');
    if (v && String(el.value || '').trim()) return 'once what you typed is saved, sent or cleared';
  }
  return '';
}

/** The hub said its version (each hello). */
function pageVersionSeen(v) {
  if (!v) return;
  if (!_prVersion) { _prVersion = v; return; }
  if (v !== _prVersion) pageReloadSoon(`DOCA was updated to v${v}.`);
}

/** Reload now if nothing would be lost, else say why and offer the button; checked again every 10 s. */
function pageReloadSoon(why) {
  clearTimeout(_prTimer);
  const busy = pageReloadBusy();
  if (!busy) { _prShow(`${why} Loading it again…`, false); _prTimer = setTimeout(() => location.reload(), 1200); return; }
  _prShow(`${why} This page loads again ${busy} — or now:`, true);
  _prTimer = setTimeout(() => pageReloadSoon(why), 10000);
}

function _prShow(text, button) {
  if (typeof document === 'undefined' || !document.body) return;
  let host = document.getElementById('undo-toasts');
  if (!host) { host = Object.assign(document.createElement('div'), { id: 'undo-toasts', className: 'undo-toasts' }); host.setAttribute('role', 'status'); document.body.appendChild(host); }
  if (!_prBar || !_prBar.isConnected) { _prBar = Object.assign(document.createElement('div'), { className: 'undo-toast page-reload' }); host.appendChild(_prBar); }
  _prBar.innerHTML = '';
  _prBar.appendChild(Object.assign(document.createElement('span'), { className: 'undo-text', textContent: text }));
  if (button) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm undo-btn', textContent: 'Reload' });
    b.onclick = () => location.reload();
    const later = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn undo-x', textContent: '✕', title: 'Not now (it still reloads once the page is free)' });
    later.onclick = () => { _prBar.remove(); };
    _prBar.append(b, later);
  }
}

/** Settings → devices: ⟳ reloads every signed-in page of the hive (an admin) or one's own (anyone else). */
async function screensReloadAll(btn) {
  const every = btn?.dataset.every !== '0';
  try {
    const r = await apiFetch('/api/screen/reload', { method: 'POST', body: { every } });
    const st = document.getElementById('dev-reload-status');
    if (st) setStatus(st, `✓ Asked ${r.pages} open page${r.pages === 1 ? '' : 's'} to load again${every ? '' : ' (yours)'} — one being edited asks its person first.`, 'ok');
  } catch (e) { appAlert(e.message); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('input', e => { if (e.isTrusted && e.target?.matches?.('input, textarea, select, [contenteditable]')) _prEdited.add(e.target); }, true);
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof liveOn === 'function') liveOn('screen', c => { if (c.what === 'reload') pageReloadSoon(c.every ? `${c.by || 'An admin'} asked every screen to load again.` : 'You asked your screens to load again.'); });
  });
}

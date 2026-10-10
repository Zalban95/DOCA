/* A notice for this person — a reminder, or what the agent told them (tell_device) — drawn on their open pages
   (modules/notices). A signed-in browser takes no `alert` from the device bus, so before this a reminder on a
   browser-only install reached nobody. It comes on the live feed's `notice` topic, only to this person's pages, as a
   card in the questions dock that stays until dismissed (dismissing it on one page takes it down on the others);
   a page opened later finds the ones still waiting in GET /api/notices. Where the browser already allows
   notifications, a hidden page also raises one — the panel never asks for that permission itself. */

const _noticeCards = new Map();   // notice id -> card element

function _noticeShow(n) {
  if (!n?.id || _noticeCards.has(n.id) || typeof _questionsDock !== 'function') return;
  const card = document.createElement('div');
  card.className = 'question-card notice-card';
  card.innerHTML = `<div class="notice-card-head"><span class="notice-card-title"></span>`
    + `<button class="btn btn-sm" title="Dismiss">✕</button></div><div class="notice-card-text"></div>`;
  card.querySelector('.notice-card-title').textContent = n.title;
  card.querySelector('.notice-card-text').textContent = n.text || '';
  if (n.link?.href) {   // a place in the panel the notice is about (modules/notices: `#page?k=v`, never elsewhere)
    const go = Object.assign(document.createElement('button'), { className: 'btn btn-sm btn-primary notice-card-go', textContent: n.link.label || 'Open' });
    go.onclick = () => noticeGo(n.link.href);
    card.querySelector('.notice-card-text').after(go);
  }
  card.querySelector('button').onclick = async () => {
    _noticeDrop(n.id);
    try { await apiFetch(`/api/notices/${encodeURIComponent(n.id)}/seen`, { method: 'POST', body: {} }); } catch { /* gone already */ }
  };
  _noticeCards.set(n.id, card);
  _questionsDock().prepend(card);
  try {
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(n.title, { body: n.text || '' });
  } catch { /* not offered here */ }
}

/** `#page?k=v`: the page, then a `doca-go` event with the words after it, for whichever page acts on them. */
function noticeGo(href) {
  const m = /^#([a-z][a-z-]*)(?:\?(.*))?$/.exec(String(href || ''));
  if (!m || typeof nav !== 'function') return;
  nav(m[1]);
  window.dispatchEvent(new CustomEvent('doca-go', { detail: { page: m[1], params: Object.fromEntries(new URLSearchParams(m[2] || '')) } }));
}

function _noticeDrop(id) { _noticeCards.get(id)?.remove(); _noticeCards.delete(id); }

async function _noticesWaiting() {
  try { for (const n of ((await apiFetch('/api/notices')).notices || []).reverse()) _noticeShow(n); }
  catch { /* signed out */ }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  if (typeof liveOn !== 'function' || !document.getElementById('chat-fab')) return;
  liveOn('notice', c => {
    if (c.what === 'new') return _noticeShow(c.notice);
    if (c.what === 'seen') return _noticeDrop(c.id);
    if (c.what === 'resync') _noticesWaiting();
  });
  _noticesWaiting();
  // A link opened in a new tab (`/#connectors?draft=…`): solo.js opens plain `#page` links, this one those with words.
  if (/^#[a-z][a-z-]*\?/.test(location.hash)) window.addEventListener('load', () => setTimeout(() => noticeGo(location.hash), 400));
});

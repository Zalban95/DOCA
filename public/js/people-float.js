/* The floating chat holds both: your agent and the people (asked 2026-10-09: "it can even be the same chat we use for
   the Orchestrator"). A switch under its header — Agent | People — swaps what the panel shows: the Orchestrator's
   conversation as before, or the hive chat's list and one conversation at a time (people-view.js, mode `float`). The
   unread count rides on the switch and on the chat button. chat.js is at its size ceiling: this file adds the switch to
   its markup and touches nothing else. */
let _pcFloat = null;

function chatFloatMode(mode) {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  panel.dataset.mode = mode;
  panel.querySelectorAll('.chat-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  panel.querySelectorAll('.chat-switch button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  if (mode === 'people') {
    if (!_pcFloat) _pcFloat = peopleView(panel.querySelector('.pc-float'), 'float');
    peopleLoad().then(() => { _pcFloat.list(); if (_pcFloat.open) _pcFloat.space(_pcFloat.open); });
  }
  try { localStorage.setItem('doca.chat.mode', mode); } catch { /* it forgets */ }
}

/** A conversation in the floating chat (from a card's Message, or a notice). */
function peopleFloatOpen(id) {
  if (!chatOpen) toggleChat();
  chatFloatMode('people');
  _pcFloat?.openSpace(id);
}

function _pcFloatMount() {
  const panel = document.getElementById('chat-panel'), head = panel?.querySelector('.chat-header');
  if (!head || panel.querySelector('.chat-switch')) return;
  const sw = Object.assign(document.createElement('div'), { className: 'chat-switch', role: 'tablist' });
  sw.setAttribute('aria-label', 'Your agent or the people');
  sw.innerHTML = `<button type="button" role="tab" data-mode="agent" class="active">Agent</button>
    <button type="button" role="tab" data-mode="people">People <span class="pc-badge-n" data-people-badge hidden></span></button>`;
  sw.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) chatFloatMode(b.dataset.mode); });
  head.after(sw);
  const box = Object.assign(document.createElement('div'), { className: 'pc-float' });
  box.innerHTML = '<div class="pc-float-list"><input class="input pc-search" type="search" placeholder="Find a conversation" aria-label="Find a conversation"><div class="pc-list-body"></div><button type="button" class="btn btn-sm pc-float-new" data-act="new" hidden>＋ New conversation</button></div><section class="pc-space"></section>';
  sw.after(box);
  const fab = document.getElementById('chat-fab');
  if (fab && !fab.querySelector('[data-people-badge]')) fab.insertAdjacentHTML('beforeend', '<span class="pc-fab-badge" data-people-badge hidden></span>');
  let mode = 'agent';
  try { mode = localStorage.getItem('doca.chat.mode') === 'people' ? 'people' : 'agent'; } catch { /* agent */ }
  panel.dataset.mode = 'agent';
  if (mode === 'people') chatFloatMode('people');
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const go = () => { if (typeof licenceFeatureOn !== 'function' || licenceFeatureOn('hive-chat')) { _pcFloatMount(); peopleLoad(); } };
  if (typeof licenceReady === 'function') licenceReady().then(go); else go();
});

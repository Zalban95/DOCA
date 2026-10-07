/* ═══════════════════════════════════════════════════════
   The floating chat's header and its first screen (wave E, des 10 and 28):
   - the header is one line: the title, the approval pill, Live, ⋯ and ✕ — Open the work, Voice settings and Clear
     history move into the ⋯ menu (the same menu a row's ⋯ opens, lib/ui-parts.js);
   - a conversation with nothing in it yet opens on a greeting with three things to ask, instead of a blank panel.
     A suggestion fills the message box; sending stays the person's (the agent proposes, a person decides).
   chat.js is at its size ceiling, so this is a file of its own and touches only the header's existing buttons.
   ═══════════════════════════════════════════════════════ */

const CHAT_SUGGESTIONS = [
  'What did the agents do overnight?',
  'What is running on this hub right now?',
  'Set me up for what I want to do on this machine',
];

function chatHeadTidy() {
  const bar = document.querySelector('#chat-panel .chat-header .toolbar-right');
  if (!bar || bar.querySelector('.row-more')) return;
  const moved = [...bar.querySelectorAll('button')].filter(b => /⧉ Work|⚙|^Clear$/.test(b.textContent.trim()));
  if (!moved.length) return;
  const label = { '⧉ Work': 'Open the work', '⚙': 'Voice settings', Clear: 'Clear history' };
  const more = Object.assign(document.createElement('span'), { className: 'row-more chat-more' });
  more.innerHTML = `<button type="button" class="icon-btn" aria-label="More: open the work, voice settings, clear" aria-haspopup="menu" aria-expanded="false" title="More" onclick="rowMoreToggle(this)">${uiIcon('more')}</button><span class="row-more-menu" role="menu" hidden></span>`;
  const menu = more.querySelector('.row-more-menu');
  for (const b of moved) {
    b.className = 'row-more-item';
    b.setAttribute('role', 'menuitem');
    b.textContent = label[b.textContent.trim()] || b.textContent;
    b.addEventListener('click', rowMoreClose);
    menu.append(b);
  }
  const close = [...bar.querySelectorAll('button')].find(b => b.title === 'Close');
  bar.insertBefore(more, close || null);
}

function _chatGreetingWord() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening.' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
}

function chatGreetingRender() {
  const msgs = document.getElementById('chat-messages');
  if (!msgs || document.getElementById('chat-greeting')) return;
  const g = Object.assign(document.createElement('div'), { id: 'chat-greeting', className: 'chat-greeting' });
  g.innerHTML = `<div class="chat-greeting-points" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="chat-greeting-text"><h2>${_chatGreetingWord()}</h2><p>Ask for anything — it is done here, or on the device it belongs on.</p></div>
    <div class="chat-greeting-asks">${CHAT_SUGGESTIONS.map((s, i) => `<button type="button" class="chat-greeting-ask" onclick="chatGreetingUse(${i})">${escHtml(s)}</button>`).join('')}</div>`;
  msgs.after(g);
  // Shown while the conversation holds nothing but the panel's own placeholder line.
  const mark = () => {
    const kids = [...msgs.children];
    document.getElementById('chat-panel')?.classList.toggle('is-new', kids.length <= 1 && kids.every(k => k.matches('.chat-msg.system')));
  };
  new MutationObserver(mark).observe(msgs, { childList: true });
  mark();
}

/** A suggestion fills the message box, for the person to send or change. */
function chatGreetingUse(i) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = CHAT_SUGGESTIONS[i] || '';
  input.focus();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  // After workstream.js has added its ⧉ Work to the header (its listener is registered first).
  setTimeout(() => { chatHeadTidy(); chatGreetingRender(); }, 0);
});

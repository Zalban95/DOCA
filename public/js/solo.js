/* A page served alone (asked 2026-10-06: "dedicate a screen to the working agents … just open the page or a new tab in a
   desk client or even just in a browser full screen"). `/?view=<page>` is the panel showing one page by itself — no
   header, sidebar, chat button or corner face — live like any page (lib/live.js). A small bar in the corner, hidden
   until the screen is touched or the mouse moves, makes it full screen (or F) and goes back to the whole panel. ⧉ in
   the header opens the page in use alone. The presence heartbeat says what a screen shows, so the Devices list knows,
   and an admin can send a page to a screen from there (screens/showing.js; heard here as `screen`). */
const SOLO_PAGE = (() => { try { return new URLSearchParams(location.search).get('view'); } catch { return null; } })();
const soloOn = () => !!SOLO_PAGE && typeof NAV_TABS !== 'undefined' && NAV_TABS.includes(SOLO_PAGE);

function soloStart() {
  document.body.classList.add('solo');
  nav(SOLO_PAGE);
  const bar = Object.assign(document.createElement('div'), { className: 'solo-bar' });
  bar.innerHTML = `<span>${escHtml((typeof NAV_LABELS !== 'undefined' && NAV_LABELS[SOLO_PAGE]) || SOLO_PAGE)}</span>
    <button class="btn btn-xs" onclick="soloFull()" title="Full screen (F)">⛶</button>
    <button class="btn btn-xs" onclick="location.href='/'" title="Back to the whole panel">✕</button>`;
  document.body.append(bar);
  let t = null;
  const wake = () => { bar.classList.add('awake'); clearTimeout(t); t = setTimeout(() => bar.classList.remove('awake'), 3000); };
  ['mousemove', 'touchstart', 'keydown'].forEach(e => document.addEventListener(e, wake, { passive: true }));
  document.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) soloFull(); });
  wake();
}

function soloFull() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

/** ⧉ in the header: the page in use, by itself, in a new tab or window. */
function soloOpen(page = currentTab) {
  // Inside an app's web view (DocaMobile, DocaDesk) or on a phone there is no second window: window.open would load the
  // page over this one and cut off whatever it was doing — a conversation's answer included (found 2026-10-06). There
  // the page opens here; on a desk, in a window of its own.
  if (/DocaMobile\/|DocaDesk\//.test(navigator.userAgent) || window.matchMedia('(max-width: 768px)').matches) {
    if (typeof chatOpen !== 'undefined' && chatOpen) toggleChat(true);
    return nav(page);
  }
  if (!window.open(`/?view=${encodeURIComponent(page)}`, `doca-${page}`, 'popup,width=1200,height=800')) nav(page);   // a blocked popup: here
}

/** A page an admin sent to this screen (Devices → Show here). */
function _soloShow(c) {
  if (c.what !== 'show' || !c.page) return;
  if (c.solo) { if (SOLO_PAGE !== c.page) location.href = `/?view=${encodeURIComponent(c.page)}`; }
  else if (SOLO_PAGE) location.href = `/#${encodeURIComponent(c.page)}`;
  else nav(c.page);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  window.addEventListener('load', async () => {
    if (!document.getElementById('chat-fab')) return;   // the panel only
    // A person's own page (panel-layout.js) is a page once their layout has been read: wait for it before deciding.
    if (String(SOLO_PAGE || '').startsWith('view-') && !soloOn() && typeof panelLayoutLoad === 'function') await panelLayoutLoad().catch(() => null);
    if (soloOn()) soloStart();
    else {
      // `/#<page>`, and `/#settings/<section>` for a Settings section (an agent's link to Settings → Set-up, say).
      const [, page, sub] = /^#([a-z]+)(?:\/([a-z-]+))?$/.exec(location.hash) || [];
      if (page && NAV_TABS.includes(page)) { nav(page); if (sub && page === 'settings' && typeof settingsSubNav === 'function') settingsSubNav(sub); }
    }
    const open = Object.assign(document.createElement('button'), { className: 'btn btn-xs solo-open', textContent: '⧉', title: 'Open this page by itself — for a screen of its own' });
    open.onclick = soloOpen;
    document.getElementById('header-search')?.before(open);
    if (typeof liveOn === 'function') liveOn('screen', _soloShow);
  });
}

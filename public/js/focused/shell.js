/* The Focused view's frame: a left rail on a desk (icons only when folded — the fold is remembered in this browser),
   a bottom bar on a phone with the points as the talk button in the middle, a top line with the time, what needs
   the person and their avatar, and the screen in between. Screens: home, chat, calendar, mail, made, settings —
   each a function that draws into the view and hands back what to stop when it goes (fcOwn). Back on a phone goes
   to the screen before (history state `fc`). */
const FC_SCREENS = {
  home: { label: 'Home', icon: 'home', draw: el => fcHomeRender(el) },
  chat: { label: 'Conversation', icon: 'chat', draw: el => fcChatRender(el) },
  calendar: { label: 'Calendar', icon: 'calendar', draw: el => fcAgendaRender(el, 'calendar') },
  mail: { label: 'Mail', icon: 'mail', draw: el => fcAgendaRender(el, 'mail') },
  made: { label: 'Made for you', short: 'Made', icon: 'made', draw: el => fcMakeRender(el) },
  settings: { label: 'Settings', icon: 'gear', draw: el => fcSettingsRender(el), hidden: true },
};
let _fcScreen = 'home', _fcStops = [], _fcOpen = false;

/** Something the current screen started (a feed, the points): stopped when the screen goes. */
function fcOwn(stop) { if (typeof stop === 'function') _fcStops.push(stop); }

const _fcRailFolded = () => { try { return localStorage.getItem('doca.focused.rail') === 'icons'; } catch { return false; } };

function fcShellOpen() {
  _fcOpen = true;
  let root = document.getElementById('focused');
  if (!root) {
    root = Object.assign(document.createElement('div'), { id: 'focused', className: 'fc' });
    root.innerHTML = _fcShellHtml();
    document.body.prepend(root);
    window.addEventListener('popstate', _fcPop);
  }
  root.classList.toggle('fc-folded', _fcRailFolded());
  root.hidden = false;
  // The page's own theme loads beside this at start (themes.js themeApplyOnLoad): the look is applied again after it.
  if (typeof fcLookApply === 'function') { fcLookApply(); [700, 2000].forEach(ms => setTimeout(() => { if (_fcOpen) fcLookApply(); }, ms)); }
  _fcAvatar();
  fcGo(_fcScreen, { replace: true });
  _fcClock();
}

function fcShellClose() {
  _fcOpen = false;
  _fcStops.splice(0).forEach(s => { try { s(); } catch { /* gone */ } });
  const root = document.getElementById('focused');
  if (root) root.hidden = true;
  fcMenuClose();
  if (typeof fcLookGiveBack === 'function') fcLookGiveBack();
}

function _fcShellHtml() {
  const rail = Object.entries(FC_SCREENS).filter(([, s]) => !s.hidden).map(([id, s]) =>
    `<button type="button" class="fc-rail-item" data-fc="${id}" onclick="fcGo('${id}')" title="${escHtml(s.label)}">${fcIcon(s.icon)}<span>${escHtml(s.label)}</span></button>`).join('');
  const bar = id => { const s = FC_SCREENS[id]; return `<button type="button" class="fc-bar-item" data-fc="${id}" onclick="fcGo('${id}')">${fcIcon(s.icon)}<span>${escHtml(s.short || s.label)}</span></button>`; };
  return `
    <aside class="fc-rail" aria-label="Focused">
      <div class="fc-brand"><span class="fc-pt" aria-hidden="true"></span><span class="fc-brand-name" data-brand>${escHtml(fcProduct())}</span></div>
      <nav class="fc-rail-nav">${rail}</nav>
      <button type="button" class="fc-rail-item fc-rail-fold" onclick="fcRailToggle()" title="Fold the menu to icons, or open it again">${fcIcon('rail')}<span>Fold menu</span></button>
    </aside>
    <div class="fc-main">
      <div role="banner" class="fc-top">
        <div class="fc-brand fc-brand-top"><span class="fc-pt" aria-hidden="true"></span><span class="fc-brand-name" data-brand>${escHtml(fcProduct())}</span></div>
        <span class="fc-clock fc-mono" id="fc-clock"></span>
        <button type="button" class="fc-btn fc-q fc-ib" id="fc-bell" onclick="fcGo('mail')" aria-label="What needs you">${fcIcon('bell')}<span class="fc-bell-n" id="fc-bell-n" hidden></span></button>
        <button type="button" class="fc-avatar-btn" id="fc-avatar-btn" onclick="fcMenuToggle()" aria-haspopup="menu" aria-expanded="false" aria-label="You, settings and the Extended panel">
          <span class="fc-avatar" id="fc-avatar">·</span>${fcIcon('chevron', 16)}</button>
      </div>
      <main class="fc-view" id="fc-view"></main>
    </div>
    <nav class="fc-bar" aria-label="Focused">${bar('home')}${bar('calendar')}
      <button type="button" class="fc-bar-talk" onclick="fcCallStart()" aria-label="Talk"><span class="fc-bar-dots" id="fc-bar-dots"></span></button>
      ${bar('mail')}${bar('made')}</nav>
    <div class="fc-menu" id="fc-menu" role="menu" aria-label="You and the panel" hidden></div>`;
}

/** Go to a screen of the Focused view. */
function fcGo(id, { replace = false } = {}) {
  if (!FC_SCREENS[id] || !_fcOpen) return;
  _fcStops.splice(0).forEach(s => { try { s(); } catch { /* gone */ } });
  _fcScreen = id;
  const root = document.getElementById('focused');
  root.dataset.screen = id;
  root.querySelectorAll('[data-fc]').forEach(b => { b.classList.toggle('on', b.dataset.fc === id); b.setAttribute('aria-current', b.dataset.fc === id ? 'page' : 'false'); });
  const view = document.getElementById('fc-view');
  view.replaceChildren();
  view.scrollTop = 0;
  fcMenuClose();
  try { history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), fc: id }, ''); } catch { /* a sandbox */ }
  const bar = document.getElementById('fc-bar-dots');
  if (bar && !bar.firstChild) fcOwnBar(bar);
  FC_SCREENS[id].draw(view);
}

/** The talk button's points live as long as the view. */
let _fcBarDots = null;
function fcOwnBar(host) { if (!_fcBarDots) _fcBarDots = fcDots(host, 46); }

function _fcPop(e) {
  if (!_fcOpen || !focusedOn()) return;
  const id = e.state?.fc;
  if (id && FC_SCREENS[id] && id !== _fcScreen) fcGo(id, { replace: true });
}

function fcRailToggle() {
  const folded = !_fcRailFolded();
  try { localStorage.setItem('doca.focused.rail', folded ? 'icons' : 'open'); } catch { /* this page only */ }
  document.getElementById('focused')?.classList.toggle('fc-folded', folded);
}

function _fcClock() {
  const el = document.getElementById('fc-clock');
  if (!el) return;
  const tick = () => { const d = new Date(); el.textContent = `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`; };
  tick();
  clearInterval(_fcClock.t); _fcClock.t = setInterval(() => { if (_fcOpen) tick(); }, 20000);
}

async function _fcAvatar() {
  const me = await fcMe();
  const a = document.getElementById('fc-avatar');
  if (a) a.textContent = (fcFirstName(me)[0] || '·').toUpperCase();
  document.querySelectorAll('#focused [data-brand]').forEach(el => { el.textContent = fcProduct(); });
}

/** How many things wait on the person: the bell's number. */
function fcBellCount(n) {
  const b = document.getElementById('fc-bell-n');
  if (!b) return;
  b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n || '');
}

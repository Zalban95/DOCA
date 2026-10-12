/* The avatar menu: who is signed in, which view this screen shows (Focused · Extended — one tap either way), Settings
   and Sign out. On a phone it opens as a sheet from the bottom; Escape or a tap outside closes it. */

async function fcMenuToggle() {
  const m = document.getElementById('fc-menu');
  if (!m) return;
  if (!m.hidden) return fcMenuClose();
  const me = await fcMe();
  const mode = document.documentElement.dataset.mode;
  const item = (id, label, note) => `<button type="button" role="menuitemradio" aria-checked="${mode === id}" class="fc-menu-radio${mode === id ? ' on' : ''}"
      onclick="fcMenuClose();focusedSwitch('${id}')"><span class="fc-pt${mode === id ? '' : ' q'}" aria-hidden="true"></span><span class="fc-menu-l">${label}</span><span class="fc-menu-n">${note}</span></button>`;
  m.innerHTML = `
    <div class="fc-menu-who"><div class="fc-bright">${escHtml(me.name || fcFirstName(me) || 'You')}</div><div class="fc-muted fc-small">${escHtml(me.email || '')}</div></div>
    <div class="fc-lab fc-menu-h">View</div>
    ${item('focused', 'Focused', 'calm')}
    ${item('extended', 'Extended', 'everything')}
    <div class="fc-menu-sep"></div>
    ${typeof castOpen === 'function' ? `<button type="button" role="menuitem" class="fc-menu-item" onclick="fcMenuClose();castOpen('ambient')"><span aria-hidden="true" style="width:18px;text-align:center">⎘</span><span>Cast to a screen</span></button>` : ''}
    <button type="button" role="menuitem" class="fc-menu-item" onclick="fcGo('settings')">${fcIcon('gear', 18)}<span>Settings</span></button>
    <button type="button" role="menuitem" class="fc-menu-item" onclick="fcSignOut()">${fcIcon('out', 18)}<span>Sign out</span></button>`;
  m.hidden = false;
  document.getElementById('fc-avatar-btn')?.setAttribute('aria-expanded', 'true');
  m.querySelector('button')?.focus();
  setTimeout(() => document.addEventListener('pointerdown', _fcMenuOutside, true), 0);
  document.addEventListener('keydown', _fcMenuKey);
}

function fcMenuClose() {
  const m = document.getElementById('fc-menu');
  if (!m || m.hidden) return;
  m.hidden = true;
  document.getElementById('fc-avatar-btn')?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', _fcMenuOutside, true);
  document.removeEventListener('keydown', _fcMenuKey);
}

function _fcMenuOutside(e) {
  if (!e.target.closest('#fc-menu') && !e.target.closest('#fc-avatar-btn')) fcMenuClose();
}
function _fcMenuKey(e) { if (e.key === 'Escape') fcMenuClose(); }

async function fcSignOut() {
  fcMenuClose();
  if (typeof accountSignOut === 'function') return accountSignOut();
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* signed out or gone */ }
  location.assign('/login');
}

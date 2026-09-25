/* ═══════════════════════════════════════════════════════
   Settings → General: the signed-in account — who, which role, the password,
   and signing out. See docs/design/auth.md.
   ═══════════════════════════════════════════════════════ */

async function accountLoad() {
  const pane = document.getElementById('sp-general');
  if (!pane) return;
  let card = document.getElementById('account-card');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'account-card';
    pane.prepend(card);
  }
  let me;
  try { me = await apiFetch('/api/auth/me'); }
  catch (e) { card.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  card.innerHTML = `
    <div class="card-title" style="display:flex;align-items:center;gap:8px">
      Account
      <button class="btn btn-xs" onclick="accountPassword()">Change password</button>
      <button class="btn btn-xs" onclick="accountSignOutOthers()" title="End every other session of this account">Sign out other devices</button>
      <button class="btn btn-xs btn-amber" onclick="accountSignOut()">Sign out</button>
    </div>
    <div class="snap-item" style="margin:0">
      <div style="min-width:0">
        <div class="snap-name">${escHtml(me.name || me.email)}</div>
        <div class="snap-date">${escHtml(me.email)} · ${escHtml(me.role)}</div>
      </div>
    </div>
    <span class="status-line" id="account-status"></span>`;
}

function accountPassword() {
  appPrompt('Your current password:', current => {
    appPrompt('New password (10 characters or more). Your other sessions will be signed out:', async password => {
      const st = document.getElementById('account-status');
      try {
        await apiFetch('/api/auth/password', { method: 'POST', body: { current, password } });
        setStatus(st, '✓ Password changed. Other sessions were signed out.', 'ok');
      } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
    }, '', { secret: true });
  }, '', { secret: true });
}

function accountSignOutOthers() {
  appConfirm('Sign out every other session of this account — other browsers, the desktop app, anywhere else it is signed in?', async () => {
    const st = document.getElementById('account-status');
    try { await apiFetch('/api/auth/sessions', { method: 'DELETE' }); setStatus(st, '✓ Every other session was signed out.', 'ok'); }
    catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
  });
}

async function accountSignOut() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  location.assign('/login');
}

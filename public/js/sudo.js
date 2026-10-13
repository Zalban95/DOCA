/* ═══════════════════════════════════════════════════════
   DOCA PANEL — SUDO PASSWORD PROMPT (reusable)

   Usage:
     sudoAsk('Install requires sudo access', password => {
       // password is the string the user typed, or null on cancel
     });
   ═══════════════════════════════════════════════════════ */

function sudoAsk(message, onResult) {
  const modal   = document.getElementById('sudo-modal');
  const msgEl   = document.getElementById('sudo-modal-message');
  const input   = document.getElementById('sudo-modal-input');
  const btnOk   = document.getElementById('sudo-modal-ok');
  const btnCan  = document.getElementById('sudo-modal-cancel');

  if (!modal) {
    // Fallback: browser prompt (should never happen if HTML is correct)
    const pw = window.prompt(message || 'Enter sudo password:');
    onResult(pw);
    return;
  }

  // Not the panel's password (the guarded switches ask for that one, in a dialog that looks alike): the machine's own,
  // which sudo checks — found 2026-10-13, when the panel's was typed here and the install failed.
  const say = hub => `${message || 'This needs administrator rights.'} Type the password of your account on ${hub} — the one sudo asks for, not your sign-in to the panel.`;
  if (msgEl) {
    msgEl.textContent = say('this machine');
    apiFetch('/api/auth/me').then(me => { if (me?.hub && modal.classList.contains('open')) msgEl.textContent = say(me.hub); }).catch(() => {});
  }
  if (input) { input.value = ''; }
  modal.classList.add('open');
  requestAnimationFrame(() => { if (input) input.focus(); });

  const cleanup = () => {
    modal.classList.remove('open');
    if (input) input.value = '';
    btnOk.onclick  = null;
    btnCan.onclick = null;
  };

  const confirm = () => {
    const pw = input ? input.value : '';
    cleanup();
    onResult(pw);
  };

  const cancel = () => {
    cleanup();
    onResult(null);
  };

  btnOk.onclick  = confirm;
  btnCan.onclick = cancel;

  // Enter key submits
  if (input) {
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
  }
}

function sudoClose() {
  const modal = document.getElementById('sudo-modal');
  if (modal) modal.classList.remove('open');
  const input = document.getElementById('sudo-modal-input');
  if (input) { input.value = ''; input.onkeydown = null; }
}

/* ═══════════════════════════════════════════════════════
   In-app prompt, confirm and alert modals (replace the browser's own).
   ═══════════════════════════════════════════════════════ */

/**
 * Show a styled in-app prompt modal (replaces browser prompt()).
 * @param {string} message
 * @param {Function} onSubmit - called with the entered string
 * @param {string} [defaultValue]
 * @param {{ allowEmpty?: boolean, secret?: boolean }} [opts] - `allowEmpty` for a prompt whose
 *   answer is optional, where OK doing nothing would look broken; `secret` for a
 *   password: masked, not trimmed, and wiped from the field when the modal closes
 */
function appPrompt(message, onSubmit, defaultValue, opts = {}) {
  const modal = document.getElementById('app-prompt-modal');
  const msgEl = document.getElementById('app-prompt-message');
  const input = document.getElementById('app-prompt-input');
  const btnOk = document.getElementById('app-prompt-ok');
  const btnCan = document.getElementById('app-prompt-cancel');
  if (!modal) { const v = prompt(message, defaultValue || ''); if (v !== null) onSubmit(v); return; }

  msgEl.textContent = message;
  input.type  = opts.secret ? 'password' : 'text';
  input.value = defaultValue || '';
  modal.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 50);

  const cleanup = () => {
    modal.classList.remove('open');
    if (opts.secret) { input.value = ''; input.type = 'text'; }
    btnOk.onclick = null;
    btnCan.onclick = null;
    input.onkeydown = null;
  };

  const submit = () => {
    const val = opts.secret ? input.value : input.value.trim();
    if (!val && !opts.allowEmpty) return;
    cleanup();
    onSubmit(val);
  };

  btnOk.onclick = submit;
  btnCan.onclick = cleanup;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') cleanup();
  };
}

/**
 * Show a styled in-app confirmation modal.
 * @param {string} message
 * @param {Function} onConfirm
 * @param {Function} [onCancel]
 */
function appConfirm(message, onConfirm, onCancel) {
  const modal   = document.getElementById('app-confirm-modal');
  const msgEl   = document.getElementById('app-confirm-message');
  const btnOk   = document.getElementById('app-confirm-ok');
  const btnCan  = document.getElementById('app-confirm-cancel');
  if (!modal) { if (confirm(message)) onConfirm(); else if (onCancel) onCancel(); return; }

  msgEl.textContent = message;
  modal.classList.add('open');

  const cleanup = () => {
    modal.classList.remove('open');
    btnOk.onclick   = null;
    btnCan.onclick  = null;
  };

  btnOk.onclick  = () => { cleanup(); onConfirm(); };
  btnCan.onclick = () => { cleanup(); if (onCancel) onCancel(); };
}

/**
 * Show a one-button in-app notice (replaces browser alert()).
 * Reuses the confirm modal with the Cancel button hidden.
 * @param {string} message
 * @param {Function} [onClose]
 */
function appAlert(message, onClose) {
  const modal  = document.getElementById('app-confirm-modal');
  const msgEl  = document.getElementById('app-confirm-message');
  const btnOk  = document.getElementById('app-confirm-ok');
  const btnCan = document.getElementById('app-confirm-cancel');
  if (!modal) { alert(message); if (onClose) onClose(); return; }

  msgEl.textContent = message;
  btnCan.style.display = 'none';
  const prevOkClass = btnOk.className;
  btnOk.className = 'btn btn-sm btn-blue';
  btnOk.textContent = 'OK';
  modal.classList.add('open');

  btnOk.onclick = () => {
    modal.classList.remove('open');
    btnCan.style.display = '';
    btnOk.className = prevOkClass;
    btnOk.textContent = 'Confirm';
    btnOk.onclick = null;
    if (onClose) onClose();
  };
}

/**
 * A question with more answers than yes and no, in the same modal.
 * @param {string} message
 * @param {{ label: string, value: any, cls?: string }[]} choices  left to right; the last is the default
 * @param {(value: any) => void} onPick  called with the chosen value (Escape/backdrop never picks)
 */
function appChoose(message, choices, onPick) {
  const modal = document.getElementById('app-confirm-modal');
  const actions = modal?.querySelector('.app-confirm-actions');
  if (!modal || !actions) { if (confirm(message)) onPick(choices.at(-1).value); return; }
  document.getElementById('app-confirm-message').textContent = message;
  const kept = [...actions.children];
  kept.forEach(el => { el.style.display = 'none'; });
  const done = value => {
    modal.classList.remove('open');
    actions.querySelectorAll('.app-choose-btn').forEach(b => b.remove());
    kept.forEach(el => { el.style.display = ''; });
    onPick(value);
  };
  for (const c of choices) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-sm app-choose-btn ${c.cls || ''}`.trim();
    b.textContent = c.label;
    b.onclick = () => done(c.value);
    actions.appendChild(b);
  }
  modal.classList.add('open');
}

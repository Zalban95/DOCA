/* ═══════════════════════════════════════════════════════
   In-app prompt, confirm and alert modals (replace the browser's own).
   ═══════════════════════════════════════════════════════ */

/**
 * Escape answers an open dialog the way its Cancel does (deep test B, C6: the confirmations, the machine-stop questions
 * among them, ignored Escape, and a choice had no way out at all). Listened for on the document while the dialog is
 * open, so it works wherever the focus is; returns the function that stops listening.
 */
function _dialogEscape(onEscape) {
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); } };
  document.addEventListener('keydown', key, true);
  return () => document.removeEventListener('keydown', key, true);
}

/**
 * Show a styled in-app prompt modal (replaces browser prompt()).
 * @param {string} message
 * @param {Function} onSubmit - called with the entered string
 * @param {string} [defaultValue]
 * @param {{ allowEmpty?: boolean, secret?: boolean, onCancel?: Function }} [opts] - `allowEmpty` for a prompt whose
 *   answer is optional, where OK doing nothing would look broken; `secret` for a
 *   password: masked, not trimmed, and wiped from the field when the modal closes; `onCancel` when it is closed without an answer
 */
function appPrompt(message, onSubmit, defaultValue, opts = {}) {
  const modal = document.getElementById('app-prompt-modal');
  const msgEl = document.getElementById('app-prompt-message');
  const input = document.getElementById('app-prompt-input');
  const btnOk = document.getElementById('app-prompt-ok');
  const btnCan = document.getElementById('app-prompt-cancel');
  if (!modal) { const v = prompt(message, defaultValue || ''); if (v !== null) onSubmit(v); else opts.onCancel?.(); return; }

  msgEl.textContent = message;
  input.type  = opts.secret ? 'password' : 'text';
  input.value = defaultValue || '';
  modal.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 50);

  let unEscape = () => {};
  const cleanup = () => {
    modal.classList.remove('open');
    if (opts.secret) { input.value = ''; input.type = 'text'; }
    btnOk.onclick = null;
    btnCan.onclick = null;
    input.onkeydown = null;
    unEscape();
  };

  const submit = () => {
    const val = opts.secret ? input.value : input.value.trim();
    if (!val && !opts.allowEmpty) return;
    cleanup();
    onSubmit(val);
  };

  btnOk.onclick = submit;
  const cancel = () => { cleanup(); opts.onCancel?.(); };
  btnCan.onclick = cancel;
  unEscape = _dialogEscape(cancel);
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
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

  let unEscape = () => {};
  const cleanup = () => {
    modal.classList.remove('open');
    btnOk.onclick   = null;
    btnCan.onclick  = null;
    unEscape();
  };

  btnOk.onclick  = () => { cleanup(); onConfirm(); };
  btnCan.onclick = () => { cleanup(); if (onCancel) onCancel(); };
  unEscape = _dialogEscape(btnCan.onclick);
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

  let unEscape = () => {};
  btnOk.onclick = () => {
    modal.classList.remove('open');
    btnCan.style.display = '';
    btnOk.className = prevOkClass;
    btnOk.textContent = 'Confirm';
    btnOk.onclick = null;
    unEscape();
    if (onClose) onClose();
  };
  unEscape = _dialogEscape(btnOk.onclick);
}

/**
 * A question with more answers than yes and no, in the same modal.
 * @param {string} message
 * @param {{ label: string, value: any, cls?: string }[]} choices  left to right; the last is the default
 * @param {(value: any) => void} onPick  called with the chosen value. A choice labelled Cancel is what Escape picks;
 *   without one the modal's own Cancel is shown, and it and Escape close it without picking.
 */
function appChoose(message, choices, onPick) {
  const modal = document.getElementById('app-confirm-modal');
  const actions = modal?.querySelector('.app-confirm-actions');
  if (!modal || !actions) { if (confirm(message)) onPick(choices.at(-1).value); return; }
  document.getElementById('app-confirm-message').textContent = message;
  const kept = [...actions.children];
  const own = choices.find(c => /^cancel$/i.test(String(c.label).trim()));
  const btnCan = document.getElementById('app-confirm-cancel');
  kept.forEach(el => { el.style.display = !own && el === btnCan ? '' : 'none'; });
  let unEscape = () => {};
  const close = () => {
    modal.classList.remove('open');
    actions.querySelectorAll('.app-choose-btn').forEach(b => b.remove());
    kept.forEach(el => { el.style.display = ''; });
    if (btnCan) btnCan.onclick = null;
    unEscape();
  };
  const done = value => { close(); onPick(value); };
  if (!own && btnCan) btnCan.onclick = close;
  unEscape = _dialogEscape(own ? () => done(own.value) : close);
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

/**
 * Escape closes the panel's other windows (.modal-overlay) the way a click beside them does: it clicks the backdrop of
 * the topmost open one, so each window's own close runs and one that does not close on its backdrop stays. A question
 * that must be answered is left alone: the approval popup (every button is a decision) and the first-run choice.
 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const open = [...document.querySelectorAll('.modal-overlay')]
    .filter(o => !o.matches('.approval-overlay, #guided-welcome') && getComputedStyle(o).display !== 'none');
  const top = open.at(-1);
  if (top) top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

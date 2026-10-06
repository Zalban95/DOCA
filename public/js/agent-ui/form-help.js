/* ✨ Ask the agent, on every form (asked 2026-10-06). A settings card or an edit form with fields to fill gets the
   button; it opens the chat with that form's own question and what its fields hold — the name and label of each, the
   value of each, except that a password, token, key or header is only "filled" or "empty". The agent answers as in
   any conversation and may fill fields with `form_fill`: the values land in this form as a draft, marked, and nothing
   is saved until the person presses the form's own Save. Its tool never touches a secret field. */
let _formHelpN = 0;
const _formHelpForms = new Map();   // form id → its element
const FORM_HELP_SECRET = /pass|token|secret|api.?key|bearer|authori[sz]ation|header|credential|cookie/i;

/** Every card and form on the page with two or more fields to fill, given its button once. */
function formHelpScan(root = document) {
  for (const box of root.querySelectorAll('.card, #mcp-form')) {
    if (box.dataset.helpId || box.closest('[data-help-id]') !== box && box.closest('[data-help-id]')) continue;
    if (_formHelpFields(box).length < 2) continue;
    const id = `form${++_formHelpN}`;
    box.dataset.helpId = id;
    _formHelpForms.set(id, box);
    const btn = Object.assign(document.createElement('button'), { className: 'btn btn-xs form-help-btn', type: 'button', textContent: '✨ Ask the agent',
      title: 'The agent sees this form (never its passwords or tokens), explains what goes where and can fill it as a draft for you to save' });
    btn.onclick = e => { e.stopPropagation(); formHelpAsk(id); };
    const title = box.querySelector('.card-title');
    if (title) title.append(btn); else box.prepend(btn);
  }
}

function _formHelpFields(box) {
  return [...box.querySelectorAll('input, textarea, select')].filter(el => !['hidden', 'button', 'submit', 'file', 'range'].includes(el.type) && !el.closest('.form-help-skip'));
}

function _formHelpLabel(el) {
  const l = el.labels?.[0]?.textContent || el.closest('label')?.textContent || el.previousElementSibling?.textContent
    || el.closest('div')?.querySelector('label')?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '';
  return l.replace(/\s+/g, ' ').trim().slice(0, 80);
}

const _formHelpIsSecret = el => el.type === 'password' || FORM_HELP_SECRET.test(`${el.id} ${el.name} ${_formHelpLabel(el)}`);

/** Open the chat with this form's question and its fields (no secret's value), as an ordinary message. */
function formHelpAsk(id) {
  const box = _formHelpForms.get(id);
  if (!box) return;
  const title = (box.querySelector('.card-title')?.firstChild?.textContent || box.querySelector('h3, h4, .card-title')?.textContent || 'this form').replace(/✨.*$/, '').trim();
  const where = [document.querySelector('.nav-item.active, .tab-btn.active')?.textContent, document.querySelector('.settings-subnav-btn.active')?.textContent]
    .filter(Boolean).map(s => s.trim()).join(' → ');
  const lines = _formHelpFields(box).map((el, i) => {
    el.dataset.helpField ||= el.id || `f${i + 1}`;
    const v = el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.value;
    const shown = _formHelpIsSecret(el) ? (String(v).trim() && !/^Bearer\s*$/i.test(String(v).trim()) ? '(filled — not shown)' : '(empty)')
      : el.tagName === 'SELECT' ? `${v} (choices: ${[...el.options].map(o => o.value).slice(0, 12).join(', ')})` : JSON.stringify(String(v).slice(0, 300));
    return `- ${_formHelpLabel(el) || el.dataset.helpField} [${el.dataset.helpField}${el.disabled ? ', locked' : ''}]: ${shown}`;
  });
  const message = `Help me fill "${title}"${where ? ` (${where})` : ''}: what each field means, what to put here for my setup, and what is still missing.\n\n`
    + `The form (id ${id}) has these fields — secrets show only whether they are filled:\n${lines.join('\n')}\n\n`
    + 'You may fill fields as a draft with form_fill (form and field ids above); I review and save. Never a secret field — tell me where to get it instead.';
  if (typeof chatOpen !== 'undefined' && !chatOpen) toggleChat();
  const input = document.getElementById('chat-input');
  if (!input || typeof chatSend !== 'function') return;
  input.value = message;
  chatSend();
}

/** The agent's form_fill: values into the form as a draft, marked; secrets and locked fields refused. */
function formHelpFill(evt) {
  const box = _formHelpForms.get(evt.form);
  if (!box || !box.isConnected) return;
  for (const [key, value] of Object.entries(evt.fields || {})) {
    const el = _formHelpFields(box).find(f => (f.dataset.helpField || f.id) === key);
    if (!el || el.disabled || _formHelpIsSecret(el)) continue;
    if (el.type === 'checkbox') el.checked = value === true || value === 'on' || value === 'true';
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    el.classList.add('form-help-filled');
    setTimeout(() => el.classList.remove('form-help-filled'), 6000);
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
  let t = null;
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => formHelpScan(), 250); }).observe(document.body, { childList: true, subtree: true });
    formHelpScan();
  });
}

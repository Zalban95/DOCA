/* ✨ Ask the agent, on every form (asked 2026-10-06). A settings card or an edit form with fields to fill gets the
   button; it opens the chat ready to ask about that form, with what its fields hold — the name and label of each, the
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

/* What the person sees and what the agent reads are kept apart (self-test round two, C3): "✨ Ask the agent" used to
   type a long message the person never wrote into the chat and send it — "who wrote that?". Now the chat opens with
   "Help with: <form>" in the box, theirs to change, focused and not sent, and a chip saying the form's details go
   with it. On Send the details travel after a marker line; every place a person reads their own message folds them
   into a closed "Form details the panel attached" (formHelpTextInto). */
const FORM_HELP_MARK = '\n\n[Form details attached by the panel — not the person\'s words]\n';
let _formHelpPending = null;   // { title, context } until the next Send, or the chip's ×

/** Open the chat ready to ask about this form: a short message of the person's own, the form's details as context. */
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
  const context = `The person is looking at the form "${title}"${where ? ` (${where})` : ''} and wants help with it: what each field means, `
    + 'what to put there for their set-up, and what is still missing.\n'
    + `The form (id ${id}) has these fields — secrets show only whether they are filled:\n${lines.join('\n')}\n`
    + 'You may fill fields as a draft with form_fill (form and field ids above); the person reviews and saves. Never a secret field — say where to get it instead.';
  _formHelpPending = { title, context };
  if (typeof chatOpen !== 'undefined' && !chatOpen) toggleChat();
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = `Help with: ${title}`;
  _formHelpChip(title);
  input.focus();
  input.setSelectionRange?.(input.value.length, input.value.length);
}

/** The chip above the composer: which form goes with the message; × keeps the message and drops the form. */
function _formHelpChip(title) {
  const row = document.getElementById('chat-attachments');
  if (!row) return;
  row.querySelector('.form-help-chip')?.remove();
  const el = document.createElement('span');
  el.className = 'chat-chip form-help-chip';
  el.title = 'The form\'s fields go with your message so the agent can see them — never a password or token';
  const label = Object.assign(document.createElement('span'), { textContent: `📋 ${title} · its fields go with your message` });
  const drop = Object.assign(document.createElement('em'), { textContent: '×', title: 'Send without the form' });
  drop.onclick = () => { _formHelpPending = null; el.remove(); if (!row.children.length) row.style.display = 'none'; };
  el.append(label, drop);
  row.appendChild(el);
  row.style.display = '';
}

/** On Send: the message as the agent reads it — the person's words, then the form's details after the marker. */
function formHelpAttach(message) {
  const p = _formHelpPending;
  _formHelpPending = null;
  if (!p) return message;
  const box = document.getElementById('chat-messages');
  const mine = [...(box?.querySelectorAll('.chat-msg.user') || [])].pop();
  if (mine) formHelpTextInto(mine, mine.textContent + FORM_HELP_MARK + p.context);
  return message + FORM_HELP_MARK + p.context;
}

/** A person's message drawn as text, any form details the panel attached folded away under it. */
function formHelpTextInto(el, text) {
  const at = String(text).indexOf(FORM_HELP_MARK);
  if (at < 0) { el.textContent = text; return; }
  el.textContent = text.slice(0, at);
  const d = document.createElement('details');
  d.className = 'form-help-context';
  const sum = document.createElement('summary');
  sum.textContent = 'Form details the panel attached';
  const pre = document.createElement('div');
  pre.textContent = text.slice(at + FORM_HELP_MARK.length);
  d.append(sum, pre);
  el.appendChild(d);
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

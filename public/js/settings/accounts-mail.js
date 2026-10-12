/* ═══════════════════════════════════════════════════════
   Your accounts → the mail that was read (modules/accounts/triage): what
   needs you, what was handled, what was filed — and why, with who decided
   (the rules, the mail reader, or you). A wrong one is moved, and its sender
   keeps your rule. Drafts wait here for your Send: nothing is sent without
   it (or your own "send it" to the assistant). Your notes for the mail
   reader fold under Advanced.
   ═══════════════════════════════════════════════════════ */

const ACC_VERDICTS = [['needs-you', 'Needs you', 'pt-ask'], ['handled', 'Handled', 'pt-done'], ['filed', 'Filed', 'pt-stopped']];
let _accMailShow = 'needs-you';

async function accountsMailRender(accounts) {
  const el = document.getElementById('accounts-mail');
  if (!el) return;
  let t, dr, rules;
  try { [t, dr, rules] = await Promise.all([apiFetch('/api/accounts/mail/triage?limit=200'), apiFetch('/api/accounts/drafts'), apiFetch('/api/accounts/mail/rules')]); }
  catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  if (accounts && !accounts.length && !t.mails.length) { el.innerHTML = ''; return; }
  const rows = t.mails.filter(m => m.verdict === _accMailShow);
  el.innerHTML = `${dr.drafts.length ? `<div class="acc-sub">Drafts — not sent ${infoBtn('Mail the assistant or the mail reader wrote for you. Nothing is sent until you press Send (or tell the assistant to send that one now). Edit changes it first; Discard throws it away.')}</div>
      ${dr.drafts.map(accountsDraftHtml).join('')}` : ''}
    <div class="acc-sub">Your mail, read for you ${infoBtn('New mail sorted when its account is read: by rules first (newsletters, receipts, invitations, bills, notifications, your own sender rules), then by the mail reader for mail from people. Move a mail that was misjudged; its sender then always goes where you put it.')}</div>
    <div class="acc-tabs" role="tablist">${ACC_VERDICTS.map(([v, l, pt]) => `<button role="tab" class="acc-tab${v === _accMailShow ? ' on' : ''}" aria-selected="${v === _accMailShow}"
      onclick="_accMailShow=${jsArg(v)};accountsMailRender()"><span class="pt ${pt}" aria-hidden="true"></span>${l} <span class="acc-count">${t.counts[v] || 0}</span></button>`).join('')}</div>
    ${rows.length ? rows.slice(0, 50).map(accountsMailRowHtml).join('') : `<div class="placeholder">${_accMailShow === 'needs-you' ? 'Nothing needs you.' : 'None.'}</div>`}
    ${advancedFold(`<label class="svc-field" style="width:100%"><span class="field-label">Your notes for the mail reader ${infoBtn('In your own words, what matters to you — "anything from school needs me", "invoices from Acme are handled by my accountant". The mail reader reads them with every mail it decides.')}</span>
        <textarea class="input" id="acc-notes" rows="3" data-default="" placeholder="Anything from school needs me.">${escHtml(rules.rules.notes || '')}</textarea></label>
      <div class="desc" style="margin:6px 0">Sender rules ${infoBtn('Made when you move a mail: that sender (or @domain) always goes there, before any other rule. ✕ forgets one.')}</div>
      ${Object.entries(rules.rules.senders || {}).map(([k, v]) => `<div class="acc-line"><span class="acc-line-text">${escHtml(k)} → ${escHtml(v)}</span>
        <button class="btn btn-xs" onclick="accountsRuleForget(${jsArg(k)})" title="Forget this rule">✕</button></div>`).join('') || '<div class="placeholder">None yet.</div>'}
      <button class="btn btn-sm" style="margin-top:6px" onclick="accountsNotesSave()">Save notes</button>`,
      { id: 'accounts-mail-rules', label: 'Advanced — your rules for the mail reader', changed: rules.rules.notes || Object.keys(rules.rules.senders || {}).length ? 1 : 0 })}`;
}

function accountsMailRowHtml(m) {
  const pt = ACC_VERDICTS.find(v => v[0] === m.verdict)?.[2] || 'pt-stopped';
  const when = m.date ? new Date(m.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
  return `<div class="acc-line acc-mail"><span class="pt ${pt}" aria-hidden="true"></span>
    <span class="acc-line-text"><b>${escHtml(m.from?.name || m.from?.address || '')}</b> — ${escHtml(m.subject || '(no subject)')}
      <span class="desc"> · ${escHtml(m.why || '')} · ${m.by === 'reader' ? 'mail reader' : m.by === 'person' ? 'you' : 'rules'} · ${escHtml(when)}${m.draftId ? ' · a draft waits' : ''}</span></span>
    <select class="input acc-move" aria-label="Move to" onchange="accountsMailMove(${jsArg(m.accountId)}, ${jsArg(m.mailId)}, this.value)">
      <option value="">Move to…</option>${ACC_VERDICTS.filter(v => v[0] !== m.verdict).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
}

function accountsDraftHtml(d) {
  return `<div class="acc-draft" data-draft="${escHtml(d.id)}"><div class="acc-line"><span class="pt pt-ask" aria-hidden="true"></span>
    <span class="acc-line-text"><b>Draft — not sent</b> to ${escHtml(d.to.join(', '))}: ${escHtml(d.subject)}
      <span class="desc"> · by ${escHtml(d.by?.name || d.by?.kind || '')}${d.why ? ` · ${escHtml(d.why)}` : ''}</span></span>
    <button class="btn btn-xs btn-primary" onclick="accountsDraftSend(${jsArg(d.id)}, ${jsArg(d.to.join(', '))})">Send</button>
    <button class="btn btn-xs" onclick="accountsDraftEdit(${jsArg(d.id)})">Edit</button>
    <button class="btn btn-xs btn-red" onclick="accountsDraftDiscard(${jsArg(d.id)})">Discard</button></div>
    <pre class="acc-draft-body">${escHtml(d.body)}</pre></div>`;
}

async function accountsMailMove(account, mail, verdict) {
  if (!verdict) return;
  try { await apiFetch(`/api/accounts/mail/triage/${encodeURIComponent(account)}/${encodeURIComponent(mail)}`, { method: 'POST', body: { verdict } }); } catch (e) { appAlert(e.message); }
  accountsMailRender();
}

async function accountsNotesSave() {
  try { await apiFetch('/api/accounts/mail/rules', { method: 'PUT', body: { notes: document.getElementById('acc-notes').value } }); } catch (e) { return appAlert(e.message); }
  accountsMailRender();
}

async function accountsRuleForget(key) {
  const r = await apiFetch('/api/accounts/mail/rules');
  const senders = { ...r.rules.senders };
  delete senders[key];
  try { await apiFetch('/api/accounts/mail/rules', { method: 'PUT', body: { senders } }); } catch (e) { appAlert(e.message); }
  accountsMailRender();
}

function accountsDraftSend(id, to) {
  appConfirm(`Send this mail to ${to}? A sent mail cannot be unsent.`, async () => {
    try { await apiFetch(`/api/accounts/drafts/${encodeURIComponent(id)}/send`, { method: 'POST' }); } catch (e) { appAlert(e.message); }
    accountsMailRender();
    if (typeof accountsLogRender === 'function') accountsLogRender();
  });
}

function accountsDraftEdit(id) {
  const box = document.querySelector(`[data-draft="${CSS.escape(id)}"] .acc-draft-body`);
  if (!box) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<textarea class="input acc-draft-edit" rows="7" aria-label="The text of the mail"></textarea>
    <div class="toolbar" style="gap:6px;margin-top:4px"><button class="btn btn-sm" onclick="accountsDraftSave(${jsArg(id)}, this)">Save the text</button></div>`;
  wrap.querySelector('textarea').value = box.textContent;
  box.replaceWith(wrap);
  wrap.querySelector('textarea').focus();
}

async function accountsDraftSave(id, btn) {
  const body = btn.closest('.acc-draft').querySelector('.acc-draft-edit').value;
  try { await apiFetch(`/api/accounts/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { body } }); } catch (e) { return appAlert(e.message); }
  accountsMailRender();
}

function accountsDraftDiscard(id) {
  appConfirm('Discard this draft? It is not sent.', async () => {
    try { await apiFetch(`/api/accounts/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    accountsMailRender();
  });
}

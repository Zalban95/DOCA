/* ═══════════════════════════════════════════════════════
   Field → Connectors → Your accounts (modules/accounts; 2026-10-12):
   each person's own Google and Microsoft 365 accounts, as many as they need,
   connected with the hive's OAuth app. Each says what it may do (read and
   act, or read only), whether the agents may use it, and when the mail
   reader reads it; Read now, the mail that was read (accounts-mail.js), and
   the action log with Undo. Every person sees only their own: whose is the
   session, on the hub's side.
   ═══════════════════════════════════════════════════════ */

const ACC_READ_MODES = [['off', 'Only when I ask'], ['new', 'On every new mail'], ['every', 'Every few minutes'], ['times', 'At set times']];

async function accountsRender() {
  const el = document.getElementById('accounts-card');
  if (!el) return;
  let d;
  try { d = await apiFetch('/api/accounts'); } catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  el.dataset.helpAsk = 'Help me connect my own Google or Microsoft 365 account and choose when my mail is read.';
  const ready = d.providers.filter(p => p.ready && p.allowed);
  el.innerHTML = `<div class="card-title">Your accounts</div>
    <p class="desc" style="margin-bottom:8px">Your own Google and Microsoft 365 accounts, for your calendar and mail. Only you and the agents working for you use them.</p>
    <details class="desc page-about" style="margin:0 0 10px"><summary>How it works</summary>Connect signs you in at Google or Microsoft with the hive's
      app; your sign-in is kept on this machine, protected, and nobody — an admin included — can read it. "Read and act" lets the assistant add and
      move appointments, file mail and send what you decided to send; every change it makes is listed below with an Undo, and a mail it writes waits
      as a draft for your Send. "Read only" never changes anything. When the agents may not use an account, only this page and your own views read it.</details>
    ${d.accounts.length ? d.accounts.map(accountsRowHtml).join('') : emptyStateHtml({ title: 'No account connected yet', text: 'Connect one below to see your calendar and mail here and let the assistant help with them.' })}
    <div class="toolbar" style="gap:6px;margin-top:10px;flex-wrap:wrap;align-items:flex-end">
      ${ready.length ? `<label class="svc-field" style="width:auto"><span class="field-label">Service ${infoBtn('Which kind of account to connect. You can connect as many as you need, one at a time.')}</span>
        <select class="input" id="acc-provider">${ready.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.label)}</option>`).join('')}</select></label>
      <label class="svc-field" style="width:auto"><span class="field-label">Access ${infoBtn('Read and act (the default): calendar changes, filing mail and sending what you decide to send, each with Undo where it can be undone. Read only: the assistant only reads.')}</span>
        <select class="input" id="acc-access"><option value="full">Read and act</option><option value="read">Read only</option></select></label>
      <button class="btn btn-sm btn-primary" onclick="accountsConnect()">Connect</button>` : ''}
      ${d.providers.filter(p => !p.ready || !p.allowed).map(p => `<span class="desc">${escHtml(p.label)}: ${!p.allowed ? 'not included in your level — ask an admin' : 'an admin adds the hive\'s app first (Field → Connectors)'}.</span>`).join(' ')}
    </div>
    <div id="accounts-mail"></div>
    <div id="accounts-log"></div>`;
  if (typeof accountsMailRender === 'function') accountsMailRender(d.accounts);
  accountsLogRender();
}

function accountsRowHtml(a) {
  const r = a.reading || { mode: 'off' };
  const point = a.connected ? 'pt pt-up' : 'pt pt-err';
  return `<div class="acc-row" data-acc="${escHtml(a.id)}">
    <div class="acc-head"><span class="${point}" aria-hidden="true"></span>
      <span class="acc-name">${escHtml(a.label || a.account || a.providerLabel)}</span>
      <span class="desc">${escHtml(a.providerLabel)}${a.label && a.account ? ` · ${escHtml(a.account)}` : ''} · ${a.access === 'read' ? 'read only' : 'read and act'}${a.connected ? '' : ' · sign-in lost: connect it again'}</span>
      <span class="acc-acts">${rowActs([{ icon: 'refresh', label: 'Read its new mail now', onclick: `accountsReadNow(${jsArg(a.id)})` },
        { icon: 'edit', label: 'Rename', onclick: `accountsRename(${jsArg(a.id)}, ${jsArg(a.label || '')})`, more: true },
        { icon: 'remove', label: 'Disconnect', onclick: `accountsRemove(${jsArg(a.id)}, ${jsArg(a.account || a.providerLabel)})`, more: true }])}</span></div>
    <label class="acc-check"><input type="checkbox" class="switch"${a.orchestrator ? ' checked' : ''} onchange="accountsSet(${jsArg(a.id)}, {orchestrator: this.checked})">
      ✅ the Orchestrator may use it ${infoBtn('On (the default): the assistant and the agents working for you may read this account and, with "read and act", change it — each change listed below with an Undo. Off: only you and this page read it; the mail reader still reads it when you set a reading time.')}</label>
    <div class="toolbar acc-reading" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
      <label class="svc-field" style="width:auto"><span class="field-label">When the mail reader reads ${infoBtn('When new mail in this account is sorted into "needs you", "handled" and "filed": rules first (newsletters, receipts, invitations, bills, your own rules), then the mail reader for mail from people. "On every new mail" looks for new mail every 2 minutes — it costs nothing until one arrives. "Only when I ask": Read now.')}</span>
        <select class="input" data-f="mode" onchange="accountsReadingShow(this)">${ACC_READ_MODES.map(([v, l]) => `<option value="${v}"${r.mode === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="svc-field" style="width:110px${r.mode === 'every' ? '' : ';display:none'}" data-show="every"><span class="field-label">Minutes ${infoBtn('How often, from 5 to 1440 minutes.')}</span>
        <input class="input" data-f="every" type="number" min="5" max="1440" value="${escHtml(String(r.every || 30))}"></label>
      <label class="svc-field" style="width:170px${r.mode === 'times' ? '' : ';display:none'}" data-show="times"><span class="field-label">Times ${infoBtn('Times of your day, separated by commas, like 08:00, 13:00, 18:00.')}</span>
        <input class="input" data-f="times" placeholder="08:00, 13:00" value="${escHtml((r.times || []).join(', '))}"></label>
      <button class="btn btn-sm" onclick="accountsReadingSave(${jsArg(a.id)})">Save</button>
      <span class="status-line" data-f="status"></span></div>
    ${advancedFold(`<label class="acc-check"><input type="checkbox" class="switch" data-f="reader" data-default="true"${r.reader !== false ? ' checked' : ''}>
      The mail reader decides mail from people ${infoBtn('On (the default): mail from people that the rules cannot place is read by the mail reader, a specialist that sees only that mail, your rules and the conversation it belongs to. Off: such mail is simply marked "needs you", and no model reads your mail.')}</label>`,
      { id: 'account-reader', label: 'Advanced — the mail reader' })}
  </div>`;
}

function accountsReadingShow(sel) {
  const row = sel.closest('.acc-row');
  row.querySelectorAll('[data-show]').forEach(x => { x.style.display = x.dataset.show === sel.value ? '' : 'none'; });
}

async function accountsConnect() {
  const provider = document.getElementById('acc-provider')?.value, access = document.getElementById('acc-access')?.value || 'full';
  try {
    const r = await apiFetch('/api/accounts/connect', { method: 'POST', body: { provider, access } });
    window.open(r.url, '_blank', 'noopener');
    appAlert('Sign in on the page that opened and allow access; then come back here — the account appears in this list.');
  } catch (e) { appAlert(e.message); }
}

async function accountsSet(id, body) {
  try { await apiFetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body }); } catch (e) { appAlert(e.message); }
  accountsRender();
}

function accountsRename(id, label) {
  appPrompt('A name for this account (empty: its address)', v => accountsSet(id, { label: v || '' }), label);
}

async function accountsReadingSave(id) {
  const row = document.querySelector(`.acc-row[data-acc="${CSS.escape(id)}"]`);
  const f = n => row.querySelector(`[data-f="${n}"]`);
  const body = { mode: f('mode').value, every: Number(f('every').value), times: f('times').value.split(/[,\s]+/).filter(Boolean), reader: f('reader').checked };
  try {
    await apiFetch(`/api/accounts/${encodeURIComponent(id)}/reading`, { method: 'POST', body });
    f('status').textContent = 'Saved';
  } catch (e) { f('status').textContent = e.message; }
}

async function accountsReadNow(id) {
  const row = document.querySelector(`.acc-row[data-acc="${CSS.escape(id)}"] [data-f="status"]`);
  if (row) row.textContent = 'Reading…';
  try {
    const r = await apiFetch(`/api/accounts/${encodeURIComponent(id)}/read`, { method: 'POST' });
    if (row) row.textContent = `${r.read} new: ${r['needs-you']} need you, ${r.handled} handled, ${r.filed} filed${r.errors?.length ? ` — ${r.errors[0]}` : ''}`;
  } catch (e) { if (row) row.textContent = e.message; }
  if (typeof accountsMailRender === 'function') accountsMailRender();
}

function accountsRemove(id, name) {
  appConfirm(`Disconnect ${name}? Its sign-in is forgotten here and its reading times stop; what was changed stays in the log.`, async () => {
    try { await apiFetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    accountsRender();
  });
}

async function accountsLogRender() {
  const el = document.getElementById('accounts-log');
  if (!el) return;
  let d;
  try { d = await apiFetch('/api/accounts/actions?limit=30'); } catch { el.innerHTML = ''; return; }
  const when = t => { try { return new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch { return t; } };
  el.innerHTML = `<div class="acc-sub">What the assistant changed ${infoBtn('Every change made in your calendar and mail, newest first, with who made it. Undo does the opposite change; an undo can itself be undone, which brings the change back. A sent mail cannot be unsent.')}</div>
    ${d.actions.length ? d.actions.map(a => `<div class="acc-line"><span class="pt ${a.undoneBy ? 'pt-stopped' : 'pt-done'}" aria-hidden="true"></span>
      <span class="acc-line-text">${escHtml(a.summary)}<span class="desc"> · ${escHtml(when(a.at))} · ${escHtml(a.by?.name || a.by?.kind || '')}${a.undoneBy ? ' · undone' : a.undoOf ? ' · an undo' : ''}</span></span>
      ${a.undoable && !a.undoneBy ? `<button class="btn btn-xs" onclick="accountsUndo(${jsArg(a.id)}, ${jsArg(a.summary)})">Undo</button>` : ''}</div>`).join('')
      : '<div class="placeholder">Nothing changed yet.</div>'}`;
}

function accountsUndo(id, summary) {
  appConfirm(`Undo "${summary}"? You can undo the undo afterwards.`, async () => {
    try { await apiFetch(`/api/accounts/actions/${encodeURIComponent(id)}/undo`, { method: 'POST' }); } catch (e) { appAlert(e.message); }
    accountsLogRender();
  });
}

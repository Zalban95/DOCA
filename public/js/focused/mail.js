/* Mail in the Focused view: what the mail reading decided for the person's own accounts (modules/accounts/triage —
   GET /api/accounts/mail/triage), in three: needs you (amber, with the drafted reply waiting for Send), handled and
   filed (grey) — and the drafts that wait. The words are the reading's own (sender, subject, why), drawn as they come.
   Another source can still register (focusedMailRegister: {source, arrived?, needs: [{title, line}], answered, handled});
   the accounts are the first. With no account, the section says where to connect one. */
const FOCUSED_MAIL = [];

/** A mail source beside the person's accounts: an async function answering today's mail, or null. */
function focusedMailRegister(fn) { if (typeof fn === 'function' && !FOCUSED_MAIL.includes(fn)) FOCUSED_MAIL.push(fn); }

/** The person's accounts and what their mail reading decided (each read kept a few seconds). */
async function fcMailAccounts() {
  const [acc, tri, drafts] = await Promise.all([
    fcGet('/api/accounts', 30000).catch(() => ({ accounts: [] })),
    fcGet('/api/accounts/mail/triage?limit=60', 8000).catch(() => ({ mails: [], counts: {} })),
    fcDrafts(),
  ]);
  return { accounts: acc.accounts || [], providers: acc.providers || [], mails: tri.mails || [], counts: tri.counts || {}, drafts: drafts.filter(d => !d.state || d.state === 'waiting') };
}

/** Home's "Needs you": mail that needs the person and drafts that wait, as rows with one action each; and a grey line. */
async function fcMailNeeds() {
  const m = await fcMailAccounts();
  const needs = m.mails.filter(x => x.verdict === 'needs-you');
  const quiet = m.mails.filter(x => x.verdict !== 'needs-you').length;
  return { needs, drafts: m.drafts, quiet, accounts: m.accounts.length };
}

/** One line for Home: what was handled or filed quietly. */
async function fcMailSummary() {
  const n = await fcMailNeeds().catch(() => null);
  if (n?.quiet) return { handled: `${n.quiet} mail${n.quiet === 1 ? '' : 's'} handled or filed for you` };
  for (const src of FOCUSED_MAIL) { try { const r = await src(); if (r?.handled?.length) return { handled: `${r.handled.length} messages handled for you` }; } catch { /* the next */ } }
  return null;
}

const _fcFrom = x => x.from?.name || x.from?.address || 'Someone';

/** The Mail section of the Calendar and Mail screen. */
async function fcMailSection(box) {
  const m = await fcMailAccounts();
  if (!box?.isConnected) return;
  const src = document.getElementById('fc-mail-src');
  if (!m.accounts.length) {
    let other = null;
    for (const s of FOCUSED_MAIL) { try { other = await s(); if (other) break; } catch { /* the next */ } }
    if (other) return _fcMailOther(box, other);
    box.innerHTML = `<div class="fc-row-empty"><div class="fc-muted fc-small">Connect your own Google or Microsoft 365 account and ${escHtml(fcProduct())} reads your mail for you: what needs you first, the rest filed.</div>
      <button type="button" class="fc-btn fc-sm" onclick="fcGo('settings');setTimeout(()=>document.getElementById('fc-set-accounts')?.scrollIntoView({block:'start'}),300)">Connect an account</button></div>`;
    return;
  }
  if (src) src.textContent = `${m.accounts.map(a => a.label || a.account || a.providerLabel).join(' · ')}${m.counts['needs-you'] != null ? ` · ${m.counts['needs-you']} need you` : ''}`;
  const row = (x, pt, act) => `<div class="fc-row"><span class="fc-pt${pt}" aria-hidden="true"></span><div class="fc-row-b"><div class="fc-bright">${escHtml(_fcFrom(x))} — ${escHtml(x.subject || '(no subject)')}</div>
    <div class="fc-muted fc-small">${escHtml(x.why || x.snippet || '')}</div></div>${act || ''}</div>`;
  const needs = m.mails.filter(x => x.verdict === 'needs-you'), handled = m.mails.filter(x => x.verdict === 'handled'), filed = m.mails.filter(x => x.verdict === 'filed');
  box.innerHTML = `<div class="fc-mail-cols">
      <div><div class="fc-lab fc-mail-h">Needs you</div>${needs.map(x => row(x, ' a', x.draftId && m.drafts.some(d => d.id === x.draftId)
        ? `<button type="button" class="fc-btn fc-sm" onclick="document.querySelector('[data-draft=&quot;${escHtml(x.draftId)}&quot;]')?.scrollIntoView({block:'center',behavior:'smooth'})">Review</button>` : '')).join('') || '<div class="fc-muted fc-small fc-row-empty">Nothing needs you.</div>'}
        <div id="fc-mail-drafts"></div></div>
      <div><div class="fc-lab fc-mail-h">Handled for you</div>${[...handled.map(x => row(x, '')), ...filed.map(x => row(x, ' q'))].slice(0, 12).join('') || '<div class="fc-muted fc-small fc-row-empty">Nothing yet today.</div>'}
        <button type="button" class="fc-btn fc-sm fc-q fc-mail-read" onclick="fcMailReadNow(this)">Read my mail now</button></div></div>`;
  const dbox = document.getElementById('fc-mail-drafts');
  m.drafts.forEach(d => dbox.append(fcDraftCard(d)));
}

/** Read now, on every account (POST /api/accounts/:id/read): the rows come back on the live feed. */
async function fcMailReadNow(btn) {
  btn.disabled = true; btn.textContent = 'Reading…';
  const { accounts } = await fcMailAccounts();
  await Promise.all(accounts.map(a => apiFetch(`/api/accounts/${encodeURIComponent(a.id)}/read`, { method: 'POST' }).catch(() => null)));
  fcForget('/api/accounts'); fcEverydayRedraw();
}

function _fcMailOther(box, m) {
  const row = (r, pt) => `<div class="fc-row"><span class="fc-pt${pt}" aria-hidden="true"></span><div class="fc-row-b">${r.title ? `<div class="fc-bright">${escHtml(r.title)}</div>` : ''}<div class="${r.title ? 'fc-muted fc-small' : 'fc-muted'}">${escHtml(r.line || '')}</div></div></div>`;
  box.innerHTML = `<div class="fc-mail-cols"><div>${[...(m.needs || []).map(r => row(r, ' a')), ...(m.answered || []).map(r => row(r, ''))].join('')}</div><div>${(m.handled || []).map(r => row(r, ' q')).join('')}</div></div>`;
}

/* The person's own calendar and mail (modules/accounts, "Your own accounts" in AGENTS.md) in the Focused view: what the
   assistant changed — each from the action log, with its mechanical Undo (and undo the undo) — and the drafts waiting for
   the person's Send. A turn's `calendar` and `mail` tools emit `{type: 'everyday', action | draft}`; a reloaded
   conversation finds the same ids in the tools' results ("Logged as act_…", "drf_…") and reads them back here, so a card
   is always the record's present state: undone, sent, discarded. Sending is the person's click and sends for real. */
const FC_ACT = {
  'calendar.create': ['Added to calendar', 'calendar'], 'calendar.change': ['Moved in your calendar', 'calendar'],
  'calendar.delete': ['Removed from your calendar', 'calendar'], 'mail.archive': ['Filed', 'mail'], 'mail.unarchive': ['Back in your inbox', 'mail'],
  'mail.label': ['Labelled', 'mail'], 'mail.unlabel': ['Label taken off', 'mail'], 'mail.send': ['Sent', 'mail'],
};

const fcActions = () => fcGet('/api/accounts/actions?limit=200', 4000).then(r => r.actions || []).catch(() => []);
const fcDrafts = () => fcGet('/api/accounts/drafts', 4000).then(r => r.drafts || []).catch(() => []);
const _fcEvWhen = ev => (ev?.start ? [_fcWhen(ev.start), ev.where].filter(Boolean).join(' · ') : '');

/** A card for one logged action: what changed, and Undo (or, once undone, bring it back). */
function fcActionCard(a) {
  const [lab, domain] = FC_ACT[a.act] || [a.summary || 'Done', 'calendar'];
  const ev = a.after || a.before;
  const acts = [];
  if (domain === 'calendar') acts.push(['Open', () => fcGo('calendar')]);
  if (a.undoneBy) acts.push(['Bring it back', () => fcActionUndo(a.undoneBy, `Bring back “${ev?.title || a.summary}”?`), 'q']);
  else if (a.undoable) acts.push(['Undo', () => fcActionUndo(a.id, `Undo: ${a.summary}?`), 'q']);
  const el = fcCardEl({ lab: a.undoneBy ? `${lab} — undone` : lab, title: ev?.title || a.summary, line: ev ? _fcEvWhen(ev) : '', acts });
  el.dataset.action = a.id;
  if (a.undoneBy) el.classList.add('fc-undone');
  return el;
}

/** Undo (POST /api/accounts/actions/:id/undo), after the person confirms; the card is drawn again from the log. */
function fcActionUndo(id, question) {
  appConfirm(question, async () => {
    try { await apiFetch(`/api/accounts/actions/${encodeURIComponent(id)}/undo`, { method: 'POST' }); fcForget('/api/accounts'); fcToast('Undone.'); fcEverydayRedraw(); }
    catch (e) { appAlert(`Not undone: ${e.message}`); }
  });
}

/** A draft waiting for the person: To, subject and words, with Send (for real, after one question) and Edit (in place). */
function fcDraftCard(d) {
  const waiting = !d.state || d.state === 'waiting';
  const to = (d.to || []).join(', ');
  const el = fcCardEl({ lab: waiting ? 'Draft — not sent' : d.state === 'sent' ? 'Sent' : 'Draft put away', warn: waiting,
    line: [to && `To ${to}`, d.subject].filter(Boolean).join(' · '), text: String(d.body || '').slice(0, 400),
    acts: waiting ? [['Send', () => fcDraftSend(d), 'p'], ['Edit', () => fcDraftEdit(el, d)]] : [] });
  el.dataset.draft = d.id;
  return el;
}

function fcDraftSend(d) {
  appConfirm(`Send “${d.subject || 'this mail'}” to ${(d.to || []).join(', ')} now? A sent mail cannot be unsent.`, async () => {
    try { await apiFetch(`/api/accounts/drafts/${encodeURIComponent(d.id)}/send`, { method: 'POST' }); fcForget('/api/accounts'); fcToast('Sent.'); fcEverydayRedraw(); }
    catch (e) { appAlert(`Not sent: ${e.message}`); }
  });
}

/** Edit in the card: To, subject and words; Save keeps it a draft (PATCH), still waiting for Send. */
function fcDraftEdit(card, d) {
  const b = card.querySelector('.fc-result-b');
  b.innerHTML = `<div class="fc-result-h"><span class="fc-pt a" aria-hidden="true"></span><span class="fc-lab">Draft — editing</span></div>
    <div class="fc-edit"><input class="input fc-field" data-f="to" aria-label="To" value="${escHtml((d.to || []).join(', '))}">
    <input class="input fc-field" data-f="subject" aria-label="Subject" value="${escHtml(d.subject || '')}">
    <textarea class="input fc-field fc-area" data-f="body" aria-label="The mail" rows="6">${escHtml(d.body || '')}</textarea></div>
    <div class="fc-acts"><button type="button" class="fc-btn fc-sm fc-p" data-save>Save</button><button type="button" class="fc-btn fc-sm fc-q" data-cancel>Cancel</button></div>`;
  b.querySelector('[data-cancel]').onclick = () => card.replaceWith(fcDraftCard(d));
  b.querySelector('[data-save]').onclick = async () => {
    const f = k => b.querySelector(`[data-f="${k}"]`).value;
    try {
      const r = await apiFetch(`/api/accounts/drafts/${encodeURIComponent(d.id)}`, { method: 'PATCH', body: { to: f('to').split(',').map(x => x.trim()).filter(Boolean), subject: f('subject'), body: f('body') } });
      fcForget('/api/accounts'); card.replaceWith(fcDraftCard(r.draft || d));
    } catch (e) { appAlert(`Not saved: ${e.message}`); }
  };
}

/** A card for a turn's `everyday` event. */
function fcEverydayCard(evt) {
  if (evt.action) return fcActionCard(evt.action);
  if (evt.draft) return fcDraftCard({ ...evt.draft, state: 'waiting' });
  return null;
}

/** A card for a `calendar` or `mail` tool's result in the history: the record it names, as it is now. */
async function fcEverydayFromResult(result) {
  const act = (/Logged as (act_[a-f0-9]+)/.exec(String(result)) || [])[1];
  const drf = (/\b(drf_[a-f0-9]+)/.exec(String(result)) || [])[1];
  if (act) { const a = (await fcActions()).find(x => x.id === act); return a ? fcActionCard(a) : null; }
  if (drf) { const d = (await fcDrafts()).find(x => x.id === drf); return d ? fcDraftCard(d) : fcDraftCard({ id: drf, state: 'gone', subject: '', to: [] }); }
  return null;
}

/** Something changed in the person's accounts (the live topic `everyday`, or an Undo/Send here): redraw what shows it. */
function fcEverydayRedraw() {
  fcForget('/api/accounts');
  if (!_fcOpen) return;
  if (['mail', 'calendar', 'home'].includes(_fcScreen)) fcGo(_fcScreen, { replace: true });
  else if (_fcScreen === 'chat' && typeof _fcChatReload === 'function') _fcChatReload();
}
if (typeof document !== 'undefined' && typeof liveOn === 'function') document.addEventListener('DOMContentLoaded', () => {
  const again = typeof liveDebounce === 'function' ? liveDebounce(() => fcEverydayRedraw(), 1200) : fcEverydayRedraw;
  liveOn('everyday', again);
});

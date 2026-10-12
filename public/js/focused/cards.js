/* Result cards in the Focused conversation: what a turn did, as a card a person reads at a glance, with the one or
   two things to do next. Each card is built from a tool call and its result — live from a turn's events, or from the
   history's rows — so nothing new is stored:
     Added to calendar   a calendar write (`calendar_*` tools, or connector_google / connector_microsoft writing an
                         event)                                              Open · Undo
     Draft — not sent    a mail draft (`mail_draft*`, or a connector writing a draft)       Send · Edit
     Reminder set        `remind`                                                            Undo (deletes it)
     Made for you        a canvas or a preview the agent showed (`canvas`, show_media)       Open · Share
   The agent proposes, a person decides: a draft is never sent by being shown, Send is the person's tap and is said
   to the agent as a request (which its approvals then ask about as for any outward act), and every Undo asks first.
   FC_CARDS is a list so a tool added later (the accounts work's `calendar_*`/`mail_*`) is one more row. */
const _fcJson = s => { try { return JSON.parse(s); } catch { return null; } };
/** A connector's answer is "METHOD /path → 200\n{json}": its JSON, or null. */
const _fcBodyOf = r => _fcJson(String(r || '').replace(/^[A-Z]+ \S+ → \d+\n/, '')) || _fcJson(r);
const _fcOk = r => !/^Error|→ [45]\d\d/.test(String(r || ''));
const _fcWhen = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${fcDay(d, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fcTime(iso)}`; };

const FC_CARDS = [
  { kind: 'calendar', test: (n, a) => /^calendar_(add|create|event|new)/.test(n) || (/^connector_(google|microsoft)/.test(n) && /POST|PUT|PATCH/.test(a.method || '') && /calendar|events/.test(a.path || '')),
    card(n, a, r) {
      const b = { ...(a.body || {}), ...(a), ...(_fcBodyOf(r) || {}) };
      const title = b.summary || b.subject || b.title || 'An event';
      const start = b.start?.dateTime || b.start?.date || b.start || b.when || b.at;
      const where = b.location?.displayName || b.location || b.where || '';
      return { lab: 'Added to calendar', title, line: [_fcWhen(start), typeof where === 'string' ? where : ''].filter(Boolean).join(' · '),
        acts: [b.htmlLink || b.webLink ? ['Open', () => window.open(b.htmlLink || b.webLink, '_blank', 'noopener')] : ['Open', () => fcGo('calendar')],
          ['Undo', () => fcUndo(`Remove the calendar event “${title}” you just added${start ? ` (${_fcWhen(start)})` : ''}.`, `Remove “${title}” from your calendar?`), 'q']] };
    } },
  { kind: 'draft', test: (n, a) => /^mail_draft/.test(n) || (/^connector_(google|microsoft)/.test(n) && /POST|PUT|PATCH/.test(a.method || '') && /drafts|createReply|createForward/.test(a.path || '')),
    card(n, a, r) {
      const b = { ...(a.body || {}), ...a };
      const to = b.to || b.toRecipients?.[0]?.emailAddress?.address || b.message?.to || '';
      const subject = b.subject || b.message?.subject || '';
      const text = b.text || b.body?.content || b.content || '';
      return { lab: 'Draft — not sent', warn: true, line: [to && `To ${to}`, subject && `Re: ${subject}`.replace(/^Re: Re:/, 'Re:')].filter(Boolean).join(' · '), text: String(text).slice(0, 400),
        acts: [['Send', () => fcAskAgent(`Send the draft${to ? ` to ${to}` : ''}${subject ? ` (“${subject}”)` : ''} now.`), 'p'],
          ['Edit', () => fcComposeFill(`Change the draft${to ? ` to ${to}` : ''}: `)]] };
    } },
  { kind: 'sent', test: (n, a) => /^mail_send/.test(n) || (/^connector_(google|microsoft)/.test(n) && a.method === 'POST' && /\/send(Mail)?$|messages\/send/.test(a.path || '')),
    card: (n, a) => ({ lab: 'Sent', title: a.subject || a.body?.subject || 'Your message', line: a.to ? `To ${a.to}` : '', acts: [] }) },
  { kind: 'reminder', test: n => n === 'remind',
    card(n, a, r) {
      const id = (/Reminder (\S+) set/.exec(String(r)) || [])[1];
      const when = (/set for ([^,]+),/.exec(String(r)) || [])[1] || '';
      return { lab: 'Reminder set', title: a.text || 'A reminder', line: when,
        acts: id ? [['Undo', () => _fcReminderUndo(id, a.text), 'q']] : [] };
    } },
];

/** A card for one tool call and its result, or null when it is not one of these (or it failed). */
function fcCardFor(name, args, result) {
  const a = typeof args === 'string' ? (_fcJson(args) || {}) : (args || {});
  if (!_fcOk(result)) return null;
  const row = FC_CARDS.find(c => { try { return c.test(name, a); } catch { return false; } });
  return row ? fcCardEl(row.card(name, a, result)) : null;
}

/** A card element: {lab, title?, line?, text?, warn?, acts: [[label, fn, 'p'|'q'?]], thumb?} */
function fcCardEl(c) {
  const el = document.createElement('div');
  el.className = `fc-card fc-result${c.thumb ? ' fc-result-made' : ''}`;
  el.innerHTML = `${c.thumb ? '<div class="fc-thumb" aria-hidden="true"><i></i><i></i><i></i><b></b></div>' : ''}<div class="fc-result-b">
    <div class="fc-result-h"><span class="fc-pt${c.warn ? ' a' : ''}" aria-hidden="true"></span><span class="fc-lab">${escHtml(c.lab)}</span></div>
    ${c.title ? `<div class="fc-bright fc-result-t">${escHtml(c.title)}</div>` : ''}${c.line ? `<div class="fc-muted fc-small">${escHtml(c.line)}</div>` : ''}
    ${c.text ? `<div class="fc-result-x">${escHtml(c.text)}</div>` : ''}<div class="fc-acts"></div></div>`;
  const acts = el.querySelector('.fc-acts');
  for (const [label, fn, kind] of c.acts || []) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: `fc-btn fc-sm${kind ? ` fc-${kind}` : ''}`, textContent: label });
    b.onclick = fn;
    acts.append(b);
  }
  if (!acts.children.length) acts.remove();
  return el;
}

/** Something the agent made and showed (a canvas or a preview of a served page): Made for you · Open · Share. */
function fcMadeCard(media) {
  if (!media || media.kind !== 'canvas') return null;
  const open = () => (media.previewId ? canvasPreviewOpen(media.previewId, media.at || '/') : canvasOpen(media.canvasId, media.rev));
  return fcCardEl({ lab: 'Made for you', title: media.caption || 'A page made for you', thumb: true,
    acts: [['Open', open], ['Share', () => fcShare(media), 'q']] });
}

/** Undo a reminder: it is deleted after the person confirms (the schedule's own route, the person's own). */
function _fcReminderUndo(id, text) {
  appConfirm(`Delete the reminder “${text || ''}”?`, async () => { try { await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }); fcToast('Reminder deleted.'); } catch (e) { appAlert(`Not deleted: ${e.message}`); } });
}

/** Undo by asking the agent to put it back, after the person confirms (owner's rule: every undo confirms). */
function fcUndo(request, question) { fcConfirm(question, () => fcAskAgent(request)); }
function fcConfirm(q, fn) {
  if (typeof appConfirm === 'function') appConfirm(q, async () => { try { await fn(); } catch (e) { appAlert(e.message); } });
  else if (confirm(q)) fn();
}

/** Say something to the agent as the person, in the conversation (shown there like anything they type). */
function fcAskAgent(text) { if (_fcScreen !== 'chat') fcGo('chat'); fcChatSend(text); }

/** Put words in the conversation's box, for the person to finish and send. */
function fcComposeFill(text) {
  if (_fcScreen !== 'chat') fcGo('chat');
  const i = document.getElementById('fc-msg');
  if (i) { i.value = text; i.focus(); i.setSelectionRange(text.length, text.length); }
}

/** A short line that says what just happened, and goes. */
function fcToast(text) {
  const t = Object.assign(document.createElement('div'), { className: 'fc-toast', role: 'status', textContent: text });
  document.getElementById('focused')?.append(t);
  setTimeout(() => t.remove(), 3200);
}

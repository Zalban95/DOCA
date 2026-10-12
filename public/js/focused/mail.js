/* Mail in the Focused view comes from whoever reads it: a source registers here and says, for today, what needs the
   person, what was answered and what was handled quietly ({source, arrived?, needs: [{title, line}], answered: [...],
   handled: [{line}]}). The accounts work (calendar_* / mail_* tools and their triage) registers one; with none, the
   Mail section says how to have mail read and offers the words to ask it with — the agent reads mail through the
   connector tools whenever it is asked. Wording stays mechanical: these are the source's rows, drawn as they come. */
const FOCUSED_MAIL = [];

/** A mail source: an async function answering today's mail, or null when it has nothing to say. */
function focusedMailRegister(fn) { if (typeof fn === 'function' && !FOCUSED_MAIL.includes(fn)) FOCUSED_MAIL.push(fn); }

let _fcMailAt = 0, _fcMailP = null;
/** Today's mail from the first source that answers (kept a minute), or null. */
function fcMail() {
  if (_fcMailP && Date.now() - _fcMailAt < 60000) return _fcMailP;
  _fcMailAt = Date.now();
  _fcMailP = (async () => {
    for (const src of FOCUSED_MAIL) { try { const r = await src(); if (r) return r; } catch { /* the next source */ } }
    return null;
  })();
  return _fcMailP;
}

/** One line for Home's "Needs you": what was handled quietly. */
async function fcMailSummary() {
  const m = await fcMail();
  if (!m?.handled?.length) return null;
  return { handled: m.handled.length === 1 ? m.handled[0].line : `${m.handled.length} messages handled for you` };
}

/** The Mail section of the Calendar and Mail screen. */
async function fcMailSection(box) {
  const m = await fcMail();
  if (!box?.isConnected) return;
  if (!m) {
    box.innerHTML = `<div class="fc-row-empty"><div class="fc-muted fc-small">Mail that needs you shows here once ${escHtml(fcProduct())} reads it for you.</div>
      <button type="button" class="fc-chip" onclick="fcComposeFill('What in my mail needs me today?')">What in my mail needs me today?</button></div>`;
    return;
  }
  const row = (r, pt) => `<div class="fc-row"><span class="fc-pt${pt}" aria-hidden="true"></span><div class="fc-row-b">${r.title ? `<div class="fc-bright">${escHtml(r.title)}</div>` : ''}<div class="${r.title ? 'fc-muted fc-small' : 'fc-muted'}">${escHtml(r.line || '')}</div></div></div>`;
  box.innerHTML = `<div class="fc-mail-cols"><div>${[...(m.needs || []).map(r => row(r, ' a')), ...(m.answered || []).map(r => row(r, ''))].join('') || '<div class="fc-muted fc-small fc-row-empty">Nothing needs you.</div>'}</div>
    <div>${(m.handled || []).map(r => row(r, ' q')).join('')}</div></div>`;
  const src = document.getElementById('fc-mail-src');
  if (src) src.textContent = [m.source, m.arrived != null ? `${m.arrived} arrived` : ''].filter(Boolean).join(' · ');
}

/* Home: a greeting with one line of counts, the talk card (the points are the button; a field to type under it),
   suggestions that fill the box and never send, what is next in the calendar, what needs the person, and a strip
   naming the work going on behind (focused/strip.js). Everything is read from routes that exist (focused/data.js);
   nothing here acts without a tap. */
async function fcHomeRender(el) {
  const product = fcProduct();
  el.innerHTML = `
    <div class="fc-home">
      <section class="fc-home-main">
        <div class="fc-hello"><h1 class="fc-h1" id="fc-hello">${escHtml(fcGreeting())}</h1><p class="fc-sub" id="fc-hello-sub">&nbsp;</p></div>
        <div class="fc-card fc-talk">
          <button type="button" class="fc-talk-dots" onclick="fcCallStart()" aria-label="Talk to ${escHtml(product)}"><span id="fc-talk-dots"></span></button>
          <div class="fc-talk-say"><div class="fc-bright fc-talk-title">Tap the points and talk</div><div class="fc-muted fc-small fc-talk-hint">or type below</div></div>
          <form class="fc-ask" onsubmit="event.preventDefault();fcAskFrom('fc-ask-home')">
            <label for="fc-ask-home" class="fc-sr">Type to ${escHtml(product)}</label>
            <input id="fc-ask-home" class="input fc-field" autocomplete="off" placeholder="Or type — “move my 3 pm to Thursday”">
            <button class="fc-btn fc-p fc-send" aria-label="Send">${fcIcon('send')}</button>
          </form>
        </div>
        <div class="fc-chips" id="fc-chips"></div>
      </section>
      <aside class="fc-home-side">
        <div class="fc-card fc-pad"><div class="fc-head"><span class="fc-lab">Next up</span><button type="button" class="fc-link" onclick="fcGo('calendar')">Calendar</button></div><div id="fc-next"><div class="fc-muted fc-small fc-row-empty">Looking at your day…</div></div></div>
        <div class="fc-card fc-pad"><div class="fc-head"><span class="fc-lab" id="fc-needs-lab">Needs you</span><button type="button" class="fc-link" onclick="fcGo('mail')">Mail</button></div><div id="fc-needs"></div></div>
      </aside>
      <div class="fc-strip-slot" id="fc-strip"></div>
    </div>`;
  const dots = fcDots(document.getElementById('fc-talk-dots'), window.matchMedia('(max-width: 720px)').matches ? 150 : 220);
  fcOwn(dots.stop);
  _fcHomeChips(el.querySelector('#fc-chips'), 'fc-ask-home');
  const [me, day] = await Promise.all([fcMe(), fcToday()]);
  if (!document.getElementById('fc-hello')) return;   // gone to another screen meanwhile
  const name = fcFirstName(me);
  document.getElementById('fc-hello').textContent = name ? `${fcGreeting()}, ${name}` : fcGreeting();
  const events = (day.calendar?.events || []);
  _fcHomeNext(document.getElementById('fc-next'), day.calendar, me);
  const needs = await fcNeedsRows(document.getElementById('fc-needs'), day);
  document.getElementById('fc-needs-lab').textContent = needs ? `Needs you · ${needs}` : 'Needs you';
  fcBellCount(needs);
  const today = events.filter(e => fcSameDay(new Date(e.start), new Date())).length;
  const bits = [today ? `${today} thing${today === 1 ? '' : 's'} today` : 'Nothing in the calendar today', needs ? `${needs} need${needs === 1 ? 's' : ''} you` : ''];
  document.getElementById('fc-hello-sub').textContent = `${bits.filter(Boolean).join('. ')}.`;
  const hist = await fcHistory().catch(() => ({}));
  fcStrip(document.getElementById('fc-strip'), hist.sessionId);
}

/** Send what was typed into one of the Focused fields: the conversation opens with it. */
function fcAskFrom(inputId) {
  const input = document.getElementById(inputId);
  const text = input?.value.trim();
  if (!text) return input?.focus();
  input.value = '';
  fcGo('chat');
  fcChatSend(text);
}

/** Suggestions by the hour and the day: a tap puts the words in the box, to change or send — never sends. */
function _fcHomeChips(box, inputId) {
  const h = new Date().getHours();
  const said = h < 11 ? ['What does my day look like?', 'What in my mail needs me?']
    : h < 17 ? ['Find a time for lunch this week', 'Reply to my last email']
      : ['What is on tomorrow?', 'Remind me in the morning to…'];
  const all = [...said, 'Make a sign-up page for an event', 'What did I miss yesterday?'];
  box.innerHTML = all.map(t => `<button type="button" class="fc-chip">${escHtml(t)}</button>`).join('');
  box.querySelectorAll('.fc-chip').forEach(b => { b.onclick = () => { const i = document.getElementById(inputId); if (!i) return; i.value = b.textContent.replace(/…$/, ' '); i.focus(); }; });
}

function _fcHomeNext(box, cal, me) {
  if (!box) return;
  const now = Date.now();
  const next = (cal?.events || []).filter(e => !e.end || Date.parse(e.end) > now).slice(0, 3);
  if (next.length) {
    box.innerHTML = next.map(e => `<div class="fc-row"><span class="fc-mono fc-bright fc-row-t">${escHtml(fcSameDay(new Date(e.start), new Date()) ? fcTime(e.start, e.allDay) : fcDay(new Date(e.start)))}</span>
      <div class="fc-row-b"><div class="fc-bright">${escHtml(e.title)}</div><div class="fc-muted fc-small">${escHtml([fcSameDay(new Date(e.start), new Date()) ? '' : fcTime(e.start, e.allDay), e.where].filter(Boolean).join(' · ') || ' ')}${e.setByAssistant ? ` <span class="fc-tag">set by ${escHtml(fcProduct())}</span>` : ''}</div></div></div>`).join('');
    return;
  }
  box.innerHTML = cal?.none
    ? `<div class="fc-row-empty"><div class="fc-muted fc-small">Your calendar is not connected yet.</div>${fcIsHost(me)
      ? '<button type="button" class="fc-btn fc-sm" onclick="fcPeek(\'connectors\')">Connect an account</button>' : '<div class="fc-muted fc-small">Ask whoever runs this hub to open theirs to you.</div>'}</div>`
    : '<div class="fc-muted fc-small fc-row-empty">Nothing else today.</div>';
}

/**
 * What needs the person, calmly: the notices kept for them (a reminder, a note from the agents — each with Done), and
 * the questions waiting (answered in the cards at the side, as anywhere in the panel). Returns how many.
 */
async function fcNeedsRows(box, day, { limit = 4, mail: withMail = true } = {}) {
  if (!box) return 0;
  const notices = await fcGet('/api/notices', 10000).then(r => r.notices || []).catch(() => []);
  const asks = fcNeedsYou(day).filter(n => n.kind === 'ask' || n.kind === 'propose' || n.kind === 'failed');
  const rows = [
    ...asks.map(n => `<div class="fc-row"><span class="fc-pt a" aria-hidden="true"></span><div class="fc-row-b"><div class="fc-bright">${escHtml(n.text)}</div></div>
      <button type="button" class="fc-btn fc-sm" onclick="fcAnswerAsks()">Answer</button></div>`),
    ...notices.slice(0, limit).map(n => `<div class="fc-row"><span class="fc-pt a" aria-hidden="true"></span><div class="fc-row-b"><div class="fc-bright">${escHtml(n.title || 'A note for you')}</div>${n.text ? `<div class="fc-muted fc-small">${escHtml(n.text)}</div>` : ''}</div>
      <button type="button" class="fc-btn fc-sm" onclick="fcNoticeDone(${jsArg(n.id)}, this)">Done</button></div>`),
  ];
  // The person's own mail (accounts/): what the reading says needs them, one action each — the draft waiting, or a look.
  const mail = withMail && typeof fcMailNeeds === 'function' ? await fcMailNeeds().catch(() => null) : null;
  for (const x of (mail?.needs || []).slice(0, limit)) {
    const drafted = x.draftId && mail.drafts.some(d => d.id === x.draftId);
    rows.push(`<div class="fc-row"><span class="fc-pt a" aria-hidden="true"></span><div class="fc-row-b"><div class="fc-bright">${escHtml(x.from?.name || x.from?.address || 'Someone')} <span class="fc-muted fc-small">· ${escHtml(x.subject || '')}</span></div>
      <div class="fc-muted fc-small">${escHtml(drafted ? 'A reply is drafted for you to check.' : (x.why || x.snippet || ''))}</div></div>
      <button type="button" class="fc-btn fc-sm" onclick="fcGo('mail')">${drafted ? 'Review' : 'Open'}</button></div>`);
  }
  const summary = withMail && typeof fcMailSummary === 'function' ? await fcMailSummary() : null;
  if (summary?.handled) rows.push(`<div class="fc-row"><span class="fc-pt q" aria-hidden="true"></span><div class="fc-muted fc-small fc-row-b">${escHtml(summary.handled)}</div></div>`);
  box.innerHTML = rows.length ? rows.join('') : '<div class="fc-row-empty fc-muted fc-small">Nothing needs you right now.</div>';
  return asks.length + notices.length + (mail?.needs?.length || 0);
}

/** A notice the person has read: put away (POST /api/notices/:id/seen). */
async function fcNoticeDone(id, btn) {
  try { await apiFetch(`/api/notices/${encodeURIComponent(id)}/seen`, { method: 'POST' }); fcForget('/api/notices'); btn.closest('.fc-row')?.remove(); }
  catch (e) { appAlert(`Not put away: ${e.message}`); }
}

/** The questions the agents wait on are cards at the side of the screen (agent-ui/questions-dock.js): bring them up. */
function fcAnswerAsks() {
  if (typeof questionsPoll === 'function') questionsPoll();
  const dock = document.getElementById('questions-dock');
  if (dock?.children.length) { dock.classList.add('fc-flash'); dock.scrollIntoView({ block: 'end', behavior: 'smooth' }); setTimeout(() => dock.classList.remove('fc-flash'), 1600); }
  else fcPeek('harness');
}

/** A page of the Extended panel, for this moment: this screen keeps Focused, and the "Focused" pill comes back. */
function fcPeek(page) {
  document.documentElement.dataset.mode = 'extended';
  fcShellClose();
  if (typeof nav === 'function') nav(page);
}

/* Calendar and Mail at a glance: what needs the person first (the agents' questions, notices, a reminder), the week
   from today with what the assistant set tinted and a clash outlined in amber, and mail today (focused/mail.js).
   The week is the calendars this person may see and their own accounts (GET /api/ambient/week — Ambient's rule), with
   what the assistant added marked from the action log. */
async function fcAgendaRender(el, focus = 'calendar') {
  el.innerHTML = `
    <div class="fc-agenda fc-focus-${focus}">
      <h1 class="fc-h1 fc-phone-only">${focus === 'mail' ? 'Mail' : 'This week'}</h1>
      <div class="fc-days fc-phone-only" id="fc-days"></div>
      <section class="fc-card fc-pad fc-ag-needs"><span class="fc-lab" id="fc-ag-needs-lab">Needs you</span><div id="fc-ag-needs"><div class="fc-muted fc-small fc-row-empty">…</div></div></section>
      <section class="fc-card fc-pad fc-ag-week"><div class="fc-head"><span class="fc-lab">This week</span><span class="fc-muted fc-small" id="fc-week-src"></span></div><div class="fc-week" id="fc-week"></div></section>
      <section class="fc-card fc-pad fc-ag-mail" id="fc-ag-mail"><div class="fc-head"><span class="fc-lab">Mail today</span><span class="fc-muted fc-small" id="fc-mail-src"></span></div><div id="fc-mail"></div></section>
    </div>`;
  fcMailSection(document.getElementById('fc-mail'));
  const [day, week] = await Promise.all([fcToday(), fcWeek()]);
  if (!document.getElementById('fc-week')) return;
  const n = await fcNeedsRows(document.getElementById('fc-ag-needs'), day, { limit: 8, mail: false });   // mail has its own section below
  document.getElementById('fc-ag-needs-lab').textContent = n ? `Needs you · ${n}` : 'Needs you';
  _fcWeek(document.getElementById('fc-week'), week);
  _fcDays(document.getElementById('fc-days'), week);
  const src = document.getElementById('fc-week-src');
  if (src) src.textContent = (week.sources || []).map(s => ({ google: 'Google Calendar', microsoft: 'Microsoft 365' }[s] || s)).join(' · ');
}

function _fcWeekDays(week) {
  const from = week.from ? new Date(week.from) : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  return Array.from({ length: week.days || 7 }, (_, i) => new Date(from.getTime() + i * 86400000));
}

function _fcWeek(box, week) {
  if (!box) return;
  if (week.none || !week.events) {
    box.innerHTML = `<div class="fc-row-empty fc-muted fc-small">${escHtml(week.none || 'No calendar to show.')}</div>`;
    return;
  }
  const today = new Date(), product = fcProduct();
  box.innerHTML = _fcWeekDays(week).map(d => {
    const evs = week.events.filter(e => fcSameDay(new Date(e.start), d));
    const clash = new Set();
    evs.forEach((a, i) => evs.slice(i + 1).forEach(b => { if (!a.allDay && !b.allDay && Date.parse(b.start) < Date.parse(a.end) && Date.parse(a.start) < Date.parse(b.end)) { clash.add(a); clash.add(b); } }));
    return `<div class="fc-col"><div class="fc-dh${fcSameDay(d, today) ? ' on' : ''}">${escHtml(fcDay(d))} <b>${d.getDate()}</b></div>
      ${evs.map(e => { const mine = !!e.setByAssistant;   // from the action log (ambient/calendar.js week)
        return `<div class="fc-ev${mine ? ' set' : ''}${clash.has(e) ? ' clash' : ''}"><div class="fc-mono fc-ev-t">${escHtml(fcTime(e.start, e.allDay))}</div><span class="${mine ? 'fc-bright' : ''}">${escHtml(e.title)}</span>${e.where ? `<div class="fc-muted fc-ev-w">${escHtml(e.where)}</div>` : ''}${mine ? `<div><span class="fc-tag">set by ${escHtml(product)}</span></div>` : ''}${clash.has(e) ? '<div><span class="fc-tag a">overlaps</span></div>' : ''}</div>`; }).join('')}</div>`;
  }).join('');
}

/** On a phone: the seven days as a strip, a point under each day that has something. */
function _fcDays(box, week) {
  if (!box) return;
  const today = new Date();
  box.innerHTML = _fcWeekDays(week).map(d => {
    const has = (week.events || []).some(e => fcSameDay(new Date(e.start), d));
    return `<div class="fc-day${fcSameDay(d, today) ? ' on' : ''}"><span>${escHtml(fcDay(d, { weekday: 'narrow' }))}</span><b>${d.getDate()}</b><i class="${has ? 'has' : ''}"></i></div>`;
  }).join('');
}

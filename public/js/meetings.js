/* Controls → Meetings (modules/meetings): call a colleague now, schedule a meeting that lands in each person's own
   calendar, join one by its id or link, and connect your own calendar. The room itself is meet/room.js, drawn over the
   panel. Its page is made here: index.html is at its line ceiling.

   For other parts of the panel — the hive chat's call and share buttons (branch hive-chat) — three functions:
     meetingStart({space, people, title})   a call now with these people (ids): the room opens here, they are rung
     screenShareStart({space, people})      share this screen: in the room this page is in, else in a new call first
     meetingOpen(id)                        open a meeting's room on this page (its id or its link)
   Each answers a promise of {id, link} (or throws with why), and fires `doca:meeting` on window when a room opens.
   The hive chat's buttons find them as `window.peopleCallProvider.start(kind, space)` (kind call | share-screen). */
const MEETS = { list: [], people: [], calendar: null, max: 6, loaded: false };

function meetingsTab(shown) { if (shown) meetingsLoad(); }

async function meetingsLoad() {
  const page = document.getElementById('tab-meetings');
  if (!page) return;
  try {
    const [r, p] = await Promise.all([apiFetch('/api/meetings'), MEETS.people.length ? { people: MEETS.people } : apiFetch('/api/meetings/people')]);
    Object.assign(MEETS, { list: r.meetings, calendar: r.calendar, max: r.max, people: p.people, loaded: true });
  } catch (e) { page.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  meetingsDraw(page);
}

const _mtWhen = m => (m.startsAt && m.state !== 'open' ? new Date(m.startsAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'now');

function _mtRow(m) {
  const others = m.people.filter(p => p.role !== 'organizer').map(p => escHtml(p.name)).join(', ') || 'nobody yet';
  const inRoom = m.room?.peers?.length ? ` · <b>${m.room.peers.length} in the room</b>` : '';
  const how = m.organizer ? m.people.filter(p => p.role !== 'organizer' && p.status).map(p => `${escHtml(p.name)}: ${escHtml(p.status)}${p.note ? ` (${escHtml(p.note)})` : ''}`).join(' · ') : '';
  const acts = [
    ['open', 'scheduled'].includes(m.state) ? `<button class="btn btn-primary btn-xs" onclick="meetJoin('${m.id}')">Join</button>` : '',
    m.state === 'proposed' && m.organizer ? `<button class="btn btn-primary btn-xs" onclick="meetingsDo('${m.id}', 'confirm')">Confirm and invite</button>` : '',
    `<button class="btn btn-xs" onclick="navigator.clipboard?.writeText('${escHtml(m.link)}').then(() => appAlert('Link copied'))">Link</button>`,
    m.startsAt && m.state !== 'cancelled' ? `<a class="btn btn-xs" href="/api/meetings/${m.id}/invite.ics" download>Add to calendar</a>` : '',
    m.organizer && !['cancelled', 'ended'].includes(m.state) ? `<button class="btn btn-red btn-xs" onclick="appConfirm('Cancel &quot;${escHtml(m.title).replace(/'/g, '')}&quot; for everyone? Their calendars are told.', () => meetingsDo('${m.id}', 'cancel'))">Cancel</button>` : '',
  ].filter(Boolean).join(' ');
  return `<div class="mt-row mt-${escHtml(m.state)}"><div class="mt-main"><div class="mt-title">${escHtml(m.title)} <span class="mt-state">${escHtml(m.state)}</span></div>
    <div class="mt-sub">${escHtml(_mtWhen(m))} · with ${others}${inRoom} · id <code>${escHtml(m.id)}</code></div>${how ? `<div class="mt-how">${how}</div>` : ''}</div>
    <div class="mt-acts">${acts}</div></div>`;
}

function meetingsDraw(page) {
  const opts = MEETS.people.map(p => `<label class="mt-person"><input type="checkbox" value="${escHtml(p.id)}"> ${escHtml(p.name)}</label>`).join('') || '<span class="meet-quiet">Nobody else in this hive yet.</span>';
  const cal = MEETS.calendar || { providers: [] };
  const calText = cal.connected ? `Your meetings go into <b>${escHtml(cal.connected.label)}</b>${cal.connected.account ? ` (${escHtml(cal.connected.account)})` : ''}. <button class="btn btn-xs" onclick="meetingsCalendar(null)">Disconnect</button>`
    : `Connect your own calendar and meetings land in it as your events. Without one you get an invitation any calendar takes (by mail when the hub can send mail, else here with “Add to calendar”).
      ${cal.providers.map(p => `<button class="btn btn-xs" ${p.ready ? '' : 'disabled title="An admin adds this app in Field → Connectors first"'} onclick="meetingsCalendar('${p.id}')">Connect ${escHtml(p.label)}</button>`).join(' ')}`;
  const upcoming = MEETS.list.filter(m => !['cancelled', 'ended'].includes(m.state)), past = MEETS.list.filter(m => ['cancelled', 'ended'].includes(m.state));
  page.innerHTML = pageHeadHtml({ title: 'Meetings', sub: `Calls between the people of this hive — voice, video, screens shared with consent. Up to ${MEETS.max} in a room.`,
    actions: '<button type="button" class="btn" onclick="meetingsLoad()">Refresh</button>' })
    + `<div class="mt-grid"><div class="card"><div class="card-title">Call or schedule</div>
      <div class="mt-people">${opts}</div>
      <input id="mt-emails" class="input mt-input" placeholder="People outside the hive: mail addresses, comma-separated (they get an invitation)">
      <div class="mt-row-in"><input id="mt-title" class="input mt-input" placeholder="What it is about"><input id="mt-start" class="input mt-input" type="datetime-local">
        <select id="mt-minutes" class="input mt-input mt-minutes">${[15, 30, 45, 60, 90].map(n => `<option${n === 30 ? ' selected' : ''}>${n}</option>`).join('')}</select><span class="meet-quiet">min</span></div>
      <textarea id="mt-note" class="input mt-input" rows="2" placeholder="An agenda or a line for the invitation (optional)"></textarea>
      <div class="mt-row-in"><button class="btn btn-primary" onclick="meetingsCall()">📞 Call now</button><button class="btn" onclick="meetingsSchedule()">📅 Schedule</button></div></div>
      <div class="card"><div class="card-title">Join with an id or a link</div><div class="mt-row-in"><input id="mt-join" class="input mt-input" placeholder="m1a2b3c4d5e6 or https://…/meet/m1a2b3c4d5e6">
        <button class="btn btn-primary" onclick="meetJoin(document.getElementById('mt-join').value)">Join</button></div>
        <div class="card-title" style="margin-top:14px">Your calendar</div><p class="mt-sub">${calText}</p></div></div>
    <div class="card"><div class="card-title">Meetings</div>${upcoming.map(_mtRow).join('') || emptyStateHtml({ title: 'No meetings ahead', text: 'Call someone now, or schedule one above — or ask the agent to set it up.' })}</div>
    ${past.length ? `<div class="card"><div class="card-title">Ended and cancelled this week</div>${past.map(_mtRow).join('')}</div>` : ''}`;
}

function _mtForm() {
  const people = [...document.querySelectorAll('#tab-meetings .mt-people input:checked')].map(i => i.value);
  const emails = (document.getElementById('mt-emails')?.value || '').split(/[,;\s]+/).filter(Boolean);
  return { people, emails, title: document.getElementById('mt-title')?.value || '', note: document.getElementById('mt-note')?.value || '',
    start: document.getElementById('mt-start')?.value || '', minutes: Number(document.getElementById('mt-minutes')?.value) || 30,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

async function meetingsCall() {
  const f = _mtForm();
  if (!f.people.length) return appAlert('Tick who to call.');
  try { await meetingStart({ people: f.people, title: f.title }); } catch (e) { appAlert(e.message); }
}

async function meetingsSchedule() {
  const f = _mtForm();
  if (!f.start) return appAlert('Choose when.');
  if (!f.people.length && !f.emails.length) return appAlert('Tick who to invite, or give an address.');
  try {
    const r = await apiFetch('/api/meetings', { method: 'POST', body: { ...f, title: f.title || 'Meeting' } });
    const how = (r.sent || []).map(s => `${s.name}: ${s.status}`).join('\n');
    appAlert(`Scheduled “${r.meeting.title}”.${how ? `\n\n${how}` : ''}`);
    meetingsLoad();
  } catch (e) { appAlert(e.message); }
}

async function meetingsDo(id, what) {
  try { await apiFetch(`/api/meetings/${id}/${what}`, { method: 'POST' }); } catch (e) { appAlert(e.message); }
  meetingsLoad();
}

async function meetingsCalendar(provider) {
  try {
    if (!provider) { await apiFetch('/api/meetings/calendar', { method: 'DELETE' }); return meetingsLoad(); }
    const r = await apiFetch(`/api/meetings/calendar/${provider}/connect`, { method: 'POST' });
    window.open(r.url, '_blank', 'noopener');
    appAlert('Sign in in the tab that opened; then Refresh here.');
  } catch (e) { appAlert(e.message); }
}

/* ── For the rest of the panel ── */

async function meetingStart({ space = null, people = [], title = '' } = {}) {
  if (typeof licencePageOn === 'function' && !licencePageOn('meetings')) throw new Error('Meetings are not part of this hive\'s licence.');
  const r = await apiFetch('/api/meetings', { method: 'POST', body: { now: true, people, space, title } });
  await meetJoin(r.meeting.id);
  window.dispatchEvent?.(new CustomEvent('doca:meeting', { detail: { id: r.meeting.id, link: r.meeting.link, space } }));
  return { id: r.meeting.id, link: r.meeting.link };
}

async function screenShareStart(opts = {}) {
  if (!MEET.id) await meetingStart(opts);
  await meetShareStart();
  return { id: MEET.id, link: MEET.meeting?.link || null };
}

async function meetingOpen(id) { await meetJoin(id); return { id: MEET.id, link: MEET.meeting?.link || null }; }

/** The hive chat's 📞 and share buttons (branch hive-chat, people-msgs.js peopleCallHook): a call with the space's people. */
if (typeof window !== 'undefined') window.peopleCallProvider = {
  async start(kind, space) {
    try {
      let members = space?.members;
      if (!members && space?.id) members = (await apiFetch(`/api/people/spaces/${encodeURIComponent(space.id)}`)).members;
      const opts = { space: space?.id || null, people: (members || []).map(m => m.id), title: space?.title || space?.name || '' };
      return kind === 'share-screen' ? await screenShareStart(opts) : await meetingStart(opts);
    } catch (e) { appAlert(e.message); return null; }
  },
};

/** Someone is calling: a card on every open page of the person rung, until they join or decline. */
function meetingsRing(c) {
  if (MEET.id === c.id || document.getElementById(`ring-${c.id}`)) return;
  const card = Object.assign(document.createElement('div'), { id: `ring-${c.id}`, className: 'meet-ring' });
  card.innerHTML = `<div><b>${escHtml(c.by)}</b> is calling<br><span class="meet-quiet">${escHtml(c.title)}</span></div>
    <button class="btn btn-primary" onclick="this.parentNode.remove(); meetJoin('${escHtml(c.id)}')">Join</button><button class="btn" onclick="this.parentNode.remove()">Decline</button>`;
  document.body.appendChild(card);
  setTimeout(() => card.remove(), 60000);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-meetings' });
  page.style.overflow = 'auto';
  document.getElementById('tab-settings')?.before(page);
  if (typeof licencePageOn === 'function' && !licencePageOn('meetings')) return;
  if (typeof liveOn === 'function') liveOn('meeting', c => { if (c.what === 'ring' && !MEET.id) meetingsRing(c); });   // rung while in no room
  const id = new URLSearchParams(location.search).get('meet');   // /meet/<id> opens the panel here
  if (id) { history.replaceState(history.state, '', location.pathname + location.hash); setTimeout(() => meetJoin(id), 300); }
});

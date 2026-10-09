/* The hive chat's state in the page (modules/people): the person's list, the messages of the spaces they opened, who
   is typing — kept once and drawn by every view that shows it (the Chat page, the floating chat's People). Live: the
   feed's `chat` topic (to this person's pages alone) brings a message, an edit, a reaction, typing and read receipts,
   and only what changed is drawn again. */
const PEOPLE = {
  data: null, loading: null, off: null,
  msgs: new Map(),       // spaceId → messages, oldest first
  older: new Map(),      // spaceId → whether there are older ones to load
  typing: new Map(),     // spaceId → { name, until }
  reply: new Map(),      // spaceId → the message being replied to
  views: new Set(),      // what draws: { list(), space(id) }
  readTimer: null,
};

async function peopleLoad() {
  if (PEOPLE.loading) return PEOPLE.loading;
  PEOPLE.loading = (async () => {
    try {
      const old = PEOPLE.data, next = await apiFetch('/api/people');
      for (const x of next.spaces) { const o = old?.spaces?.find(y => y.id === x.id); if (o?.pins) x.pins = o.pins; }   // pins come with a space's own read
      PEOPLE.data = next;
    }
    catch (e) { PEOPLE.data = PEOPLE.data || { error: e.message, spaces: [], joinable: [], agents: [], may: {} }; }
    finally { PEOPLE.loading = null; }
    peopleLiveStart();
    peopleDrawLists();
    return PEOPLE.data;
  })();
  return PEOPLE.loading;
}

const peopleSpace = id => PEOPLE.data?.spaces?.find(s => s.id === id) || PEOPLE.data?.joinable?.find(s => s.id === id) || null;
const peopleUnread = () => (PEOPLE.data?.spaces || []).filter(s => !s.muted).reduce((n, s) => n + (s.unread || 0), 0);

function peopleDrawLists() {
  for (const v of PEOPLE.views) try { v.list(); } catch (e) { console.warn('[people]', e); }
  peopleBadge();
}
function peopleDrawSpace(id) { for (const v of PEOPLE.views) try { v.space(id); } catch (e) { console.warn('[people]', e); } }

/** The unread count on the floating chat's People switch and on the Chat page's group. */
function peopleBadge() {
  const n = peopleUnread();
  document.querySelectorAll('[data-people-badge]').forEach(el => { el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; });
}

async function peopleMessages(id, { older = false } = {}) {
  const have = PEOPLE.msgs.get(id) || [];
  const q = older && have.length ? `?before=${have[0].seq}&limit=40` : '?limit=40';
  const r = await apiFetch(`/api/people/spaces/${encodeURIComponent(id)}/messages${q}`);
  PEOPLE.msgs.set(id, older ? [...r.messages, ...have] : r.messages);
  PEOPLE.older.set(id, r.messages.length >= 40);
  return PEOPLE.msgs.get(id);
}

/** A message changed here or on the feed: put it in place (new at the end; others where they are). */
function peoplePut(m) {
  const list = PEOPLE.msgs.get(m.spaceId);
  if (!list) return;
  const i = list.findIndex(x => x.id === m.id);
  if (i >= 0) list[i] = { ...list[i], ...m };
  else if (!list.length || m.seq > list.at(-1).seq) list.push(m);
  if (m.replyTo) { const root = list.find(x => x.id === m.replyTo); if (root && i < 0) root.replies = (root.replies || 0) + 1; }
}

function peopleLiveStart() {
  if (PEOPLE.off || typeof liveOn !== 'function') return;
  PEOPLE.off = liveOn('chat', c => {
    if (c.what === 'resync') return peopleLoad();
    const s = peopleSpace(c.id);
    if (c.what === 'typing') { PEOPLE.typing.set(c.id, { name: c.by?.name || 'Someone', until: Date.now() + 4500 }); peopleDrawSpace(c.id); setTimeout(() => peopleDrawSpace(c.id), 4700); return; }
    if (c.what === 'read') {
      const m = s?.members?.find(x => x.id === c.by?.id);
      if (m) m.readSeq = Math.max(m.readSeq || 0, c.seq || 0);
      if (s && c.by?.id === PEOPLE.data?.me?.id) s.unread = 0;
      return peopleDrawSpace(c.id);
    }
    if (c.message) {
      peoplePut(c.message);
      if (c.what === 'new') {
        PEOPLE.typing.delete(c.id);
        if (!s) return peopleLoad();
        s.lastSeq = Math.max(s.lastSeq || 0, c.message.seq);
        s.lastAt = c.message.at;
        s.last = { id: c.message.id, seq: c.message.seq, by: c.message.agentLabel || c.message.author?.name || '', text: String(c.message.text || '(a file)').replace(/[*_`~#>]+/g, '').replace(/\s+/g, ' ').slice(0, 140), at: c.message.at };
        if (peopleShowing(c.id)) peopleMarkRead(c.id); else s.unread = Math.max(0, s.lastSeq - (s.readSeq || 0));
        PEOPLE.data.spaces.sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
      }
      peopleDrawSpace(c.id);
      return peopleDrawLists();
    }
    peopleLoad().then(() => { if ([...PEOPLE.views].some(v => v.open === c.id)) peopleRefresh(c.id); });   // the space itself changed: members, a name, pins
  });
}

/** Whether a space is on screen now in some view (then what arrives there is read). */
function peopleShowing(id) {
  if (document.hidden) return false;
  for (const v of PEOPLE.views) if (v.showing?.() === id) return true;
  return false;
}

function peopleMarkRead(id) {
  const s = peopleSpace(id);
  if (!s?.member) return;
  s.unread = 0;
  peopleDrawLists();
  clearTimeout(PEOPLE.readTimer);
  PEOPLE.readTimer = setTimeout(() => apiFetch(`/api/people/spaces/${encodeURIComponent(id)}/read`, { method: 'POST', body: { seq: s.lastSeq } })
    .then(r => { s.readSeq = r.readSeq; }).catch(() => { /* it is read again next time */ }), 400);
}

/** The direct conversation with someone: made once, found after; opened in the view that asked. */
async function peopleDm(personId, where = 'page') {
  try {
    const s = await apiFetch('/api/people/dm', { method: 'POST', body: { person: personId } });
    await peopleLoad();
    peopleOpenIn(where, s.id);
  } catch (e) { appAlert(e.message); }
}

/** Open a space in the page or in the floating chat. */
function peopleOpenIn(where, id) {
  if (where === 'float' && typeof peopleFloatOpen === 'function') return peopleFloatOpen(id);
  if (typeof nav === 'function' && currentTab !== 'people') nav('people');
  if (typeof peoplePageOpen === 'function') peoplePageOpen(id);
}

/** One space read again (its members and pins) and drawn. */
async function peopleRefresh(id) {
  try { const full = await apiFetch(`/api/people/spaces/${encodeURIComponent(id)}`); const row = peopleSpace(id); if (row) Object.assign(row, full); } catch { /* left as it was */ }
  peopleDrawSpace(id);
}

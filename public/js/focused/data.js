/* What the Focused view reads, from routes that already exist: who is signed in, the day (GET /api/ambient — the
   calendar the person may see and their notices), the week (GET /api/ambient/week), the conversation
   (GET /api/chat/history), the work going on behind it (the main chat's background jobs, else the running missions).
   Each read is kept a little, so moving between screens costs nothing. Nothing here writes. */
const _fcCache = new Map();   // url → {at, p}

/** GET `url`, the same answer for `ms` (a failed read is not kept). */
// A feature this install's licence leaves out answers 404 (lib/licence.js): it is not asked at all (CI's core smoke).
const fcHas = id => typeof licenceFeatureOn !== 'function' || licenceFeatureOn(id);
const fcAccountsOn = () => fcHas('everyday-accounts');

function fcGet(url, ms = 20000) {
  if (url.startsWith('/api/accounts') && !fcAccountsOn()) return Promise.reject(Object.assign(new Error('Not in this licence.'), { status: 404 }));
  const c = _fcCache.get(url);
  if (c && Date.now() - c.at < ms) return c.p;
  const p = apiFetch(url).catch(e => { _fcCache.delete(url); throw e; });
  _fcCache.set(url, { at: Date.now(), p });
  return p;
}
function fcForget(prefix = '') { for (const k of [..._fcCache.keys()]) if (k.startsWith(prefix)) _fcCache.delete(k); }

const fcMe = () => fcGet('/api/auth/me', 300000).catch(() => ({}));
const fcProduct = () => (typeof BRAND !== 'undefined' && BRAND?.product) || document.querySelector('[data-brand]')?.textContent?.trim() || 'the assistant';
const fcFirstName = me => String(me?.name || me?.email || '').trim().split(/[\s@]/)[0] || '';
const fcIsHost = me => (me?.rights || []).includes('host');

/** "Good morning" by this screen's own clock. */
function fcGreeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** 13:00, by this screen's clock; an all-day event says so. */
function fcTime(iso, allDay) {
  if (allDay) return 'All day';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fcDay(d, opts = { weekday: 'short' }) { return d.toLocaleDateString([], opts); }
function fcSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

/** "2 weeks ago", plainly. */
function fcAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 90) return 'just now';
  const m = s / 60, h = m / 60, d = h / 24;
  return m < 60 ? `${Math.round(m)} min ago` : h < 24 ? `${Math.round(h)} h ago` : d < 2 ? 'yesterday' : d < 14 ? `${Math.round(d)} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : 'a while ago';
}

/** The day: weather, today's events, the person's notices (modules/ambient). */
const fcToday = () => fcGet('/api/ambient', 60000).catch(() => ({ calendar: { events: [] }, notices: [] }));
/** The week from today (ambient/calendar.js week). */
const fcWeek = () => fcGet('/api/ambient/week?days=7', 60000).catch(e => ({ events: [], none: e.message }));
/** The person's own conversation (the Orchestrator): its rows and its id. */
const fcHistory = (fresh) => { if (fresh) fcForget('/api/chat/history'); return fcGet('/api/chat/history', 5000); };

/**
 * The work going on behind the main chat, newest working first, each {id, title, running, done, total, text, ended}:
 * the main chat's background jobs (experiment alwaysFree, harness/background.js) where it lists them, else the
 * running missions and automatic turns this person may see (GET /api/harness/working).
 */
async function fcBackground(sessionId) {
  try {
    if (sessionId) {
      const box = await fcGet(`/api/harness/sessions/${encodeURIComponent(sessionId)}/inbox`, 5000);
      if (Array.isArray(box.background) && box.background.length)
        return box.background.map(r => ({ id: r.id, title: r.title, running: r.running && !r.ended, ended: r.ended, state: r.state,
          done: r.plan?.done ?? null, total: r.plan?.total ?? null, text: r.plan?.text || '' }));
    }
    const w = await fcGet('/api/harness/working', 5000);
    return (w.missions || []).map(m => ({ id: m.sessionId, title: m.label, running: true, ended: false, done: null, total: null, text: '' }));
  } catch { return []; }
}

/** What waits on this person: notices from the day, plus questions the agents asked (ambient's own list). */
function fcNeedsYou(day) {
  return (day?.notices || []).filter(n => ['ask', 'propose', 'notice', 'failed'].includes(n.kind));
}

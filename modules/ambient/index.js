'use strict';

/**
 * The ambient screen (asked 2026-10-06: "the behaviour of a Google Nest … the usual info like weather, forecast, quick
 * buttons, the day's plans from the calendar, notifications"): what a resting screen shows behind the galaxy. One read,
 * `GET /api/ambient?place=&units=`, so a tablet on a wall asks once a minute and draws: the weather where the screen
 * says it is (weather.js, Open-Meteo), the day from the owner's calendar when this person may see it (calendar.js), and
 * the notices that are this person's — questions the agents are waiting on, proposals to decide (a host's), missions
 * working and just finished. The page itself is public/js/ambient.js.
 */
const weather = require('./weather');
const calendar = require('./calendar');

const person = req => require('../harness/turn/client').dashboardClient(req).user;
const isHost = p => !p?.id || require('../auth/rights').can(p.role, 'host');

/** What needs this person: each notice {kind, text, at, page}. */
function notices(p) {
  const may = sid => isHost(p) || (!!sid && require('../harness/session-access').mayUse(p, sid));
  const out = [];
  const asks = require('../harness/approval').pending().filter(a => may(a.sessionId));
  if (asks.length) out.push({ kind: 'ask', text: `${asks.length} question${asks.length === 1 ? '' : 's'} from the agents waiting for an answer`, at: asks[0].at, page: 'harness' });
  if (isHost(p)) {
    const props = require('../harness/installs').list().pending.length;
    if (props) out.push({ kind: 'propose', text: `${props} install${props === 1 ? '' : 's'} proposed by the agent, to decide`, page: 'harness' });
  }
  // A reminder or the agent's notice to this person (notices/), until they dismiss it on a page.
  for (const n of require('../notices').list(p, isHost(p)).slice(0, 4)) out.push({ kind: 'notice', text: n.text ? `${n.title}: ${n.text}` : n.title, at: n.at, page: 'harness' });
  const since = Date.now() - 12 * 3600000;
  for (const m of require('../agents/missions').list({ limit: 30 })) {
    if (!may(m.sessionId)) continue;
    const what = `${m.label || m.agentId}: ${String(m.task || '').split('\n')[0].slice(0, 90)}`;
    if (m.state === 'running') out.push({ kind: 'working', text: what, at: m.startedAt, page: 'harness' });
    else if (['done', 'failed'].includes(m.state) && m.endedAt && Date.parse(m.endedAt) > since)
      out.push({ kind: m.state, text: what, at: m.endedAt, page: 'harness' });
  }
  return out.slice(0, 12);
}

/** The day for one person: the weather at `place`, today's plan from their calendar, their notices. */
async function today(p, { place = '', units = 'metric' } = {}) {
  const [w, cal] = await Promise.all([
    weather.forecast(String(place || ''), units === 'imperial' ? 'imperial' : 'metric').catch(e => ({ error: e.message })),
    calendar.today(p).catch(e => ({ events: [], errors: [e.message] })),
  ]);
  return { weather: w, calendar: cal, notices: notices(p), at: new Date().toISOString() };
}

async function view(req) {
  const q = req.query || {};
  return today(person(req), { place: q.place, units: q.units });
}

function mount(app) {
  app.get('/api/ambient', async (req, res) => { try { res.json(await view(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  app.get('/api/ambient/place', async (req, res) => {
    try { res.json(await weather.locate(String(req.query.q || ''))); } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });
}

module.exports = { view, today, notices, mount };

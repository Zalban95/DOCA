'use strict';

/**
 * A visible Stop for everything that runs (audit 2026-10-06, TODO H10.14: "stop means stop, maybe with a visible stop").
 * `POST /api/harness/missions/:id/stop` stops a specialist at its next step — and the supervisor then leaves the work
 * chat that sent it waiting for its person instead of waking it (supervisor.missionStopped). `GET
 * /api/harness/working` is what runs on its own right now — missions and automatic turns, each with why — so the
 * Harness can draw them, each with its Stop (a conversation's own Stop is POST /api/harness/sessions/:id/stop).
 */
const person = req => require('../harness/turn/client').dashboardClient(req).user;
// `who` is the person acting: the panel's signed-in person, or a device's owner (api-v1/parity.js).
const mayUse = (who, sid) => !sid || require('../harness/session-access').mayUse(who, sid);

function stop(who, id) {
  const m = require('./missions').get(id);
  if (!m || !mayUse(who, m.sessionId)) throw Object.assign(new Error(`No mission called "${id}".`), { status: 404 });
  if (m.state !== 'running' || !m.sessionId) return { stopped: false, mission: m, note: `It is ${m.state}: nothing to stop.` };
  return { stopped: require('../harness/agent').cancel(m.sessionId), mission: m, note: 'Stopping at its next step; what sent it waits for you.' };
}

function working(who) {
  const auto = require('../harness/supervisor').autoNow().filter(a => mayUse(who, a.sessionId));
  const missions = require('./missions').running().filter(m => mayUse(who, m.sessionId))
    .map(m => ({ id: m.id, label: m.label || m.agentId, sessionId: m.sessionId, steps: m.steps || 0, startedAt: m.startedAt }));
  const stopped = require('../harness/stopped-work').stopped().filter(s => mayUse(who, s.id))
    .map(s => ({ sessionId: s.id, title: s.title || s.id, why: s.job.stoppedWhy || 'stopped by a person' }));
  return { missions, auto, stopped };
}

function mount(app) {
  const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.post('/api/harness/missions/:id/stop', h(req => stop(person(req), req.params.id)));
  app.get('/api/harness/working', h(req => working(person(req))));
}

module.exports = { stop, working, mount };

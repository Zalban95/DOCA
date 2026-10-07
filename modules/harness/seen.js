'use strict';

/**
 * Read means done (CONSTITUTION V10; the owner, 2026-10-07: "read/confirmed means done unless the user's
 * intervention is needed"; TODO P1.4). A specialist's mission or a work chat that finished waits for its person to
 * open the result; when they do — the panel's Chat or log on it, opening its conversation, or a device saying so —
 * it is `seenAt`, and that is the end of it: the panel's bar of live work drops it, every device hears it quietly
 * (`agent.mission` with `seenAt` and `quiet`: clear the notice, notify nothing) and its conversation stays where it
 * was. Only its own person's opening counts — a host looking at someone else's work does not mark it for them — and
 * a turn that starts in the conversation clears it (agent.js), so work that runs again waits to be opened again. And
 * what still needs the person (a question, a proposal, a plan to approve) is not answered by being seen: those are
 * their own decisions (decisions.js).
 *
 *   POST /api/harness/seen/:id            the panel (a mission id or a work chat's conversation id)
 *   POST /api/v1/harness/missions/:id/seen a device (api-v1/parity.js)
 */
const FINISHED = ['done', 'failed', 'cancelled'];

/** Mark what `id` names as seen by `person`. Returns { seen, kind } — seen false when there was nothing to mark. */
function mark(id, person) {
  const access = require('./session-access');
  const missions = require('../agents/missions');
  const m = missions.get(id);
  if (m) {
    const sid = m.sessionId || m.by;
    if (person?.id && !access.mayUse(person, sid)) throw Object.assign(new Error('Unknown mission'), { status: 404 });
    if (!FINISHED.includes(m.state) || m.seenAt || !isTheirs(person, sid)) return { seen: !!m.seenAt, kind: 'mission' };
    missions.announce(missions.patch(m.id, { seenAt: new Date().toISOString() }), { quiet: true });
    return { seen: true, kind: 'mission' };
  }
  const memory = require('./memory');
  const s = memory.getSession(id);
  if (!s || (person?.id && !access.mayUse(person, id))) throw Object.assign(new Error('Unknown conversation'), { status: 404 });
  const workview = require('./workview');
  const state = s.kind === 'work' ? workview.payloadOf(require('./organization').session(id)).state : null;
  if (!FINISHED.includes(state) || s.seenAt || !isTheirs(person, id)) return { seen: !!s.seenAt, kind: s.kind || 'chat' };
  memory.updateSession(id, { seenAt: new Date().toISOString() });
  workview.announce(id, { quiet: true });
  return { seen: true, kind: 'work' };
}

/** The work's own person — or, for a conversation nobody claimed, whoever opens it. */
function isTheirs(person, sessionId) {
  const owner = require('./session-access').ownerOf(sessionId);
  return !owner || !person?.id || owner === person.id;
}

function mount(app) {
  app.post('/api/harness/seen/:id', (req, res) => {
    try { res.json(mark(req.params.id, req.auth && { ...req.auth.user, role: req.auth.role })); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { mark, mount, FINISHED };

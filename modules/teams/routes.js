'use strict';

/**
 * Teams in the panel (Harness → Teams, the missions bar): under /api/harness/missions/teams because a team is missions
 * on a board — the same right as the missions (auth/rights.js: reading `read`, acting `chat`), and each team only for
 * whoever may open the conversation that leads it (session-access, the transcript's own rule).
 *
 *   GET  /api/harness/missions/teams[?all=1]        the teams this person may see (all: with the put-away ones)
 *   GET  /api/harness/missions/teams/:id            one board: tasks with state and percentage, notes, its document
 *   POST /api/harness/missions/teams/:id/stop       stop every task
 *   POST /api/harness/missions/teams/:id/keep-going {on}   try failed tasks again, up to its rounds
 *   POST /api/harness/missions/teams/:id/archive    {on}   put a finished team away (or back)
 * Mounted before /api/harness/missions/:id.
 */
const teams = require('./index');

const who = req => require('../harness/turn/client').dashboardClient(req).user;
const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

/** The team, if this person may open its leader's conversation; else 404, as if absent. */
function mine(req) {
  const team = teams.get(req.params.id);
  let ok = false;
  try { ok = !!team && require('../harness/session-access').mayUse(who(req), team.by); } catch { ok = false; }
  if (!ok) throw Object.assign(new Error(`No team called "${req.params.id}".`), { status: 404 });
  return team;
}

function mount(app) {
  app.get('/api/harness/missions/teams', h(req => {
    const rows = teams.visible(who(req), { all: req.query.all === '1' });
    return { teams: rows.map(r => teams.view(teams.get(r.id))).filter(Boolean),
      maxRounds: require('../settings-schema').value('teams.maxRounds') };
  }));
  app.get('/api/harness/missions/teams/:id', h(req => ({ team: teams.view(mine(req)) })));
  app.post('/api/harness/missions/teams/:id/stop', h(async req => ({ team: await teams.stop(mine(req).id) })));
  app.post('/api/harness/missions/teams/:id/keep-going', h(async req => ({ team: await teams.keepGoing(mine(req).id, req.body?.on !== false) })));
  app.post('/api/harness/missions/teams/:id/archive', h(req => ({ team: teams.archive(mine(req).id, req.body?.on !== false) })));
}

module.exports = { mount };

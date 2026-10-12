'use strict';

/**
 * Projects → Team branches (harness-teams/branches.js): under /api/projects, so the host right like every project route.
 *
 *   GET  /api/projects/:id/team-branches                 every team/… branch with what it adds over the current branch
 *   GET  /api/projects/:id/team-branches/diff?branch=    one branch's files and diff
 *   POST /api/projects/:id/team-branches/merge {branch}  merge it in (refused with uncommitted changes; a conflict is undone)
 */
const branches = require('./branches');

function mount(app, { h, P }) {
  app.get('/api/projects/:id/team-branches', h(req => branches.list(P(req).root)));
  app.get('/api/projects/:id/team-branches/diff', h(req => branches.diff(P(req).root, String(req.query.branch || ''))));
  app.post('/api/projects/:id/team-branches/merge', h(async req => {
    const who = require('../harness/turn/client').dashboardClient(req).user;
    const r = await branches.merge(P(req).root, String(req.body?.branch || ''), { by: who?.name || who?.email || 'a person' });
    require('../live').changed('projects', req.params.id, 'branches');
    return r;
  }));
}

module.exports = { mount };

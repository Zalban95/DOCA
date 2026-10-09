'use strict';

/**
 * The Skills page's newer routes, mounted before /api/harness/skills/:name (agents/routes.js) so their words are not
 * read as a skill's name:
 *
 *   GET  /api/harness/skills/suggest?q=&session=        skills a typed message names by a trigger (mechanical; skill-triggers.js)
 *   POST /api/harness/skills/:name/triggers/suggest     one model call proposing more triggers; the person saves (host)
 *   GET  /api/harness/skills/online?q=                  search public collections (skill-online.js; host)
 *   GET  /api/harness/skills/online/plan?repo=&dir=     what importing one would bring, nothing written (host)
 *   POST /api/harness/skills/online/import              { repo, dir, overwrite } — copy it in (host)
 *
 * The host-only ones are a host's in auth/rights.js too; checked here as well, since a skill is instructions the agents follow.
 */
const who = req => require('./turn/client').dashboardClient(req).user;
const host = req => { if (!require('./session-access').isHost(who(req))) throw Object.assign(new Error('A host\'s.'), { status: 403 }); };
const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  app.get('/api/harness/skills/suggest', h(req => {
    // `main`: the floating chat's conversation (the Orchestrator's), which the page does not name.
    const session = req.query.session === 'main' ? require('./memory').mainSession().id : req.query.session ? String(req.query.session) : null;
    if (session) require('./session-access').check(who(req), session);
    const skip = session ? require('./skill-use').resolve(session).skills.map(x => x.name) : [];
    return { sessionId: session, auto: session ? require('./skill-next').auto(session) : { on: false },
      suggestions: require('./skill-triggers').match(String(req.query.q || '').slice(0, 4000), { skip }) };
  }));
  app.post('/api/harness/skills/:name/triggers/suggest', h(async req => {
    host(req);
    return { triggers: await require('./skill-triggers').suggestWithModel(req.params.name, { languages: String(req.body?.languages || ''), person: who(req) }) };
  }));
  const online = require('./skill-online');
  app.get('/api/harness/skills/online', h(req => { host(req); return online.search(String(req.query.q || '')); }));
  app.get('/api/harness/skills/online/plan', h(req => { host(req); return online.plan(String(req.query.repo || ''), String(req.query.dir || '')); }));
  app.post('/api/harness/skills/online/import', h(req => {
    host(req);
    return online.importSkill(String(req.body?.repo || ''), String(req.body?.dir || ''), { overwrite: req.body?.overwrite === true });
  }));
}

module.exports = { mount };

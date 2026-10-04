'use strict';

/**
 * Schedules in the panel (TODO H7.1). A person sees and changes their own (a host every one); switching one on
 * — a proposed one included — is that click the agent never gets.
 */
const schedules = require('./index');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const person = req => require('../harness/turn/client').dashboardClient(req).user;
const own = req => {
  const s = schedules.get(req.params.id);
  if (!s || (s.by !== person(req)?.id && !require('../harness/session-access').isHost(person(req)))) throw Object.assign(new Error('No such schedule.'), { status: 404 });
  return s;
};

function mount(app) {
  app.get('/api/schedules', h(req => ({ schedules: schedules.listFor(person(req)) })));
  app.post('/api/schedules', h(req => schedules.create(req.body || {}, { person: person(req), madeBy: 'person' })));
  app.post('/api/schedules/:id/state', h(req => { own(req); return schedules.setState(req.params.id, req.body?.state); }));
  app.post('/api/schedules/:id/run', h(req => { own(req); return schedules.runNow(req.params.id); }));
  app.delete('/api/schedules/:id', h(req => { own(req); return schedules.remove(req.params.id); }));
}

module.exports = { mount };

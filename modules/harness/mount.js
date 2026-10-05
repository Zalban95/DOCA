'use strict';

/**
 * The harness's route groups that mount themselves, so server.js carries one
 * line for all of them rather than one per group.
 */
function mount(app) {
  require('./rules-routes').mount(app);       // the memory rules: read, write, review, answer, undo
  require('./questions-routes').mount(app);   // questions the agent is waiting on the owner for
  require('../canvas/routes').mount(app);     // canvases: where to open one (never the page itself)
  require('../projects/routes').mount(app);   // projects: search, git, commands, the bound work chat
  require('../agents/routes').mount(app);     // definitions as markdown in and out; persona.md, human.md
  // What this host can do, probed per OS (host-capabilities.js, hive.md §7).
  app.get('/api/host/capabilities', (req, res) => res.json(require('../host-capabilities').capabilities({ fresh: req.query.fresh === '1' })));
  require('./tab-routes').mount(app);
  require('../experiments').mount(app);
  require('../migrations').mount(app);   // which prefs migrations this install has had (migrations.js)   // experiments behind flags, each with its write-up (experiments.js)
  require('../search/routes').mount(app);   // web search: the provider and its key (search/)
  require('../screens/routes').mount(app);   // a browser is a device: this screen's settings (screens/)
  require('../packs/routes').mount(app);   // packs: export and import in other tools' formats (packs/)
  require('../schedules/routes').mount(app);   // turns and recipes on a timetable (schedules/)
  require('../face/routes').mount(app);   // the face: what the hive is doing, on any screen (face/)
  require('../recipes/routes').mount(app);   // recipes: what worked, run again without the thinking (recipes/)
  require('../channels/telegram/routes').mount(app);   // Telegram as a channel (channels/telegram)
  require('../computers/routes').mount(app);   // computers for agents (computers/)           // a conversation as a chat tab: title, mode, approval, its queue
  require('./guard/routes').mount(app);         // the guards that screen what the airlock lets in (guard/)
  // The context Ollama really serves a model with (ollama-context.js; H-20).
  app.get('/api/harness/ollama-context', async (req, res) => {
    try { res.json(await require('./ollama-context').check(String(req.query.model || ''), Number(req.query.declared) || 0)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // A model's window as its own server reports it, or null (context-window.js). Offered, never applied.
  app.get('/api/harness/context-window', async (req, res) => {
    try { res.json(await require('./context-window').discover(String(req.query.provider || ''), String(req.query.model || ''))); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  // The model this conversation runs on, chosen in the chat, with or without the fallback order (turn/choice.js).
  const own = req => require('./session-access').check(req.auth && { ...req.auth.user, role: req.auth.role }, req.params.id);
  app.get('/api/harness/sessions/:id/model', (req, res) => {
    try { own(req); res.json(require('./turn/choice').view(req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/harness/sessions/:id/model', (req, res) => {
    try { own(req); require('./turn/choice').set(req.params.id, req.body || {}); res.json(require('./turn/choice').view(req.params.id)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  // The owner's price list for the usage window (prices.js): read with the by-model usage, replaced here.
  app.post('/api/harness/usage/prices', (req, res) => {
    try { res.json(require('./prices').save(req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  // What each provider was found to accept (contracts.js): read, and a lesson forgotten.
  app.get('/api/harness/contracts', (_req, res) => res.json({ learned: require('./contracts').all() }));
  app.delete('/api/harness/contracts/:provider', (req, res) => { require('./contracts').forget(req.params.provider); res.json({ ok: true }); });
  // The panel saying its page is visible (presence.js): read by the agent's per-step readings.
  app.post('/api/presence', (req, res) => {
    require('../presence').beat(req.auth?.user, req.body?.visible !== false);
    res.json({ ok: true });
  });
  // How each turn of a conversation went: the one record (runs.js).
  app.get('/api/harness/runs', (req, res) => {
    try { own({ ...req, params: { id: String(req.query.sessionId || '') } }); } catch (e) { return res.status(e.status).json({ error: e.message }); }
    res.json({ runs: require('./runs').forSession(String(req.query.sessionId || ''), Math.min(100, Number(req.query.limit) || 20)) });
  });
  // What a restart would cut off, and whether one is waiting for it (drain.js).
  app.get('/api/harness/busy', (_req, res) => {
    const drain = require('./drain');
    res.json({ turns: drain.busy(), pending: drain.pending() });
  });
}

module.exports = { mount };

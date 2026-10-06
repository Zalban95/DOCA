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
  require('../releasing').mount(app);   // who may release DOCA unasked: the admin's setting (CONSTITUTION W2)
  require('../migrations').mount(app);   // which prefs migrations this install has had (migrations.js)   // experiments behind flags, each with its write-up (experiments.js)
  require('../search/routes').mount(app);
  require('../retrieval/routes').mount(app);
  require('../vision/routes').mount(app);
  require('../scout/routes').mount(app);
  require('./assistant-routes').mount(app);
  require('../checkpoints').mount(app);
  require('../realtime/routes').mount(app);
  require('../api-v1/client-files').mountPanel(app);
  require('../client-apps/routes').mount(app);
  require('./opendots').mount(app);   // OpenDots as a peer harness: state, settings, its own Compose project (harness/opendots.js)   // DOCA's Android apps: kept, built here, offered to devices (client-apps/)   // the browser extension, to download (clients/browser)   // realtime voice: what a live call uses (realtime/)
  require('../evals/routes').mount(app);
  require('../connectors/routes').mount(app);
  require('../api-v1/a2a').mountCard(app);   // the A2A agent card, public at /.well-known (api-v1/a2a.js)   // OAuth connectors: the owner's accounts as tools (connectors/)   // evaluation sets: run, results, import and export (evals/)   // retrieval: the embedding model, a try, the index (retrieval/)   // web search: the provider and its key (search/)
  require('../screens/routes').mount(app);   // a browser is a device: this screen's settings (screens/)
  require('../packs/routes').mount(app);   // packs: export and import in other tools' formats (packs/)
  require('../schedules/routes').mount(app);   // turns and recipes on a timetable (schedules/)
  require('../live/routes').mount(app);
  require('../screens/showing').mount(app);
  require('../archive').mount(app);
  require('../workstream/routes').mount(app);
  require('../machines').mount(app);   // the agents' machines live, and the pages they serve (machines/)   // the agents' work as it happens: files edited, thinking, commands   // what was put away, in one place (archive.js)   // what each screen shows, and sending a page to one   // every page live on every screen: one change feed (live/, H10.5)
  require('../face/routes').mount(app);   // the face: what the hive is doing, on any screen (face/)
  require('../recipes/routes').mount(app);   // recipes: what worked, run again without the thinking (recipes/)
  require('../channels/telegram/routes').mount(app);   // Telegram as a channel (channels/telegram)
  require('../channels/matrix/routes').mount(app);     // Matrix likewise (channels/matrix)
  require('../channels/slack/routes').mount(app);      // and Slack (channels/slack)
  require('../channels/mail/routes').mount(app);       // and mail (channels/mail)
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
    // Which page this screen shows (Devices). Its record is bound here when the first beat comes before /api/screen.
    let screen = req.auth?.session?.screen || null;
    if (!screen && !req.auth?.session?.deviceId) try { screen = require('../screens').ensure(req, res).id; } catch { /* not a person's browser */ }
    require('../screens/showing').beat(screen, req.body || {});
    res.json({ ok: true });
  });
  // How each turn of a conversation went: the one record (runs.js).
  app.get('/api/harness/runs', (req, res) => {
    try { own({ ...req, params: { id: String(req.query.sessionId || '') } }); } catch (e) { return res.status(e.status).json({ error: e.message }); }
    res.json({ runs: require('./runs').forSession(String(req.query.sessionId || ''), Math.min(100, Number(req.query.limit) || 20)) });
  });
  // What one turn did, step by step (trace.js); ?format=otlp for OpenTelemetry tools (trace-otlp.js).
  app.get('/api/harness/runs/:id/trace', (req, res) => {
    const run = require('./runs').get(req.params.id);
    try { if (!run) throw Object.assign(new Error('No such run.'), { status: 404 }); own({ ...req, params: { id: run.sessionId } }); }
    catch (e) { return res.status(e.status || 404).json({ error: e.status === 404 || !e.status ? 'No such run.' : e.message }); }
    const spans = require('./trace').spans(run.id);
    if (req.query.format === 'otlp') {
      res.setHeader('Content-Disposition', `attachment; filename="${run.id}.otlp.json"`);
      return res.json(require('./trace-otlp').otlp(run, spans));
    }
    res.json({ run, spans });
  });
  // What a restart would cut off, and whether one is waiting for it (drain.js).
  app.get('/api/harness/busy', (_req, res) => {
    const drain = require('./drain');
    res.json({ turns: drain.busy(), pending: drain.pending() });
  });
}

module.exports = { mount };

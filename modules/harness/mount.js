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
  // The context Ollama really serves a model with (ollama-context.js; H-20).
  app.get('/api/harness/ollama-context', async (req, res) => {
    try { res.json(await require('./ollama-context').check(String(req.query.model || ''), Number(req.query.declared) || 0)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  // What a restart would cut off, and whether one is waiting for it (drain.js).
  app.get('/api/harness/busy', (_req, res) => {
    const drain = require('./drain');
    res.json({ turns: drain.busy(), pending: drain.pending() });
  });
}

module.exports = { mount };

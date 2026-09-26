'use strict';

/**
 * /api/harness/questions — what the agent is waiting for the owner to answer
 * (ask_device), open at the desk as well as on the devices it was sent to.
 * Whichever answers first is the answer (reach.js).
 */
const reach = require('./reach');

function fail(res, e) { res.status(e.status || 500).json({ error: e.message }); }

function mount(app) {
  app.get('/api/harness/questions', (_req, res) => res.json({ questions: reach.openQuestions() }));
  app.post('/api/harness/questions/:id', (req, res) => {
    try { res.json({ ok: true, answer: reach.answerAtPanel(req.params.id, { choiceId: req.body?.choiceId, text: req.body?.text }) }); }
    catch (e) { fail(res, e); }
  });
}

module.exports = { mount };

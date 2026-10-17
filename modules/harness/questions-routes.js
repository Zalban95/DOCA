'use strict';

/**
 * /api/harness/questions — what the agent is waiting for the owner to answer
 * (ask_device), open at the desk as well as on the devices it was sent to.
 * Whichever answers first is the answer (reach.js).
 */
const reach = require('./reach');

function fail(res, e) { res.status(e.status || 500).json({ error: e.message }); }

function mount(app) {
  // Each person their own questions (reach.mayAnswer): a question names whose it is, never who happens to look.
  const personOf = req => require('./turn/client').personOf(req.auth);
  app.get('/api/harness/questions', (req, res) => res.json({ questions: reach.openQuestions(personOf(req)) }));
  app.post('/api/harness/questions/:id', (req, res) => {
    try { res.json({ ok: true, answer: reach.answerAtPanel(req.params.id, { choiceId: req.body?.choiceId, text: req.body?.text }, personOf(req)) }); }
    catch (e) { fail(res, e); }
  });
}

module.exports = { mount };

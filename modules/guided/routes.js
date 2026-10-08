'use strict';

/**
 * Settings → Set-up's routes (all a host's: setting up the machine is the owner's — auth/rights.js).
 *
 *   GET  /api/guided/state     whether the owner chose guided or advanced yet, and the hub's shape (cheap: no probing)
 *   GET  /api/guided           the machine, the questions, the picks for every role, the answers kept
 *   POST /api/guided/choose    {mode: guided|advanced} — the first-run choice; advanced changes nothing else
 *   POST /api/guided/plan      {answers} — what they would set up, written nowhere
 *   POST /api/guided/apply     {answers} — keep them, and put each install in front of the person as a proposal
 *   GET  /api/guided/suggestions          the suggested models in use: which list, the day checked, what was accepted here
 *   POST /api/guided/suggestions/check    ask the model scout to look for newer ones now (its experiment on), else say how
 *   POST /api/guided/suggestions/forget   {role, id} — take back one accepted here (docs/design/model-suggestions.md)
 */
const machine = require('./assess');   // called through the module, so a test can stand in a made-up machine
const suggestions = require('./suggestions');
const plan = require('./plan');

/**
 * What is already set up: the agent's model, when one is configured and answers (any provider — a hosted one, or an
 * OpenAI-compatible server the person runs and added by address). Through the harness's own status, so Set-up and
 * the chat cannot disagree about whether DOCA has a model.
 */
async function have() {
  try {
    const agent = require('../harness/agent');
    if (!agent.params().model) return {};   // nothing chosen: nothing to ask
    const s = await agent.status();
    return s.ready && s.reachable ? { chat: { provider: s.provider, model: s.model } } : {};
  } catch { return {}; }
}

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

async function overview() {
  const [a, got] = await Promise.all([machine.assess(), have()]);
  const doc = suggestions.load();
  const { pickAll, shapeOf } = require('./pick');
  return {
    ...plan.setup(),
    machine: a,
    shapeHere: shapeOf(a, doc),
    picks: pickAll(a, doc),
    uses: Object.entries(plan.USES).map(([id, u]) => ({ id, label: u.label })),
    devices: Object.entries(plan.DEVICES).map(([id, d]) => ({ id, label: d.label })),
    answers: plan.get(),
    have: got,
    suggestions: suggestions.about(),
  };
}

function mount(app) {
  app.get('/api/guided/state', h(() => plan.setup()));
  app.get('/api/guided', h(() => overview()));
  app.post('/api/guided/choose', h(req => {
    const mode = req.body?.mode;
    if (!['guided', 'advanced'].includes(mode)) throw Object.assign(new Error('mode is guided or advanced'), { status: 400 });
    return plan.setSetup({ mode });
  }));
  app.post('/api/guided/plan', h(async req => plan.plan(req.body?.answers || {}, await machine.assess(), suggestions.load(), { have: await have() })));
  app.get('/api/guided/suggestions', h(() => ({ ...suggestions.about(), accepted: require('./overlay').list(), watching: suggestions.load().watching || [] })));
  app.post('/api/guided/suggestions/check', h(() => require('../scout/model-suggestion').check()));
  app.post('/api/guided/suggestions/forget', h(req => require('./overlay').forget(String(req.body?.role || ''), String(req.body?.id || ''))));
  app.post('/api/guided/apply', h(async req => plan.apply(req.body?.answers || {}, await machine.assess(), suggestions.load(),
    { by: req.auth?.user?.id || null, have: await have() })));
}

module.exports = { mount, overview, have };

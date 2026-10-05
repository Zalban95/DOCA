'use strict';

/**
 * The model scout's panel routes (Settings → Harness → Scout), all a host's: what it watches and suggested, switching
 * it on, a look or a brief now, and a person's decisions — accept (a line in TODO.md), decline (with the reason the
 * next brief reads), start the work.
 */
const scout = require('./index');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const person = req => require('../harness/turn/client').dashboardClient(req).user;
const KEYS = { everyDays: 'number', growthLikes: 'number', watch: 'array', feeds: 'array', repo: 'string', implementer: 'string' };

const view = () => ({ experiment: scout.on(), settings: scout.settings(), state: scout.state(), repo: scout.repo(),
  suggestions: scout.list().slice().reverse(), roles: require('./roles').roles() });

function mount(app) {
  app.get('/api/scout', h(view));
  app.post('/api/scout/enable', h(req => { scout.enable(req.body?.on === true, person(req)); return view(); }));
  app.post('/api/scout/settings', h(req => {
    const b = req.body || {}, { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs(), next = { ...(prefs.scout || {}) };
    for (const [k, t] of Object.entries(KEYS)) {
      if (b[k] === undefined) continue;
      if (t === 'array') {
        if (!Array.isArray(b[k]) || b[k].some(x => typeof x !== 'string' || x.length > 300)) throw Object.assign(new Error(`${k}: a list of strings.`), { status: 400 });
        next[k] = b[k].map(x => x.trim()).filter(Boolean).slice(0, 50);
      } else if (t === 'number') { const n = Number(b[k]); if (!(n >= 1)) throw Object.assign(new Error(`${k}: a number of 1 or more.`), { status: 400 }); next[k] = n; }
      else next[k] = String(b[k]).trim().slice(0, 500);
    }
    savePrefs({ ...prefs, scout: next });
    return view();
  }));
  app.post('/api/scout/look', h(async () => { const r = await require('./signals').look(); return { look: { at: r.at, first: r.first, notable: r.notable, failures: r.failures, models: r.models.length, fresh: r.fresh.length }, brief: require('./signals').brief(r) }; }));
  app.post('/api/scout/brief', h(async () => {
    if (!scout.on()) throw Object.assign(new Error('The model scout is an experiment that is off (Settings → Developer).'), { status: 409 });
    scout.brief('asked').catch(() => {});
    return { started: true, sessionId: scout.state().sessionId };
  }));
  app.post('/api/scout/:id/accept', h(req => scout.accept(req.params.id, person(req)?.name || person(req)?.email)));
  app.post('/api/scout/:id/decline', h(req => scout.decline(req.params.id, req.body?.reason, person(req)?.name || person(req)?.email)));
  app.post('/api/scout/:id/work', h(req => scout.work(req.params.id, person(req))));
}

module.exports = { mount };

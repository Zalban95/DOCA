'use strict';

/**
 * The panel's side (a host's: /api/services/* in auth/rights.js): each service's standing for its row — "last used
 * 12 min ago · stops after 30 min idle", "kept on while the panel is open" — the switch in Settings → System →
 * Services, a row's own choices under Advanced, and "Let DOCA manage it" for one started outside DOCA, written down.
 */
const KINDS = new Set(['service', 'llamacpp']);

async function rows(now = Date.now()) {
  const targets = require('./targets'), policy = require('./policy'), usage = require('./usage'), idle = require('./idle');
  const running = await targets.running();
  const held = policy.held(now);
  return targets.list().map(t => {
    const u = usage.row(t.key), up = running.has(t.key);
    const s = up ? idle.standing(t, now, held) : null;
    const comes = policy.startsWhenNeeded(t.key);
    return { key: t.key, kind: t.kind, id: t.id, label: t.label, running: up, managed: policy.managed(t.key), adopted: !!u.adopted,
      startedByDoca: !!u.startedByDoca, lastUsedAt: u.lastUsedAt || null, own: policy.own(t.key),
      idleMinutes: policy.idleMinutes(t.key), stopsWithDoca: policy.stopsWithDoca(t.key), startsWhenNeeded: comes,
      starting: require('./demand').starting(t.key),
      text: s ? s.text : `${u.lastUsedAt ? `last used ${idle.ago(now - u.lastUsedAt)} ago · ` : ''}${comes ? 'starts when needed' : 'stopped'}` };
  });
}

function keyOf(req) {
  const { kind, id } = req.params;
  if (!KINDS.has(kind)) throw Object.assign(new Error('A service or a llama.cpp server.'), { status: 400 });
  const key = `${kind}:${id}`;
  if (!require('./targets').get(key)) throw Object.assign(new Error(`No ${kind} "${id}" here.`), { status: 404 });
  return key;
}

const send = (res, fn) => Promise.resolve().then(fn).then(v => res.json(v)).catch(e => res.status(e.status || 500).json({ error: e.message }));

function mount(app) {
  app.get('/api/services/life', (_req, res) => send(res, async () => ({ settings: require('./policy').view(), held: require('./policy').held(), rows: await rows() })));
  app.post('/api/services/life', (req, res) => send(res, () => ({ settings: require('./policy').save({ all: req.body || {} }) })));
  app.post('/api/services/life/:kind/:id', (req, res) => send(res, () => {
    const key = keyOf(req);
    require('./policy').save({ key, mine: req.body || {} });
    return { ok: true, own: require('./policy').own(key) };
  }));
  // A host lets DOCA manage one started outside it — or takes that back. Written down as the person's act.
  app.post('/api/services/life/:kind/:id/adopt', (req, res) => send(res, () => {
    const key = keyOf(req), on = req.body?.on !== false;
    const acts = require('../machines/acts');
    require('./usage').adopt(key, on, acts.personOf(req.auth?.user));
    require('./usage').save();
    if (on) acts.note({ kind: req.params.kind, id: req.params.id, act: 'adopt', ok: true }, { from: 'person', person: acts.personOf(req.auth?.user), via: 'the panel' });
    return { ok: true, managed: require('./policy').managed(key) };
  }));
}

module.exports = { mount, rows };

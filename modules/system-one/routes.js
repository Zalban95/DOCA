'use strict';

/**
 * The panel's decision-model routes (Field → Models → Decision models): which System 1 model, how sure it must be,
 * Laya's service (set up, started, stopped, its state) beside Jev's key, and a test. All a host's — a process on this
 * machine, a download of gigabytes, and (for jev) a key for services spent. Whether DOCA *uses* a decision model is
 * the experiment systemOne (Settings → Developer); configuring and testing one works with it off.
 */
const one = require('./index');
const service = require('./service');

function mount(app) {
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/system-one', h(async () => {
    const health = await service.health(1500);
    return { on: one.on(), settings: one.settings(), service: { ...service.status(), computesOn: health ? Object.values(health.checkpoint_devices || {}).join(', ') || null : null }, jev: jev() };
  }));
  app.post('/api/system-one/settings', h(req => save(req.body || {})));
  app.post('/api/system-one/setup', h(() => service.setup()));
  app.post('/api/system-one/setup/stop', h(() => service.job.stop()));
  app.post('/api/system-one/start', h(() => service.start({ why: 'started by a person (Settings → Developer)' })));
  app.post('/api/system-one/stop', h(() => service.stop()));
  // A test: a request asked the triage's and the call's questions, as DOCA would — raw, whatever the threshold.
  app.post('/api/system-one/test', h(req => test(String(req.body?.text || ''), req.auth?.user || null)));
}

/** Jev's side: the key for services it names, and whether it is there (never the key). */
function jev() {
  const name = one.settings().jevKey, k = require('../service-keys').list().find(x => x.name === name);
  return { key: name, present: !!k, origin: k?.origin || null, right: !!k && k.origin === new URL(one.JEV).origin };
}

async function test(text, person) {
  if (!text.trim()) throw Object.assign(new Error('Write a request to test with.'), { status: 400 });
  const d = require('./decisions');
  const [size, route] = await Promise.all([
    one.decide({ state: d.asked(text, false), questions: [d.SIZE, d.PACE], person }),
    one.decide({ state: d.asked(text, true), questions: [d.ROUTE], person }),
  ]);
  const threshold = one.settings().threshold;
  const view = a => ({ ...a, sure: one.sure(a, threshold) });
  return { provider: size.provider, model: size.model, ms: size.ms + route.ms, threshold,
    answers: { size: view(size.answers.size), pace: view(size.answers.pace), route: view(route.answers.route) } };
}

/** The settings the card edits, each checked against its declared type (settings-schema.js) before it is written. */
function save(body) {
  const schema = require('../settings-schema'), { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs(), next = { ...(prefs.systemOne || {}) };
  for (const [k, v] of Object.entries(body)) {
    const spec = schema.leaf(`systemOne.${k}`);
    if (!spec) throw Object.assign(new Error(`systemOne has no setting "${k}".`), { status: 400 });
    const val = spec.type === 'number' || spec.type === 'integer' ? Number(v) : v;
    if (v === '' && spec.type === 'string' && !spec.oneOf) { delete next[k]; continue; }
    if (!schema.valid(spec, val)) throw Object.assign(new Error(`${k}: not a value this takes.`), { status: 400 });
    next[k] = val;
  }
  savePrefs({ ...prefs, systemOne: next });
  return { settings: one.settings() };
}

module.exports = { mount, save, test, jev };

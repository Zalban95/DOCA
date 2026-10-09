'use strict';

/**
 * Experiments (docs/design/hive.md §8): new approaches behind a flag, off by default, each written up before it
 * ships — the hypothesis, what is measured and how, the cost, the risks, the rollback — in docs/experiments/<id>.md,
 * which Settings → Developer shows beside the switch. A flag lives in `experiments.<id>` (settings-schema.js) and
 * is the owner's alone: not proposable. Graduating means the flag goes and the code stays; failing, the code goes.
 */
const fs = require('fs');
const path = require('path');

// since: the release that added it; measure: 'script' (bin/experiments/<doc's name>.js, `npm run experiment -- <name>`)
// or 'manual' (its write-up says how a person measures it). Its last measurement is the newest date in its write-up's
// results table, so measuring is writing the row, and an experiment nobody measured for STALE_DAYS says so
// (audit 2026-10-06, coh F20; TODO C6).
const EXPERIMENTS = [
  { id: 'recipeRepair', label: 'Recipes repair themselves', doc: 'recipe-repair.md', todo: 'H3.4', since: '2.176.0', measure: 'script' },
  { id: 'retrieval', label: 'Search memory and conversations by meaning', doc: 'retrieval.md', todo: 'H10.2', since: '2.181.0', measure: 'script' },
  { id: 'bargeIn', label: 'Talk over the agent in a voice call', doc: 'barge-in.md', todo: 'H8.3', since: '2.192.0', measure: 'manual' },
  { id: 'realtimeVoice', label: 'Calls with a realtime speech model', doc: 'realtime-voice.md', todo: 'H8.3', since: '2.200.0', measure: 'script' },
  { id: 'faceVoice', label: 'The face follows a voice call', doc: 'face-voice.md', todo: 'H8.2', since: '2.193.0', measure: 'manual' },
  { id: 'packRegistry', label: 'Publish packs for other hubs, and fetch theirs', doc: 'pack-registry.md', todo: 'H4.6', since: '2.198.0', measure: 'manual' },
  { id: 'wakeWord', label: 'Start a call by saying the hive\'s name', doc: 'wake-word.md', todo: 'H8.2', since: '2.210.0', measure: 'script' },
  { id: 'wakeModel', label: 'Hear the wake word with a model trained for it, on the screen', doc: 'wake-model.md', todo: 'H8.4', since: '2.244.0', measure: 'manual' },
  { id: 'modelScout', label: 'A scout for better and new models', doc: 'model-scout.md', todo: 'H10.4', since: '2.213.0', measure: 'script' },
  { id: 'visionPass', label: 'Look at a computer\'s screen with a vision model', doc: 'vision-pass.md', todo: 'H5.6', since: '2.197.0', measure: 'script' },
  { id: 'toolTiers', label: 'Send the core tools in full, the rest by name', doc: 'tool-tiers.md', todo: 'B2', since: '2.249.0', measure: 'script' },
  { id: 'adaptiveLimits', label: 'Limits that follow the work: effort and steps by the request', doc: 'adaptive-limits.md', todo: 'H10.6', since: '2.295.0', measure: 'script' },
  { id: 'riskTiers', label: 'Ask only about what cannot be undone, in every mode', doc: 'risk-tiers.md', todo: 'H10.11', since: '2.296.0', measure: 'script' },
  { id: 'systemOne', label: 'A System 1 decision model for bounded decisions (Laya, or TypeSafe Jev)', doc: 'system-one.md', todo: 'H10.19', since: '2.317.0', measure: 'script' },
  { id: 'library', label: 'Library: the files on this machine, searched by meaning', doc: 'library.md', todo: 'H10.20', since: '2.336.0', measure: 'script' },
  { id: 'claimCheck', label: 'Catch an answer that claims what the turn never did', doc: 'claim-check.md', todo: 'B7c', since: '2.264.0', measure: 'manual' },
];
const STALE_DAYS = 60;

/** The newest YYYY-MM-DD at the start of a table row in a write-up: when it was last measured, or null. */
function lastMeasured(docText) {
  const dates = [...String(docText || '').matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\b/gm)].map(m => m[1]).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** Developer mode (`developer.mode`, the owner's): without it no experiment is offered or in effect, whatever its flag. */
const developer = () => require('./settings-schema').value('developer.mode') === true;
// An experiment whose feature is not in this hive's licence (the lab, for the project's owners and testers) never turns on.
const licensed = id => require('./license/gate').flagOn(id);
const on = id => developer() && require('./settings-schema').value(`experiments.${id}`) === true && licensed(id);
const flagged = id => require('./settings-schema').value(`experiments.${id}`) === true;

function list() {
  return EXPERIMENTS.filter(e => licensed(e.id)).map(e => {
    let doc = '';
    try { doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'experiments', e.doc), 'utf8'); } catch { doc = '(its write-up is missing)'; }
    const measured = lastMeasured(doc);
    const stale = !measured || (Date.now() - Date.parse(measured)) / 86400000 > STALE_DAYS;
    return { ...e, on: on(e.id), flagged: flagged(e.id), docText: doc, measured, stale };
  });
}

function set(id, value) {
  if (!EXPERIMENTS.some(e => e.id === id && licensed(e.id))) throw Object.assign(new Error(`No experiment "${id}".`), { status: 404 });
  if (!developer()) throw Object.assign(new Error('Developer mode is off: switch it on in Settings → Developer first.'), { status: 409 });
  const { loadPrefs, savePrefs } = require('./utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, experiments: { ...(prefs.experiments || {}), [id]: value === true } });
  return { id, on: on(id) };
}

function setDeveloper(value) {
  const { loadPrefs, savePrefs } = require('./utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, developer: { ...(prefs.developer || {}), mode: value === true } });
  return { developer: developer() };
}

function mount(app) {
  app.get('/api/experiments', (_req, res) => res.json({ developer: developer(), experiments: list() }));
  app.post('/api/experiments/developer', (req, res) => res.json(setDeveloper(req.body?.on === true)));
  app.post('/api/experiments/:id', (req, res) => {
    try { res.json(set(req.params.id, req.body?.on === true)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { lastMeasured, STALE_DAYS, EXPERIMENTS, on, developer, list, set, setDeveloper, mount };

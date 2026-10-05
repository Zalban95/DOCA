'use strict';

/**
 * Experiments (docs/design/hive.md §8): new approaches behind a flag, off by default, each written up before it
 * ships — the hypothesis, what is measured and how, the cost, the risks, the rollback — in docs/experiments/<id>.md,
 * which Settings → Developer shows beside the switch. A flag lives in `experiments.<id>` (settings-schema.js) and
 * is the owner's alone: not proposable. Graduating means the flag goes and the code stays; failing, the code goes.
 */
const fs = require('fs');
const path = require('path');

const EXPERIMENTS = [
  { id: 'recipeRepair', label: 'Recipes repair themselves', doc: 'recipe-repair.md', todo: 'H3.4' },
  { id: 'retrieval', label: 'Search memory and conversations by meaning', doc: 'retrieval.md', todo: 'H10.2' },
  { id: 'bargeIn', label: 'Talk over the agent in a voice call', doc: 'barge-in.md', todo: 'H8.3' },
  { id: 'realtimeVoice', label: 'Live calls with a realtime speech model', doc: 'realtime-voice.md', todo: 'H8.3' },
  { id: 'faceVoice', label: 'The face follows a voice call', doc: 'face-voice.md', todo: 'H8.2' },
  { id: 'packRegistry', label: 'Publish packs for other hubs, and fetch theirs', doc: 'pack-registry.md', todo: 'H4.6' },
  { id: 'wakeWord', label: 'Start a call by saying the hive\'s name', doc: 'wake-word.md', todo: 'H8.2' },
  { id: 'visionPass', label: 'Look at a computer\'s screen with a vision model', doc: 'vision-pass.md', todo: 'H5.6' },
];

/** Developer mode (`developer.mode`, the owner's): without it no experiment is offered or in effect, whatever its flag. */
const developer = () => require('./settings-schema').value('developer.mode') === true;
const on = id => developer() && require('./settings-schema').value(`experiments.${id}`) === true;
const flagged = id => require('./settings-schema').value(`experiments.${id}`) === true;

function list() {
  return EXPERIMENTS.map(e => {
    let doc = '';
    try { doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'experiments', e.doc), 'utf8'); } catch { doc = '(its write-up is missing)'; }
    return { ...e, on: on(e.id), flagged: flagged(e.id), docText: doc };
  });
}

function set(id, value) {
  if (!EXPERIMENTS.some(e => e.id === id)) throw Object.assign(new Error(`No experiment "${id}".`), { status: 404 });
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

module.exports = { EXPERIMENTS, on, developer, list, set, setDeveloper, mount };

'use strict';

/**
 * Which model does what, in one place (audit 2026-10-06, coh F11; TODO C4): the agent's model, its fallbacks and the
 * stronger one it escalates to, assistant mode's, each specialist's own, speech both ways, the live call's, reading a
 * screen, finding by meaning, the guards, the wake word. Read from the settings each time, so it is always this hive's.
 * The model scout compares the world against the rows marked `scout` (scout/roles.js); the agent reads all of them
 * through settings_read; the panel draws them as "Models in use" (Field → Models). A function DOCA gains is a row here,
 * and test/model-roles.test.js fails on a `*model` setting no row names. A row of a feature this hive is not licensed
 * for is left out, and a place it names on such a page is not said (modules/license): never a page the hive lacks.
 */
function roles() {
  const sc = require('./settings-schema'), { loadPrefs } = require('./utils');
  const prefs = loadPrefs(), vs = prefs.voiceServices || {};
  const val = k => { try { return sc.value(k) || null; } catch { return null; } };
  const pm = (p, m) => [p, m].filter(Boolean).join(' / ') || null;
  let c = {};
  try { c = require('./harness/catalog').configFor('doca') || {}; } catch { /* no harness yet */ }
  const chain = Array.isArray(c.fallbackChain) ? c.fallbackChain.map(x => pm(x.provider, x.model)).filter(Boolean).join(' → ') : '';
  const esc = c.escalateTo ? pm(c.escalateTo.provider, c.escalateTo.model) : null;
  let specialists = '';
  try { specialists = require('./agents/registry').list().filter(a => !a.broken && (a.model || a.provider)).map(a => `${a.id}: ${pm(a.provider, a.model)}`).join('; '); } catch { /* none */ }
  let wake = '';
  try { wake = require('./wakeword').models().map(m => m.word || m.id).join(', '); } catch { /* none kept */ }
  // Every voice in use, not only the hive's: a screen's own voice and its call voices (voice.engine, voice.quick/deep/
  // ambient.service, on the hive, a person or a device) — the scout read only the hive's and suggested a voice already
  // running for the calls (2026-10-12).
  let voices = [];
  try {
    const screens = require('./screens'), sp = require('./speech-services'), rows = { [sp.ROW.id]: { hf: sp.MODEL } };
    const said = new Set();
    const add = v => { for (const e of [v?.engine, v?.quick?.service, v?.deep?.service, v?.ambient?.service]) if (e && e !== 'hive') said.add(String(e)); };
    add(prefs.voice);
    for (const d of require('./api-v1/devices').list()) add(screens.layer(d.id)?.voice);
    for (const u of require('./auth/store').listUsers?.() || []) add(screens.personLayer(u.id)?.voice);
    voices = [...said].map(e => rows[e]?.hf || rows[e]?.label || e);
  } catch { /* none set beyond the hive's */ }
  let guards = null;
  try { guards = require('./harness/guard').list().filter(g => g.enabled !== false && g.model).map(g => g.model).join(', ') || null; } catch { /* none */ }
  return [
    { id: 'harness', label: 'The agent\'s model', scout: true, tasks: ['text-generation', 'image-text-to-text', 'gguf'], current: pm(c.provider, c.model), setting: 'harness.config.doca.model', where: 'Controls → DOCA ⚙' },
    { id: 'fallback', label: 'When the agent\'s model goes quiet', tasks: ['text-generation'], current: chain || null, setting: 'harness.config.doca.fallbackChain', where: 'Controls → DOCA ⚙ → Fallback' },
    { id: 'mastermind', label: 'Planning and reviewing (the mastermind)', tasks: ['text-generation'], current: val('harness.models.mastermind'), setting: 'harness.models.mastermind', where: 'Controls → DOCA ⚙ → Advanced — mastermind and worker' },
    { id: 'worker', label: 'Carrying out steps (the worker)', tasks: ['text-generation'], current: val('harness.models.worker'), setting: 'harness.models.worker', where: 'Controls → DOCA ⚙ → Advanced — mastermind and worker' },
    { id: 'escalate', label: 'A stronger model for a stuck job', tasks: ['text-generation'], current: esc, setting: 'harness.config.doca.escalateTo', where: 'Controls → DOCA ⚙ → Escalate' },
    { id: 'assistant', label: 'Live call (the face, Ambient’s assistant)', tasks: ['text-generation'], current: pm(val('assistant.provider'), val('assistant.model')), setting: 'assistant.model', where: 'Settings → Voice → Live call', feature: 'assistant-mode' },
    { id: 'specialists', label: 'Specialists with a model of their own', tasks: ['text-generation'], current: specialists || null, setting: 'agents (each definition)', where: 'Agents → Harness → Specialists', feature: 'specialists' },
    { id: 'stt', label: 'Speech to text', scout: true, tasks: ['automatic-speech-recognition'], current: vs.sttModel || null, setting: 'voiceServices.sttModel', where: at(['Settings → Voice', 'voice'], 'Field → Models → Inference Services (Whisper)') },
    { id: 'tts', label: 'Text to speech', scout: true, tasks: ['text-to-speech'], current: [pm(vs.ttsModel, vs.ttsVoice), ...voices].filter(Boolean).join('; ') || null, setting: 'voiceServices.ttsModel', where: at(['Settings → Voice', 'voice'], 'Field → Models → Inference Services (Kokoro)') },
    { id: 'realtime', label: 'Speech to speech (calls)', scout: true, tasks: ['any-to-any', 'audio-text-to-text'], current: val('realtime.model'), setting: 'realtime.model', where: 'Settings → Voice → Realtime speech model', feature: 'realtime-voice' },
    { id: 'vision', label: 'Reading a screen', scout: true, tasks: ['image-text-to-text'], current: val('vision.model'), setting: 'vision.model', where: 'Settings → Harness → Vision', feature: 'vision-pass' },
    { id: 'vision-locate', label: 'Pointing at things on a screen', tasks: ['image-text-to-text'], current: val('vision.locatorModel') ? pm(val('vision.locatorProvider') || val('vision.provider'), val('vision.locatorModel')) : null, setting: 'vision.locatorModel', where: 'Settings → Harness → Vision', feature: 'vision-pass' },
    { id: 'vision-quick', label: 'Reading a picture quickly (while the vision model loads)', tasks: ['image-text-to-text'], current: val('vision.quickModel') ? pm(val('vision.quickProvider') || val('vision.provider'), val('vision.quickModel')) : null, setting: 'vision.quickModel', where: 'Settings → Harness → Vision', feature: 'vision-pass' },
    { id: 'detector', label: 'Finding things on a screen', scout: true, tasks: ['object-detection'], current: val('vision.detectorModel'), setting: 'vision.detectorModel', where: at(['Settings → Harness → Vision', 'vision-detector'], 'Field → Models → Inference Services (Roboflow)') },
    { id: 'embeddings', label: 'Finding by meaning', scout: true, tasks: ['feature-extraction', 'sentence-similarity'], current: val('retrieval.model'), setting: 'retrieval.model', where: 'Settings → Harness → Retrieval', feature: 'retrieval' },
    { id: 'rerank', label: 'Reranking what was found by meaning', tasks: ['text-ranking'], current: val('retrieval.rerankModel') ? pm(val('retrieval.rerankProvider') || val('retrieval.provider'), val('retrieval.rerankModel')) : null, setting: 'retrieval.rerankModel', where: 'Settings → Harness → Retrieval (experiment retrievalRerank)', feature: 'retrieval-rerank' },
    { id: 'library', label: 'Finding your files by meaning (pictures, sound, video)', scout: true, tasks: ['feature-extraction', 'image-feature-extraction'], current: val('library.model'), setting: 'library.model', where: 'Field → Models → Library (experiment library)', feature: 'library' },
    { id: 'guards', label: 'Screening outside text', scout: true, tasks: ['text-classification'], current: guards, setting: 'guards', where: 'Settings → Harness → Guards' },
    { id: 'system-one', label: 'Bounded decisions (System 1: a request\'s size, a call\'s route, a page\'s next element)', scout: true, tasks: ['text-classification', 'zero-shot-classification'], current: systemOne(val), setting: 'systemOne.provider', where: 'Field → Models → Decision models (experiment systemOne)', feature: 'system-one' },
    { id: 'wakeword', label: 'Hearing the wake word', tasks: [], current: wake || null, setting: 'wakeword', where: 'Field → Models → Wake words', feature: 'wake-model' },
    { id: 'images', label: 'Making images', scout: true, tasks: ['text-to-image'], current: null, setting: null, where: 'Field → Models → Inference Services (ComfyUI, suggested; Stable Diffusion WebUI, the older one) — skills/make-images' },
    { id: 'new', label: 'Anything new (a capability DOCA does not have)', scout: true, tasks: ['any'], current: null, setting: null, where: 'a new function: a TODO item' },
  ].filter(r => !r.feature || licensed(r.feature));
}

/** Whether a feature is licensed here: a role whose feature is not is left out, as its page is (modules/license). */
function licensed(id) {
  try { return require('./license').featureOn(id); } catch { return true; }
}

/** Where a role is set, naming only the places this hive has: each part a text, or [text, the feature it needs]. */
function at(...parts) {
  return parts.filter(p => typeof p === 'string' || licensed(p[1])).map(p => (typeof p === 'string' ? p : p[0])).join('; ');
}

/** The System 1 model chosen — Laya's checkpoint on this hub, or Jev's model — and whether DOCA uses it now. */
function systemOne(val) {
  let on = false;
  try { on = require('./experiments').on('systemOne'); } catch { /* off */ }
  const m = val('systemOne.provider') === 'jev' ? `TypeSafe ${val('systemOne.jevVersion') || 'jev-latest'}` : `Laya (${val('systemOne.checkpoint') || 'english'}, on this hub)`;
  return on ? m : `${m} — not in use (experiment systemOne is off)`;
}

/** The roles as lines, for the agent: what is set, and where to change it. */
function lines() {
  return roles().filter(r => r.id !== 'new').map(r => `- ${r.label}: ${r.current || 'nothing set'} (${r.where}${r.setting && r.setting.includes('.') ? `; ${r.setting}` : ''})`);
}

function mount(app) {
  app.get('/api/models/roles', (_req, res) => { try { res.json({ roles: roles() }); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { roles, lines, mount };

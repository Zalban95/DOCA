'use strict';

/**
 * Which model does what, in one place (audit 2026-10-06, coh F11; TODO C4): the agent's model, its fallbacks and the
 * stronger one it escalates to, assistant mode's, each specialist's own, speech both ways, the live call's, reading a
 * screen, finding by meaning, the guards, the wake word. Read from the settings each time, so it is always this hive's.
 * The model scout compares the world against the rows marked `scout` (scout/roles.js); the agent reads all of them
 * through settings_read; the panel draws them as "Models in use" (Field → Models). A function DOCA gains is a row here,
 * and test/model-roles.test.js fails on a `*model` setting no row names.
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
  let guards = null;
  try { guards = require('./harness/guard').list().filter(g => g.enabled !== false && g.model).map(g => g.model).join(', ') || null; } catch { /* none */ }
  return [
    { id: 'harness', label: 'The agent\'s model', scout: true, tasks: ['text-generation'], current: pm(c.provider, c.model), setting: 'harness.config.doca.model', where: 'Controls → DOCA ⚙' },
    { id: 'fallback', label: 'When the agent\'s model goes quiet', tasks: ['text-generation'], current: chain || null, setting: 'harness.config.doca.fallbackChain', where: 'Controls → DOCA ⚙ → Fallback' },
    { id: 'escalate', label: 'A stronger model for a stuck job', tasks: ['text-generation'], current: esc, setting: 'harness.config.doca.escalateTo', where: 'Controls → DOCA ⚙ → Escalate' },
    { id: 'assistant', label: 'Assistant mode (the face, spoken to)', tasks: ['text-generation'], current: pm(val('assistant.provider'), val('assistant.model')), setting: 'assistant.model', where: 'Settings → Voice → Assistant mode' },
    { id: 'specialists', label: 'Specialists with a model of their own', tasks: ['text-generation'], current: specialists || null, setting: 'agents (each definition)', where: 'Agents → Harness → Specialists' },
    { id: 'stt', label: 'Speech to text', scout: true, tasks: ['automatic-speech-recognition'], current: vs.sttModel || null, setting: 'voiceServices.sttModel', where: 'Settings → Voice; Field → Models → Inference Services (Whisper)' },
    { id: 'tts', label: 'Text to speech', scout: true, tasks: ['text-to-speech'], current: pm(vs.ttsModel, vs.ttsVoice), setting: 'voiceServices.ttsModel', where: 'Settings → Voice; Field → Models → Inference Services (Kokoro)' },
    { id: 'realtime', label: 'Speech to speech (live calls)', scout: true, tasks: ['any-to-any', 'audio-text-to-text'], current: val('realtime.model'), setting: 'realtime.model', where: 'Settings → Voice → Live call' },
    { id: 'vision', label: 'Reading a screen', scout: true, tasks: ['image-text-to-text'], current: val('vision.model'), setting: 'vision.model', where: 'Settings → Harness → Vision' },
    { id: 'detector', label: 'Finding things on a screen', scout: true, tasks: ['object-detection'], current: val('vision.detectorModel'), setting: 'vision.detectorModel', where: 'Settings → Harness → Vision; Field → Models → Inference Services (Roboflow)' },
    { id: 'embeddings', label: 'Finding by meaning', scout: true, tasks: ['feature-extraction', 'sentence-similarity'], current: val('retrieval.model'), setting: 'retrieval.model', where: 'Settings → Harness → Retrieval' },
    { id: 'guards', label: 'Screening outside text', scout: true, tasks: ['text-classification'], current: guards, setting: 'guards', where: 'Settings → Harness → Guards' },
    { id: 'system-one', label: 'Bounded decisions (System 1: a request\'s size, a call\'s route, a page\'s next element)', scout: true, tasks: ['text-classification', 'zero-shot-classification'], current: systemOne(val), setting: 'systemOne.provider', where: 'Field → Models → Decision models (experiment systemOne)' },
    { id: 'wakeword', label: 'Hearing the wake word', tasks: [], current: wake || null, setting: 'wakeword', where: 'Field → Models → Wake words' },
    { id: 'images', label: 'Making images', scout: true, tasks: ['text-to-image'], current: null, setting: null, where: 'Field → Models → Inference Services (ComfyUI, Stable Diffusion)' },
    { id: 'new', label: 'Anything new (a capability DOCA does not have)', scout: true, tasks: ['any'], current: null, setting: null, where: 'a new function: a TODO item' },
  ];
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

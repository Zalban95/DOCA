'use strict';

/**
 * What DOCA uses for each of its functions, and the Hugging Face task a replacement would be listed under — the
 * inventory the model scout compares the world against (docs/experiments/model-scout.md). Read from the settings
 * each time, so it is always this hive's own. A function DOCA gains is a row here.
 */
function roles() {
  const sc = require('../settings-schema'), { loadPrefs } = require('../utils');
  const prefs = loadPrefs(), vs = prefs.voiceServices || {};
  let harness = null;
  try { const c = require('../harness/catalog').configFor('doca'); harness = [c.provider, c.model].filter(Boolean).join(' / ') || null; } catch { /* no harness yet */ }
  const val = k => { try { return sc.value(k) || null; } catch { return null; } };
  return [
    { id: 'harness', label: 'The agent\'s model', tasks: ['text-generation'], current: harness, where: 'Controls → DOCA ⚙ (harness.config.doca)' },
    { id: 'stt', label: 'Speech to text', tasks: ['automatic-speech-recognition'], current: vs.sttModel || null, where: 'Settings → Voice (voiceServices.sttModel), Services → Whisper' },
    { id: 'tts', label: 'Text to speech', tasks: ['text-to-speech'], current: [vs.ttsModel, vs.ttsVoice].filter(Boolean).join(' / ') || null, where: 'Settings → Voice (voiceServices.ttsModel), Services → Kokoro' },
    { id: 'realtime', label: 'Speech to speech (live calls)', tasks: ['any-to-any', 'audio-text-to-text'], current: val('realtime.model'), where: 'Settings → Voice → Live call (realtime.*)' },
    { id: 'vision', label: 'Reading a screen', tasks: ['image-text-to-text'], current: val('vision.model'), where: 'Settings → Harness → Vision (vision.model)' },
    { id: 'detector', label: 'Finding things on a screen', tasks: ['object-detection'], current: val('vision.detectorModel'), where: 'Settings → Harness → Vision (vision.detectorModel), Services → Roboflow Inference' },
    { id: 'embeddings', label: 'Finding by meaning', tasks: ['feature-extraction', 'sentence-similarity'], current: val('retrieval.model'), where: 'Settings → Harness → Retrieval (retrieval.model)' },
    { id: 'guards', label: 'Screening outside text', tasks: ['text-classification'], current: (() => { try { return require('../harness/guard').list().filter(g => g.enabled !== false && g.model).map(g => g.model).join(', ') || null; } catch { return null; } })(), where: 'Settings → Harness → Guards' },
    { id: 'images', label: 'Making images', tasks: ['text-to-image'], current: null, where: 'Services → ComfyUI / Stable Diffusion' },
    { id: 'new', label: 'Anything new (a capability DOCA does not have)', tasks: ['any'], current: null, where: 'a new function: a TODO item' },
  ];
}

module.exports = { roles };

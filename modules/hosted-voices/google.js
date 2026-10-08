'use strict';

/**
 * Google's Gemini-TTS through Cloud Text-to-Speech (docs: docs.cloud.google.com/text-to-speech/docs/gemini-tts,
 * checked 2026-10-08): POST /v1/text:synthesize with an API key restricted to that API (`X-Goog-Api-Key`),
 * `{input: {text, prompt}, voice: {languageCode, name, modelName}, audioConfig}`; the audio comes back as base64. It
 * reads a few markup tags in the text — [whispering], [laughing], [sigh] — and a direction in words as `prompt`, so
 * those three are written its way and the rest become the prompt, after the person's own (Advanced → style).
 */
const tags = require('../voice-tags');
const MAP = { whispers: '[whispering]', laughs: '[laughing]', sighs: '[sigh]' };
const LANG = { English: 'en-US', Italian: 'it-IT', French: 'fr-FR', German: 'de-DE', Spanish: 'es-ES', Portuguese: 'pt-BR', Japanese: 'ja-JP', Chinese: 'cmn-CN' };
const VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel',
  'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

module.exports = {
  id: 'google',
  label: 'Google',
  about: 'Gemini-TTS: thirty voices, a direction in words, and [whispering], [laughing], [sigh] in the text.',
  key: { name: 'google-tts', origin: 'https://texttospeech.googleapis.com', place: 'header', field: 'X-Goog-Api-Key', prefix: '' },
  keyPage: 'https://console.cloud.google.com/apis/credentials',
  models: [
    { id: 'gemini-2.5-flash-tts', label: 'Gemini 2.5 Flash TTS', tags: true },
    { id: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS (preview)', tags: true },
    { id: 'gemini-2.5-pro-tts', label: 'Gemini 2.5 Pro TTS — slower, richer', tags: true },
  ],
  model: 'gemini-2.5-flash-tts',
  advanced: ['style', 'language'],
  async voices() { return VOICES.map(id => ({ id, name: id })); },
  request({ text, voice, model, speed, opts = {} }) {
    const m = this.models.find(x => x.id === model) || this.models[0];
    const { input, unmapped } = tags.rewrite(text, MAP);
    const prompt = [opts.style, ...unmapped.map(id => tags.TAGS[id].ask)].filter(Boolean).join(' ').slice(0, 2000);
    const lang = opts.language || LANG[require('../speech-language').guess(tags.strip(text)) || ''] || 'en-US';
    return { input: tags.strip(text), path: '/v1/text:synthesize', base64: 'audioContent', type: 'audio/mpeg',
      body: { input: { text: input, ...(prompt ? { prompt } : {}) }, voice: { languageCode: lang, name: voice, modelName: m.id },
        audioConfig: { audioEncoding: 'MP3', ...(Number(speed) > 0 ? { speakingRate: Math.min(4, Math.max(0.25, Number(speed))) } : {}) } } };
  },
};

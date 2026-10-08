'use strict';

/**
 * OpenAI's speech (docs: developers.openai.com/api/docs/guides/text-to-speech, checked 2026-10-08): POST
 * /v1/audio/speech, `{model, input, voice, instructions, response_format, speed}`. gpt-4o-mini-tts takes the tone in
 * words as `instructions`, so our tags become words there (voice-tags.forVoice), after the person's own direction
 * (Advanced → style). Its voices are a fixed list.
 */
const tags = require('../voice-tags');

module.exports = {
  id: 'openai',
  label: 'OpenAI',
  about: 'gpt-4o-mini-tts: a tone in words — "warm and unhurried" — and the tags turned into words for each sentence.',
  key: { name: 'openai', origin: 'https://api.openai.com', place: 'header', field: 'Authorization', prefix: 'Bearer ' },
  keyPage: 'https://platform.openai.com/api-keys',
  models: [
    { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts — takes a tone', tags: true },
    { id: 'tts-1-hd', label: 'tts-1-hd — no tone', tags: false },
    { id: 'tts-1', label: 'tts-1 — quickest, no tone', tags: false },
  ],
  model: 'gpt-4o-mini-tts',
  advanced: ['style'],
  async voices() {
    return ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map(id => ({ id, name: id }));
  },
  request({ text, voice, model, speed, opts = {} }) {
    const m = this.models.find(x => x.id === model) || this.models[0];
    const { input, instructions } = tags.forVoice(text, m.tags ? 'instructions' : null);
    const say = [opts.style, instructions].filter(Boolean).join(' ').slice(0, 2000);
    return { input, path: '/v1/audio/speech',
      body: { model: m.id, input, voice, response_format: 'mp3', ...(Number(speed) > 0 ? { speed: Math.min(4, Math.max(0.25, Number(speed))) } : {}),
        ...(m.tags && say ? { instructions: say } : {}) } };
  },
};

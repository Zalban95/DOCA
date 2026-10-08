'use strict';

/**
 * Cartesia (docs: docs.cartesia.ai/api-reference/tts/bytes and …/sonic-3/volume-speed-emotion, checked 2026-10-08):
 * POST /tts/bytes with a bearer key and `Cartesia-Version`, `{model_id, transcript, voice: {mode, id}, output_format}`.
 * Sonic 3 takes a tone inside the transcript: `<emotion value="…"/>`, `<volume level="…"/>` and `[laughter]` — so each
 * of our tags is written that way, and one it has no spelling for is dropped. Voices are listed by GET /voices.
 */
const tags = require('../voice-tags');
const VERSION = '2026-08-14';
const MAP = {
  laughs: '[laughter]', whispers: '<volume level="0.6"/>', excited: '<emotion value="excited"/>', calm: '<emotion value="calm"/>',
  sad: '<emotion value="sad"/>', curious: '<emotion value="curious"/>', serious: '<emotion value="neutral"/>',
};

module.exports = {
  id: 'cartesia',
  label: 'Cartesia',
  about: 'Sonic 3: quick, with emotions and laughter written into what it says.',
  key: { name: 'cartesia', origin: 'https://api.cartesia.ai', place: 'header', field: 'Authorization', prefix: 'Bearer ' },
  keyPage: 'https://play.cartesia.ai/keys',
  headers: { 'Cartesia-Version': VERSION },
  models: [
    { id: 'sonic-3', label: 'Sonic 3 — emotions and laughter', tags: true },
    { id: 'sonic-latest', label: 'Sonic, the newest', tags: true },
  ],
  model: 'sonic-3',
  advanced: ['language'],
  async voices(get) {
    const j = await get('/voices?limit=100');
    return (j.data || j || []).map(v => ({ id: v.id, name: v.name })).filter(v => v.id);
  },
  request({ text, voice, model, speed, opts = {} }) {
    const m = this.models.find(x => x.id === model) || this.models[0];
    const { input } = tags.rewrite(text, m.tags ? MAP : {});
    return { input: tags.strip(text), path: '/tts/bytes',
      body: { model_id: m.id, transcript: input, voice: { mode: 'id', id: voice }, output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
        ...(opts.language ? { language: opts.language } : {}),
        ...(Number(speed) > 0 ? { generation_config: { speed: Math.min(1.5, Math.max(0.6, Number(speed))) } } : {}) } };
  },
};

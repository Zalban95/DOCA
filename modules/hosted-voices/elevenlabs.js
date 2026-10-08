'use strict';

/**
 * ElevenLabs (docs: elevenlabs.io/docs/api-reference/text-to-speech/convert, checked 2026-10-08): POST
 * /v1/text-to-speech/{voice_id} with `xi-api-key`, `{text, model_id, voice_settings}`, audio back. Eleven v4 and v3
 * read audio tags in the text itself — "[whispers]", "[laughs]" — as direction, so ours are passed through as they are;
 * its other models would read them aloud, so for those they are dropped. Voices are the account's (GET /v1/voices).
 */
const tags = require('../voice-tags');
const KEEP = Object.fromEntries(Object.keys(tags.TAGS).map(id => [id, `[${id}]`]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

module.exports = {
  id: 'elevenlabs',
  label: 'ElevenLabs',
  about: 'The most expressive voices; reads [whispers], [laughs] and the like as direction (Eleven v4 and v3).',
  key: { name: 'elevenlabs', origin: 'https://api.elevenlabs.io', place: 'header', field: 'xi-api-key', prefix: '' },
  keyPage: 'https://elevenlabs.io/app/settings/api-keys',
  models: [
    { id: 'eleven_v4', label: 'Eleven v4 — the most expressive', tags: true },
    { id: 'eleven_v3', label: 'Eleven v3', tags: true },
    { id: 'eleven_flash_v2_5', label: 'Flash v2.5 — the quickest, no tags', tags: false },
    { id: 'eleven_multilingual_v2', label: 'Multilingual v2 — no tags', tags: false },
  ],
  model: 'eleven_v4',
  advanced: ['stability', 'language'],
  async voices(get) {
    const j = await get('/v1/voices');
    return (j.voices || []).map(v => ({ id: v.voice_id, name: v.name })).filter(v => v.id);
  },
  request({ text, voice, model, speed, opts = {} }) {
    const m = this.models.find(x => x.id === model) || this.models[0];
    const input = m.tags ? tags.rewrite(text, KEEP).input : tags.strip(text);
    const settings = { ...(Number(opts.stability) >= 0 && opts.stability !== '' && opts.stability != null ? { stability: clamp(Number(opts.stability), 0, 1) } : {}),
      ...(Number(speed) > 0 ? { speed: clamp(Number(speed), 0.7, 1.2) } : {}) };
    return { input, path: `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      body: { text: input, model_id: m.id, ...(Object.keys(settings).length ? { voice_settings: settings } : {}), ...(opts.language ? { language_code: opts.language } : {}) } };
  },
};

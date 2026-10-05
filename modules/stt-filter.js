'use strict';

/**
 * What a speech-to-text service hears in silence (found on a phone, 2026-10-05: "Thank you" typed by itself).
 * Whisper, given a second of room noise, answers with the phrases its training videos ended with — "Thank you.",
 * "Thanks for watching!", "you", "." — and faster-whisper-server reports no_speech_prob 0 for them, so that number
 * cannot be used. Two defences: its own voice-activity filter (`vad_filter`), which removes the noise before the
 * model hears it — and which answers 500 when nothing is left, i.e. nobody spoke — and, when that filter is not
 * available, dropping a transcript that is only one of these phrases.
 */
const HALLUCINATIONS = [
  'thank you', 'thank you very much', 'thanks', 'thanks for watching', 'thank you for watching', 'thanks for watching and see you next time',
  'you', 'bye', 'bye bye', 'okay', 'oh', 'hmm', 'mm', 'uh', 'so', 'yeah',
  'subtitles by the amara org community', 'please subscribe', 'like and subscribe', 'see you next time', 'grazie', 'grazie a tutti',
];
const norm = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** A transcript that is nothing but a silence phrase (or punctuation). */
function isHallucination(text) {
  const n = norm(text);
  return !n || HALLUCINATIONS.includes(n);
}

module.exports = { isHallucination, HALLUCINATIONS, norm };

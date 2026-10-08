'use strict';

/**
 * How a spoken answer carries its tone: a few bracketed tags in the text — "[whispers] The baby is asleep." — the
 * way ElevenLabs' expressive voices are directed (asked 2026-10-08). The agent is told about them only when the voice
 * that will speak understands them (`turn/client.js`), and they are never shown or kept as words: the stored answer
 * and the chat drop them (`strip`, and public/js/lib/voice-tags.js, which holds the same list), and a voice that does
 * not understand them never receives them.
 *
 * A voice understands them in one of its own ways, named on its speech service (tts-engines.js `tags`):
 *   instructions — the OpenAI speech API's `instructions` field (gpt-4o-mini-tts, Qwen3-TTS behind vLLM-Omni): each
 *                  sentence is sent without its tags and with what they ask for in words.
 * Synthesis is a sentence at a time (chat-call-voice.js, realtime/pipeline.js), so a tag colours the sentence it is in.
 */

/** Each tag the agent may use: the words it is written with, and what it asks the voice for. */
const TAGS = {
  whispers: { says: ['whisper', 'whispers', 'whispering'], ask: 'Whisper, softly and close, barely voiced.' },
  laughs:   { says: ['laugh', 'laughs', 'laughing', 'chuckles', 'chuckle'], ask: 'Amused, laughing lightly while speaking.' },
  sighs:    { says: ['sigh', 'sighs'], ask: 'With a sigh, a little weary.' },
  excited:  { says: ['excited', 'excitedly'], ask: 'Excited and bright, full of energy and joy.' },
  calm:     { says: ['calm', 'calmly', 'gently'], ask: 'Calm and warm, unhurried.' },
  sad:      { says: ['sad', 'sadly'], ask: 'Sad and gentle, quieter.' },
  curious:  { says: ['curious', 'curiously'], ask: 'Curious, with a light questioning tone.' },
  serious:  { says: ['serious', 'seriously'], ask: 'Serious and steady.' },
};

const WORD = new Map(Object.entries(TAGS).flatMap(([id, t]) => t.says.map(w => [w, id])));
// A known word in brackets, never a markdown link's text ("[calm](…)") or a footnote ("[1]").
const PATTERN = /\[\s*([a-z]+)\s*\](?!\()/gi;

/** The tags in `text`, in order, each once. */
function found(text) {
  const out = [];
  for (const m of String(text || '').matchAll(PATTERN)) { const id = WORD.get(m[1].toLowerCase()); if (id && !out.includes(id)) out.push(id); }
  return out;
}

/** `text` without its tags, spacing tidied — what a person reads, and what a voice without tags is sent. */
function strip(text) {
  if (!text || !String(text).includes('[')) return text || '';
  return String(text).replace(PATTERN, (all, w) => (WORD.has(w.toLowerCase()) ? '' : all))
    .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,!?;:])/g, '$1').replace(/^[ \t]+/gm, '').trim();
}

/**
 * For an answer arriving in pieces (a turn's text, as the model writes it): `push(piece)` gives what a person may be
 * shown — the tags gone, with the space after each — holding back a "[whisp" that may still become one; `rest()` is
 * what was held when the answer ends. The turn keeps and shows only this (harness/agent.js); the pieces as written,
 * tags and all, ride beside it as `spoken`, for whatever speaks them.
 */
function stream() {
  let held = '';
  const drop = s => s.replace(/\[\s*([a-z]+)\s*\](?!\() ?/gi, (all, w) => (WORD.has(w.toLowerCase()) ? '' : all));
  return {
    push(piece) {
      const s = held + String(piece || '');
      const open = s.lastIndexOf('[');
      const tail = open >= 0 ? s.slice(open) : '';
      if (tail && !tail.includes(']') && /^\[\s*[a-z]{0,12}$/i.test(tail)) { held = tail; return drop(s.slice(0, open)); }
      held = '';
      return drop(s);
    },
    rest() { const r = held; held = ''; return r; },
  };
}

/** Whether a turn's answer is spoken by a voice: its tone tags are then kept apart from the words (harness/agent.js). */
const spokenTurn = client => !!(client && (client.voiceTags || client.mode === 'call' || client.mode === 'assistant'));

/**
 * One sentence as a voice is sent it: `{input, instructions}` — tags turned into words for a voice that takes
 * instructions, dropped for any other (`tags` null).
 */
function forVoice(text, tags) {
  const input = strip(text);
  if (tags !== 'instructions') return { input };
  const asks = found(text).map(id => TAGS[id].ask);
  return asks.length ? { input, instructions: asks.join(' ') } : { input };
}

/**
 * One sentence for a voice with tags of its own (hosted-voices/): each of ours written the voice's way — `map[id]` is
 * its text ("[laughter]", "<emotion value=\"sad\"/>"), or absent to drop it — and the ones it has no spelling for
 * returned in `unmapped`, for a voice that also takes a direction in words (Google's prompt).
 */
function rewrite(text, map = {}) {
  const unmapped = [];
  const input = String(text || '').replace(PATTERN, (all, w) => {
    const id = WORD.get(w.toLowerCase());
    if (!id) return all;
    if (map[id]) return map[id];
    if (!unmapped.includes(id)) unmapped.push(id);
    return '';
  }).replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,!?;:])/g, '$1').trim();
  return { input, unmapped };
}

/** The prompt's line for a voice that understands them (turn/client.js). */
function line() {
  return `The voice speaking your answer can change its tone: put one of ${Object.keys(TAGS).map(t => `[${t}]`).join(' ')} at the start of a sentence `
    + '(a tag colours only its own sentence), sparingly — where a person would really whisper, laugh or light up. They are not shown or read out.';
}

module.exports = { TAGS, PATTERN, found, strip, stream, spokenTurn, forVoice, rewrite, line };

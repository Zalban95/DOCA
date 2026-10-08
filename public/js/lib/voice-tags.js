/* A spoken answer's tone tags ("[whispers] …", modules/voice-tags.js) are for the voice, never for the eye: a live
   call's text drops them as it streams (agent-ui/think-stream.js `voiceTags`). The words are the hub's list, held
   equal to it by test/expressive-voice.test.js. */
const VOICE_TAG_WORDS = ['whisper', 'whispers', 'whispering', 'laugh', 'laughs', 'laughing', 'chuckles', 'chuckle', 'sigh', 'sighs',
  'excited', 'excitedly', 'calm', 'calmly', 'gently', 'sad', 'sadly', 'curious', 'curiously', 'serious', 'seriously'];

/** `text` without its tone tags. */
function voiceTagsStrip(text) {
  // A tag and the space after it go together, so a tag that arrived in its own piece leaves no double space.
  return String(text || '').replace(/\[\s*([a-z]+)\s*\](?!\() ?/gi, (all, w) => (VOICE_TAG_WORDS.includes(w.toLowerCase()) ? '' : all));
}

/** For text arriving in pieces: `push` gives what can be shown, holding back a "[whisp" that may be a tag's start. */
function voiceTagsFilter() {
  let held = '';
  return {
    push(chunk) {
      const s = held + chunk;
      const open = s.lastIndexOf('[');
      const tail = open >= 0 ? s.slice(open) : '';
      // Held only while it can still become a tag: "[" and up to a dozen letters, not yet closed.
      if (tail && !tail.includes(']') && /^\[\s*[a-z]{0,12}$/i.test(tail)) { held = tail; return voiceTagsStrip(s.slice(0, open)); }
      held = '';
      return voiceTagsStrip(s);
    },
    rest() { const r = held; held = ''; return r; },
  };
}

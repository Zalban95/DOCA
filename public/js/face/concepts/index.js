/* ═══════════════════════════════════════════════════════
   Face concepts: words that briefly turn the face's dots into a picture.
   During a voice call, when the assistant is about to say a word that names
   a concept ("snow", "fire", "music"), the dots gather into that concept's
   silhouette, tinted with a colour that carries its meaning, then go back to
   the face.

   Each entry is { id, glyph, color, words: { en: [...], it: [...] } }:
   - glyph: one Unicode character; it is drawn to an offscreen canvas and only
     its filled shape is sampled, never its own colours;
   - color: a hex that means something to a person (hot red, cold blue, nature
     green, success green, warning amber, #57c9c2 the face's teal for neutral
     concepts) and stays visible on the face's near-black background;
   - words: lowercase whole words, inflections listed separately. A word
     belongs to one concept only — the first match wins.

   The category files beside this one each push their entries onto the list;
   this file must load first.
   ═══════════════════════════════════════════════════════ */

const FACE_CONCEPTS = [];

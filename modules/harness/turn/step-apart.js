'use strict';

/**
 * A step's words start a paragraph of their own (audit 2026-10-17). A turn's text is every step's words in order, and
 * they were joined as they came: "…before I close anything." then the tools, then "Only two…" read as one run-on line
 * in the turn's answer — a device's `agent.turn` text, a work chat's brief, the oversight list. Made once per step:
 * `apart(textSoFar)` returns the break to add before the step's first words ('' after that, or when the text so far
 * already ends in whitespace) and says it on the stream, so a page drawing the words live draws the same paragraphs.
 */
module.exports = function stepApart(say, tones = null) {
  let spoke = false;
  return text => {
    if (spoke) return '';
    spoke = true;
    if (!text || /\s$/.test(text)) return '';
    say({ type: 'text', text: '\n\n', ...(tones ? { spoken: '\n\n' } : {}) });
    return '\n\n';
  };
};

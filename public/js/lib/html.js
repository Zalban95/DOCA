/* ═══════════════════════════════════════════════════════
   Escaping values for HTML text, attributes, and inline-handler arguments.
   ═══════════════════════════════════════════════════════ */

/**
 * Escape HTML special characters (single shared implementation).
 *
 * Quotes are included so the result is safe in an attribute as well as in text
 * — `title="${escHtml(name)}"` used to break on a name containing one. It is
 * still not enough for a JS string inside an event attribute, because the
 * browser decodes entities before parsing the script: use jsArg() there.
 *
 * @param {string} str
 */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Escape a value for use as a JavaScript string argument inside an inline
 * event attribute: `onclick="doThing(${jsArg(name)})"` — note, no quotes of
 * your own around it.
 *
 * escHtml() is not enough there. It leaves quotes alone, so a value containing
 * one ("Al's watch") ends the string literal early and the handler dies with a
 * syntax error — a button that silently does nothing when clicked, with the
 * only clue in the console. JSON.stringify does the quoting and JS escaping;
 * the entity pass keeps the result intact inside a double-quoted attribute.
 *
 * @param {*} value
 * @returns {string} a quoted JS string literal, attribute-safe
 */
function jsArg(value) {
  return escHtml(JSON.stringify(String(value ?? '')));
}

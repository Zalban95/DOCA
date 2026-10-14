'use strict';

/**
 * A place in the panel, said only where this hive has it (2026-10-14: a core-only install's text sent people to
 * Field → Connectors and Machines → Live, pages it does not have). `where(page, there, otherwise)` is `there` when the
 * page — a nav id, or settings/<sub-tab> — is drawn here, else `otherwise`: words that say what the person needs
 * without naming a page that is not there. The panel's twin is licenceWhere (public/js/lib/licence.js).
 */
function where(page, there, otherwise = '') {
  let on = true;
  try { on = require('./gate').pageOn(page); } catch { /* the licence not read yet: as before */ }
  return on ? there : otherwise;
}

/** `text` with each aside naming a page this hive lacks — " (Settings → Voice)", " (Field → Connectors → Logins)" —
 *  taken out, for words written once for every hive (a shipped list's notes). */
function unsaid(text) {
  if (!text) return text;
  let off = [];
  try { off = require('./gate').off().pages; } catch { return text; }
  const pages = require('../features/pages');
  for (const p of off) {
    const l = pages.label(p);
    if (l) text = text.split(` (${l}`).map((part, i) => (i ? part.slice(part.indexOf(')') + 1) : part)).join('');
  }
  return text;
}

module.exports = { where, unsaid };

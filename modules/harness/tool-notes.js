'use strict';

/**
 * Tool notes: what this install learned about one of its tools, added to that
 * tool's description — the text the model reads the moment it picks a tool.
 *
 * TODO.md "Two layers of learned knowledge", layer 1. "A window capture right
 * after a screen change can be a stale frame: retry once" belongs to the tool,
 * on this machine. A note is **proposed** by the agent (tool_note) and applied
 * by the person's click, like any setting (settings.js, `toolNotes.<tool>`): a
 * tool description is an instruction the model follows, and an agent that
 * could rewrite its own descriptions could rewrite what it believes a
 * dangerous tool does.
 *
 * Each note keeps a fingerprint of the description it was written against;
 * when the tool changes (a release, a newer MCP server), the note is shown as
 * possibly out of date rather than as fact.
 *
 * In the prefs file: toolNotes: { "<tool>": { text, fp, at } }.
 */
const crypto = require('crypto');
const MAX = 500;

const fp = s => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 12);

function all() {
  try { return require('../utils').loadPrefs().toolNotes || {}; } catch { return {}; }
}

/** The declarations with each accepted note added to its tool's description. */
function annotate(schemas) {
  const notes = all();
  return schemas.map(s => {
    const n = notes[s.function?.name];
    if (!n?.text) return s;
    const stale = n.fp && n.fp !== fp(s.function.description);
    return { ...s, function: { ...s.function,
      description: `${s.function.description}\nNote from this install${stale ? ' (written before this tool last changed — may be out of date)' : ''}: ${n.text}` } };
  });
}

/** What a proposal of a note carries: the text, and the description it was written against. */
function noteValue(tool, text, description) {
  const t = String(text || '').trim();
  if (!t) throw Object.assign(new Error('A note needs its text.'), { status: 400 });
  if (t.length > MAX) throw Object.assign(new Error(`A tool note is at most ${MAX} characters — it is in the tool's description every step.`), { status: 400 });
  return { text: t, fp: fp(description), at: new Date().toISOString() };
}

/** settings.refuse's rule for a toolNotes.* path. */
function refuseValue(dotted, value) {
  if (!/^toolNotes\.[A-Za-z0-9_\-]+$/.test(dotted)) return `${dotted}: a tool note is toolNotes.<tool name>`;
  if (value === null) return null;   // removing a note
  if (!value || typeof value !== 'object' || typeof value.text !== 'string') return `${dotted} is { text, fp, at }`;
  if (value.text.length > MAX) return `${dotted}: a note is at most ${MAX} characters`;
  return null;
}

module.exports = { all, annotate, noteValue, refuseValue, fp, MAX };

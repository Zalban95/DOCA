'use strict';

/**
 * Trigger words per skill (asked 2026-10-09): words or short phrases, in any language the person uses, that make the
 * harness suggest a skill when a request says them — a stronger reminder than the manifest for a small local model that
 * overlooks it. Mechanical only: no model reads a request to decide.
 *
 *   explicit  the skill's front matter (`triggers: [...]`) or Settings → Harness → Skills (prefs skillUse.<name>.triggers)
 *   made      when none is written: from the skill's name ("write-good-code" → "write good code") and the longer words
 *             of its name and description — weaker, so only a whole phrase or a distinctive word counts
 *
 * A trigger matches when every one of its words is in the request (the same word, its stem, or for 6+ letters within
 * one letter), or, for a script without spaces between words, when it appears as written. "Likely fits"
 * (turn/fits.js) lists what matched first, as "Suggested by DOCA", and the composer shows the same as a chip
 * (GET /api/harness/skills/suggest; agent-ui/skill-chip.js). `suggestWithModel()` asks one model call, no tools, for
 * more — what it proposes is shown, and only the person's Save keeps it.
 */
const { stem } = require('./skill-match');

const STOP = new Set(['about', 'after', 'again', 'agent', 'always', 'another', 'before', 'being', 'their', 'there', 'these',
  'thing', 'things', 'which', 'while', 'where', 'whose', 'would', 'should', 'could', 'other', 'every', 'never', 'skill',
  'skills', 'using', 'person', 'people', 'something', 'anything', 'through', 'without', 'within', 'doca']);
const TOP = 3;

/** Words of any language: letters and digits, lower-case, accents kept. */
const words = text => String(text || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
const spaceless = t => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(t);

function near(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && stem(a) === stem(b)) return true;   // short words stem badly: only → on
  if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  const tail = (x, n) => x.slice(i + n);
  return tail(a, 1) === tail(b, 1) || tail(a, 1) === tail(b, 0) || tail(a, 0) === tail(b, 1);
}

/** Triggers made from the name and description, when none is written. */
function made(s) {
  const name = String(s.name || '').replace(/[-_]+/g, ' ').trim();
  const long = [...words(s.name), ...words(s.description)].filter(w => w.length >= 7 && !STOP.has(w));
  return [...new Set([name, ...long])].filter(Boolean).slice(0, 8);
}

/** A skill's triggers and whether they were written (explicit) or made. */
function of(s) {
  return s.triggers?.length ? { triggers: s.triggers, made: false } : { triggers: made(s), made: true };
}

/** The first trigger of `list` that `text` says, or null. */
function said(text, list) {
  const msg = String(text || '').toLowerCase().normalize('NFC'), have = words(msg);
  for (const t of list) {
    if (spaceless(t)) { if (msg.includes(t)) return t; continue; }
    const need = words(t);
    if (need.length && need.every(w => have.some(h => near(w, h)))) return t;
  }
  return null;
}

/**
 * Skills a request names by a trigger, written triggers first, at most three; `skip` (names) leaves out those already
 * attached. Only skills the agent sees (not switched off).
 */
function match(text, { skip = [] } = {}) {
  if (!String(text || '').trim()) return [];
  const out = [];
  for (const s of require('./skill-use').offered()) {
    if (skip.includes(s.name)) continue;
    const t = of(s), hit = said(text, t.triggers);
    if (hit) out.push({ name: s.name, matched: hit, made: t.made, description: s.description });
  }
  return out.sort((a, b) => a.made - b.made).slice(0, TOP);
}

/** One model call, no tools, no memory: more triggers for a skill, in the languages the person names. */
async function suggestWithModel(name, { languages = '', person = null } = {}) {
  const s = require('./skill-use').all().find(x => x.name === name);
  if (!s) throw Object.assign(new Error(`No skill called "${name}".`), { status: 404 });
  const text = await require('./agent').ask({ person,
    system: 'You list trigger phrases for a skill: words or short phrases (1–4 words) a person would say in a request '
      + 'that needs it. One per line, lower-case, no numbering, no explanation, at most 15. Include other languages when asked.',
    user: `Skill: ${s.name}\nWhen to use it: ${s.description}\nTriggers it has: ${of(s).triggers.join(', ') || '(none)'}\n`
      + `Languages: ${languages || 'English, and Italian'}`,
  });
  return [...new Set(String(text || '').split('\n').map(l => l.replace(/^[-*\d.)\s]+/, '').trim().toLowerCase())
    .filter(l => l && l.length <= 60 && !of(s).triggers.includes(l)))].slice(0, 15);
}

module.exports = { match, of, made, said, words, suggestWithModel };

'use strict';

/**
 * Who may release DOCA without asking (CONSTITUTION W2), as the admin's setting (asked 2026-10-06: "make releasing
 * editable from the admin"). `developer.releaseUnasked` is a list of rules, one per model family — `claude-opus >= 5`
 * — and an agent whose model matches one may merge, tag, push and switch the live panel unasked; every other model
 * asks first. An empty list means everyone asks. Settings → Developer → Releasing edits it; `GET
 * /api/developer/releasing?model=<id>` answers for one model, which is how an agent coding the repository checks.
 * Not proposable: an agent widening its own authority is what CONSTITUTION S11 forbids.
 */
const RULE = /^\s*([a-z0-9][a-z0-9._-]*?)\s*(?:>=\s*(\d+(?:\.\d+)?))?\s*$/i;

const rules = () => {
  const v = require('./settings-schema').value('developer.releaseUnasked');
  return Array.isArray(v) ? v.map(String).filter(s => s.trim()) : [];
};

/** A rule as {family, min}, or null when it does not read as one. */
function parse(rule) {
  const m = RULE.exec(String(rule || ''));
  return m ? { family: m[1].toLowerCase(), min: m[2] ? Number(m[2]) : null } : null;
}

/** A model id's version after its family: claude-opus-5-5 → 5.5; claude-opus-4-1-20250805 → 4.1 (a date is not a version). */
function versionAfter(model, family) {
  const rest = model.slice(family.length).replace(/^[-_.:@ ]+/, '');
  const parts = rest.split(/[-_.]/).filter(p => /^\d{1,3}$/.test(p));
  return parts.length ? Number(parts.slice(0, 2).join('.')) : null;
}

/** Whether `model` may release unasked, and by which rule. */
function check(model, list = rules()) {
  const id = String(model || '').trim().toLowerCase();
  if (!id) return { unasked: false, rule: null };
  for (const r of list) {
    const p = parse(r);
    if (!p || !(id === p.family || id.startsWith(`${p.family}-`) || id.startsWith(`${p.family}.`))) continue;
    if (p.min === null) return { unasked: true, rule: r };
    const v = versionAfter(id, p.family);
    if (v !== null && v >= p.min) return { unasked: true, rule: r };
  }
  return { unasked: false, rule: null };
}

/** The sentence a brief carries (the scout's implementer, a work chat on DOCA). */
function sentence() {
  const list = rules();
  return list.length
    ? `Releasing (the admin's setting, Settings → Developer → Releasing): a model matching ${list.join(' or ')} may merge, tag, push and switch the live panel without asking; any other model asks first.`
    : 'Releasing (the admin\'s setting): every model asks before merging, tagging or pushing.';
}

function save(list) {
  if (!Array.isArray(list)) throw Object.assign(new Error('rules must be a list'), { status: 400 });
  const clean = list.map(s => String(s).trim()).filter(Boolean);
  const bad = clean.filter(r => !parse(r));
  if (bad.length) throw Object.assign(new Error(`Not a rule: ${bad.join(', ')} — write a model family, optionally with a minimum version: claude-opus >= 5`), { status: 400 });
  const { loadPrefs, savePrefs } = require('./utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, developer: { ...(prefs.developer || {}), releaseUnasked: clean } });
  return { rules: rules() };
}

function mount(app) {
  app.get('/api/developer/releasing', (req, res) => res.json({ rules: rules(), sentence: sentence(), ...(req.query.model ? { model: String(req.query.model), ...check(req.query.model) } : {}) }));
  app.post('/api/developer/releasing', (req, res) => {
    try { res.json(save(req.body?.rules)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { rules, parse, check, sentence, save, mount };

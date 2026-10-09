'use strict';

/**
 * Every feature ever built, and where it is (CONSTITUTION §0 "every feature ever built stays in the product, and the
 * agents know it is there", W14; TODO P1.7). One entry per feature in ./data/*.js:
 *
 *   id, name   a stable id and what a person calls it
 *   use        what it does and when to bring it back, in one line
 *   page       where it lives in the panel: a page id from nav.js, or settings/<sub-tab> (a string or a list)
 *   tools      the agent's tools for it; routes, settings (dotted prefs paths), flag (an experiment's id)
 *   state      on (by default) · switch (behind a setting) · experiment (behind its flag and developer mode)
 *              · alternative (kept beside what replaced it: `beside` names that feature)
 *   uses       the usage counter that measures it (usage.js); words: more words to find it by; since: the release
 *   licence    the licence code that enables it (license/codes.js): `core` is every hive's; an alternative has its own
 *   tables     the database tables it owns (db/migrations.js makes them only while it is licensed)
 *   routes     may name a method ("DELETE /api/devices/:id"); a route belongs to the most specific pattern that
 *              matches it, and an unlicensed feature's routes, tools and pages are not there (license/gate.js)
 *
 * Not pasted into any prompt — the agent looks things up with the `features` tool (toolbox/features.js), which is
 * free to call. test/features.test.js fails when an experiment, a page, a Settings section or a tool has no entry,
 * so a feature cannot be added without the agents being able to find it.
 */
const FILES = ['agents', 'hub', 'field', 'voice', 'alternatives'];
const STATES = { on: 'on by default', switch: 'behind a switch', experiment: 'an experiment', alternative: 'an alternative kept beside its replacement' };

let _all = null;
function all() {
  if (!_all) _all = FILES.flatMap(f => require(`./data/${f}`).map(e => ({
    state: 'on', ...e, area: f,
    page: [].concat(e.page || []), tools: e.tools || [], routes: e.routes || [], settings: e.settings || [], tables: e.tables || [],
  })));
  return _all;
}

const get = id => all().find(f => f.id === id) || null;

/** What the admin hid from the default (features.hidden): still there, still working, offered last. */
function hidden() {
  const h = require('../settings-schema').value('features.hidden');
  return new Set(Array.isArray(h) ? h : []);
}

const STOP = new Set(['the', 'and', 'for', 'with', 'how', 'can', 'what', 'does', 'doca', 'is', 'to', 'a', 'an', 'of', 'in', 'on', 'my', 'it', 'do', 'i']);
// "screens", "recording", "searched" find "screen", "record", "search": a word's plain ending is dropped.
const words = q => String(q || '').toLowerCase().split(/[^a-z0-9_.+-]+/).filter(w => w.length > 1 && !STOP.has(w))
  .map(w => (w.length > 4 ? w.replace(/(ing|ers|ed|es|s)$/, '') : w));

/** Features matching `q`, best first; hidden ones after the rest. */
function find(q, { limit = 8 } = {}) {
  const want = words(q);
  if (!want.length) return [];
  const off = hidden();
  return all().map(f => {
    const strong = [f.id, f.name, ...f.tools, f.flag || ''].join(' ').toLowerCase();
    const weak = [f.use, f.words || '', ...f.page, ...f.settings, ...f.routes].join(' ').toLowerCase();
    const score = want.reduce((s, w) => s + (strong.includes(w) ? 3 : 0) + (weak.includes(w) ? 1 : 0), 0);
    return { f, score: off.has(f.id) ? score - 0.5 : score };
  }).filter(x => x.score > 0.5).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.f);
}

/** One feature in a few lines, for the agent. */
function describe(f, pages = require('./pages')) {
  const off = hidden().has(f.id);
  const state = f.state === 'experiment' ? `an experiment — on only with developer mode and experiments.${f.flag}`
    : f.state === 'alternative' ? `an alternative kept beside ${get(f.beside)?.name || f.beside}${off ? '; hidden from the default by the admin, still works' : ''}`
    : STATES[f.state];
  const where = [
    f.page.length && `page: ${f.page.map(pages.label).join(', ')}`,
    f.tools.length && `tools: ${f.tools.join(', ')}`,
    f.settings.length && `settings: ${f.settings.join(', ')}`,
    f.flag && f.state !== 'experiment' && `experiment: ${f.flag}`,
  ].filter(Boolean).join('; ');
  const unlicensed = require('../license').featureOn(f) ? '' : ` Not in this hive's licence (code ${f.licence}): it is not here until a licence adds it (Settings → System → Licence).`;
  return `• ${f.name} (${f.id}) — ${state}. ${f.use}${unlicensed}${where ? `\n  ${where}` : ''}`;
}

function setHidden(id, on) {
  const f = get(id);
  if (!f) throw Object.assign(new Error(`No feature "${id}".`), { status: 404 });
  if (f.state !== 'alternative') throw Object.assign(new Error('Only an alternative can be hidden from the default: the rest is the default.'), { status: 400 });
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  const set = hidden();
  if (on) set.add(id); else set.delete(id);
  savePrefs({ ...prefs, features: { ...(prefs.features || {}), hidden: [...set].sort() } });
  return { id, hidden: set.has(id) };
}

function mount(app) {
  app.get('/api/features', (_req, res) => {
    const off = hidden(), pages = require('./pages');
    res.json({ states: STATES, features: all().map(f => ({ ...f, hidden: off.has(f.id), licensed: require('../license').featureOn(f), pageLabels: f.page.map(pages.label) })),
      review: require('./review').review() });
  });
  app.post('/api/features/:id/hidden', (req, res) => {
    try { res.json(setHidden(req.params.id, req.body?.on === true)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { all, get, find, describe, hidden, setHidden, mount, STATES };

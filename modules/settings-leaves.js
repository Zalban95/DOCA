'use strict';

/**
 * Declared settings the panel draws a box for by name (settings-schema.js): their type, bounds, default, hint and
 * current value, for public/js/settings/leaf-fields.js. Deep test B found settings with no control anywhere — the
 * agents' computers' limits, the MCP timeouts, the adaptive step ceiling, the feature index's thresholds, the update
 * source — reachable only by a proposal or the file. Reading only: a box is saved through POST /api/prefs, so the
 * password guard on switches (auth/guarded.js) applies exactly as for every other setting.
 */
const schema = require('./settings-schema');

// A secret is never a box drawn from here: it is masked on the way out of /api/prefs and has its own forms.
const SECRET = /(^|\.)(\w*(token|key|secret|password)\w*)$/i;

function leaves(paths) {
  const prefs = require('./utils').loadPrefs();
  return paths.filter(p => !SECRET.test(p)).map(p => {
    const d = schema.leaf(p);
    if (!d) return null;
    return { path: p, type: d.type, min: d.min ?? null, max: d.max ?? null, default: d.default, oneOf: d.oneOf || null, hint: d.hint || '',
      value: schema.value(p, prefs), set: p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), prefs) !== undefined };
  }).filter(Boolean);
}

function mount(app) {
  app.get('/api/settings/leaves', (req, res) => {
    const paths = String(req.query.paths || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
    res.json({ leaves: leaves(paths) });
  });
}

module.exports = { leaves, mount };
